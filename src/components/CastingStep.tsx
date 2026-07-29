import { ArrowRight, MagnifyingGlass, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import { BottomActions, PageHeading } from "./ui";
import { ImageSearchDialog } from "./ImageSearchDialog";
import { RefSlotStrip } from "./RefSlotStrip";
import { MAX_SLOTS, enforceSlotCap, refPlanIssues } from "../lib/casting";
import { cacheImage, searchImages } from "../lib/api";
import { runWithLimit } from "../lib/concurrency";
import type {
  AppSettings,
  Beat,
  ProjectState,
  SearchedImage,
  ToastState,
} from "../types";

const formatSeconds = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

/** Số request search chạy song song khi bấm "Tìm ảnh cho mọi beat". */
const SEARCH_CONCURRENCY = 3;

export function CastingStep({
  project,
  setProject,
  settings,
  notify,
  onBack,
  onApprove,
}: {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  settings: AppSettings;
  notify: (message: string, tone?: ToastState["tone"]) => void;
  onBack: () => void;
  onApprove: () => void;
}) {
  const [searchBeatId, setSearchBeatId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const readyCount = useMemo(
    () => project.beats.filter((beat) => !refPlanIssues(beat.refPlan).length).length,
    [project.beats],
  );

  const patchBeat = (beatId: string, patch: (beat: Beat) => Beat) => {
    setProject((current) => ({
      ...current,
      beats: current.beats.map((beat) => (beat.id === beatId ? patch(beat) : beat)),
      updatedAt: new Date().toISOString(),
    }));
  };

  const removeSlot = (beatId: string, slotId: string) =>
    patchBeat(beatId, (beat) => ({
      ...beat,
      refPlan: {
        ...beat.refPlan,
        slots: beat.refPlan.slots.filter((slot) => slot.id !== slotId),
      },
    }));

  const addUpload = (beatId: string, assetId: string) =>
    patchBeat(beatId, (beat) => {
      const asset = project.references.find((item) => item.id === assetId);
      if (!asset) return beat;
      const lock =
        asset.role === "style"
          ? "style"
          : asset.role === "environment"
            ? "content"
            : "identity";
      return {
        ...beat,
        refPlan: {
          ...beat.refPlan,
          slots: enforceSlotCap([
            ...beat.refPlan.slots.filter((slot) => !slot.pinned),
            {
              id: crypto.randomUUID(),
              kind: "upload" as const,
              assetId,
              lock,
              reason: "Bạn thêm thủ công.",
              pinned: false,
            },
            ...beat.refPlan.slots.filter((slot) => slot.pinned),
          ]),
        },
      };
    });

  /** Ghim ảnh đã chọn vào beat, cache về server trước để link chết lộ ngay. */
  const pickImage = async (beatId: string, image: SearchedImage) => {
    let stored = image;
    try {
      const { cachedUrl } = await cacheImage(image.fullUrl);
      stored = { ...image, cachedUrl };
    } catch (error) {
      notify(
        error instanceof Error
          ? `Không tải được ảnh về máy chủ: ${error.message}`
          : "Không tải được ảnh về máy chủ.",
        "error",
      );
      return;
    }

    setProject((current) => ({
      ...current,
      searchedImages: [
        ...current.searchedImages.filter((item) => item.id !== stored.id),
        stored,
      ],
      beats: current.beats.map((beat) => {
        if (beat.id !== beatId) return beat;
        const withoutSearched = beat.refPlan.slots.filter(
          (slot) => slot.kind !== "searched",
        );
        return {
          ...beat,
          refPlan: {
            ...beat.refPlan,
            status: "ready" as const,
            error: "",
            slots: enforceSlotCap([
              ...withoutSearched.filter((slot) => !slot.pinned),
              {
                id: crypto.randomUUID(),
                kind: "searched" as const,
                assetId: stored.id,
                lock: "content" as const,
                reason: "Tham chiếu bố cục cho beat này.",
                pinned: false,
              },
              ...withoutSearched.filter((slot) => slot.pinned),
            ]),
          },
        };
      }),
      updatedAt: new Date().toISOString(),
    }));
    setSearchBeatId("");
    notify("Đã gán ảnh tham chiếu cho beat.", "success");
  };

  const searchAll = async () => {
    const targets = project.beats.filter(
      (beat) =>
        beat.refPlan.searchQuery.trim() &&
        !beat.refPlan.slots.some((slot) => slot.kind === "searched"),
    );
    if (!targets.length) {
      notify("Không có beat nào cần tìm ảnh.", "neutral");
      return;
    }
    setBulkBusy(true);
    let failed = 0;

    await runWithLimit(targets, SEARCH_CONCURRENCY, async (beat) => {
      patchBeat(beat.id, (current) => ({
        ...current,
        refPlan: { ...current.refPlan, status: "searching", error: "" },
      }));
      try {
        const result = await searchImages(
          beat.refPlan.searchQuery,
          project.config.aspectRatio,
          settings.imageSearchCount,
        );
        if (!result.images.length) throw new Error("Không tìm thấy ảnh phù hợp.");
        patchBeat(beat.id, (current) => ({
          ...current,
          refPlan: {
            ...current.refPlan,
            status: "ready",
            candidates: result.images,
            error: "",
          },
        }));
      } catch (error) {
        failed += 1;
        patchBeat(beat.id, (current) => ({
          ...current,
          refPlan: {
            ...current.refPlan,
            status: "failed",
            error:
              error instanceof Error ? error.message : "Tìm ảnh thất bại.",
          },
        }));
      }
    });

    setBulkBusy(false);
    notify(
      failed
        ? `Tìm xong ${targets.length - failed}/${targets.length} beat, ${failed} beat lỗi.`
        : `Đã tìm ảnh cho ${targets.length} beat. Mở từng beat để chọn ảnh.`,
      failed ? "error" : "success",
    );
  };

  // Search một lần khi vừa vào Casting, để user có sẵn candidate mà chọn.
  // useRef chứ không phải state: chạy lại sẽ tốn quota mà không thêm thông tin.
  const autoSearched = useRef(false);
  useEffect(() => {
    if (autoSearched.current || !settings.imageSearchEnabled) return;
    const needsSearch = project.beats.some(
      (beat) =>
        beat.refPlan.searchQuery.trim() &&
        !beat.refPlan.candidates.length &&
        !beat.refPlan.slots.some((slot) => slot.kind === "searched"),
    );
    if (!needsSearch) return;
    autoSearched.current = true;
    void searchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.imageSearchEnabled]);

  /**
   * Nạp ảnh từ máy hoặc từ clipboard vào thẳng một beat.
   *
   * Ảnh vào với lock content: đây là ảnh do user đưa vào làm tham chiếu bố cục,
   * không phải chủ thể cần giữ nguyên identity.
   */
  const attachLocalImage = (beatId: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      notify("Chỉ nhận file ảnh.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const id = crypto.randomUUID();
      const image: SearchedImage = {
        id,
        source: "pexels",
        thumbUrl: String(reader.result),
        fullUrl: String(reader.result),
        cachedUrl: String(reader.result),
        attribution: file.name || "Ảnh từ máy",
        sourcePage: "",
      };
      setProject((current) => ({
        ...current,
        searchedImages: [...current.searchedImages, image],
        beats: current.beats.map((beat) => {
          if (beat.id !== beatId) return beat;
          return {
            ...beat,
            refPlan: {
              ...beat.refPlan,
              status: "ready" as const,
              error: "",
              slots: enforceSlotCap([
                ...beat.refPlan.slots.filter((slot) => !slot.pinned),
                {
                  id: crypto.randomUUID(),
                  kind: "searched" as const,
                  assetId: id,
                  lock: "content" as const,
                  reason: "Bạn nạp từ máy.",
                  pinned: false,
                },
                ...beat.refPlan.slots.filter((slot) => slot.pinned),
              ]),
            },
          };
        }),
        updatedAt: new Date().toISOString(),
      }));
      notify("Đã nạp ảnh vào beat.", "success");
    };
    reader.onerror = () => notify("Không đọc được file ảnh.", "error");
    reader.readAsDataURL(file);
  };

  const pasteImage = async (beatId: string) => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        attachLocalImage(beatId, new File([blob], "clipboard.png", { type }));
        return;
      }
      notify("Clipboard không có ảnh nào.", "error");
    } catch {
      notify(
        "Trình duyệt không cho đọc clipboard. Hãy dùng nút Nạp ảnh, hoặc bấm vào thẻ beat rồi Ctrl+V.",
        "error",
      );
    }
  };

  const searchBeat = project.beats.find((beat) => beat.id === searchBeatId);

  return (
    <section className="step-panel">
      <PageHeading
        title="Phân vai ảnh reference"
        description="Mỗi beat chỉ nhận ảnh thực sự xuất hiện trong khung hình. Style reference được ghim sẵn vào mọi beat để giữ nhất quán."
        aside={
          <div className="casting-actions">
            <span className="casting-progress">
              {readyCount}/{project.beats.length} beat sẵn sàng
            </span>
            {settings.imageSearchEnabled && (
              <button
                className="button button-quiet"
                onClick={() => void searchAll()}
                disabled={bulkBusy}
              >
                {bulkBusy ? <span className="button-loader" /> : <Sparkle size={18} />}
                Tìm ảnh cho mọi beat
              </button>
            )}
          </div>
        }
      />

      {!settings.imageSearchEnabled && (
        <p className="casting-notice">
          Tìm ảnh nâng cao đang tắt. Bật trong Settings để dùng Pexels và Serper
          làm ảnh tham chiếu bối cảnh.
        </p>
      )}

      <div className="casting-list">
        {project.beats.map((beat) => {
          const issues = refPlanIssues(beat.refPlan);
          const usedIds = new Set(beat.refPlan.slots.map((slot) => slot.assetId));
          const availableUploads = project.references.filter(
            (asset) => !usedIds.has(asset.id),
          );

          return (
            <article
              key={beat.id}
              className="casting-card"
              tabIndex={0}
              onPaste={(event) => {
                const file = Array.from(event.clipboardData?.files || [])[0];
                if (file) {
                  event.preventDefault();
                  attachLocalImage(beat.id, file);
                }
              }}
            >
              <header>
                <div>
                  <span className="casting-code">
                    B{beat.index.toString().padStart(2, "0")}
                  </span>
                  <span className="casting-time">
                    {formatSeconds(beat.start)}–{formatSeconds(beat.end)}
                  </span>
                  <span className="casting-job">{beat.job}</span>
                </div>
                <label className="button button-quiet button-small">
                  <UploadSimple size={16} />
                  Nạp ảnh
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) attachLocalImage(beat.id, file);
                      event.target.value = "";
                    }}
                  />
                </label>
                <button
                  className="button button-quiet button-small"
                  onClick={() => void pasteImage(beat.id)}
                >
                  Dán ảnh
                </button>
                {settings.imageSearchEnabled && (
                  <button
                    className="button button-quiet button-small"
                    onClick={() => setSearchBeatId(beat.id)}
                  >
                    {beat.refPlan.status === "searching" ? (
                      <span className="button-loader" />
                    ) : (
                      <MagnifyingGlass size={16} />
                    )}
                    Tìm ảnh
                  </button>
                )}
              </header>

              <p className="casting-narration">{beat.narration}</p>
              <p className="casting-visual">{beat.visual}</p>

              <RefSlotStrip
                plan={beat.refPlan}
                references={project.references}
                searched={project.searchedImages}
                availableUploads={availableUploads}
                onRemove={(slotId) => removeSlot(beat.id, slotId)}
                onAddUpload={(assetId) => addUpload(beat.id, assetId)}
              />

              {beat.refPlan.newElements.length > 0 && (
                <div className="casting-new-elements">
                  <span>Model tự dựng:</span>
                  {beat.refPlan.newElements.map((element) => (
                    <em key={element}>{element}</em>
                  ))}
                </div>
              )}

              {issues.map((issue) => (
                <p key={issue} className="casting-issue">
                  <WarningCircle size={15} />
                  {issue}
                </p>
              ))}
            </article>
          );
        })}
      </div>

      {searchBeat && (
        <ImageSearchDialog
          beatLabel={`B${searchBeat.index.toString().padStart(2, "0")} — ${searchBeat.visual}`}
          initialQuery={searchBeat.refPlan.searchQuery}
          aspectRatio={project.config.aspectRatio}
          count={settings.imageSearchCount}
          selectedId={
            searchBeat.refPlan.slots.find((slot) => slot.kind === "searched")
              ?.assetId || ""
          }
          onPick={(image) => void pickImage(searchBeat.id, image)}
          onClose={() => setSearchBeatId("")}
        />
      )}

      <BottomActions
        onBack={onBack}
        primary={
          <button
            className="button button-primary"
            onClick={onApprove}
            disabled={project.beats.length === 0}
          >
            Duyệt casting và tạo storyboard
            <ArrowRight size={18} />
          </button>
        }
      />
    </section>
  );
}

export { MAX_SLOTS };
