import { ImageSquare, PushPin, Warning, X } from "@phosphor-icons/react";
import type {
  BeatRefPlan,
  BeatRefSlot,
  RefLock,
  ReferenceAsset,
  SearchedImage,
} from "../types";

const lockLabels: Record<RefLock, string> = {
  identity: "Giữ nguyên",
  style: "Chất liệu",
  content: "Bố cục",
};

const lockHints: Record<RefLock, string> = {
  identity:
    "Model phải giữ nguyên hình dáng, tỷ lệ, màu và nhãn hiệu của chủ thể này.",
  style: "Model chỉ lấy chất liệu giấy, palette và texture. Bỏ qua nội dung ảnh.",
  content:
    "Model chỉ lấy bố cục và hình dạng vật thể, phải vẽ lại hoàn toàn thành giấy cắt.",
};

export interface ResolvedSlot {
  slot: BeatRefSlot;
  label: string;
  previewUrl: string;
  sourceLabel: string;
  untrusted: boolean;
}

export function resolveSlots(
  plan: BeatRefPlan,
  references: ReferenceAsset[],
  searched: SearchedImage[],
): ResolvedSlot[] {
  return plan.slots.map((slot) => {
    if (slot.kind === "upload") {
      const asset = references.find((item) => item.id === slot.assetId);
      return {
        slot,
        label: asset?.name || "Reference đã bị xoá",
        previewUrl: asset?.previewUrl || "",
        sourceLabel: "Upload",
        untrusted: false,
      };
    }
    const image = searched.find((item) => item.id === slot.assetId);
    return {
      slot,
      label: image?.attribution || "Ảnh đã bị xoá",
      previewUrl: image?.cachedUrl || image?.thumbUrl || "",
      sourceLabel: image?.source === "serper" ? "Serper" : "Pexels",
      untrusted: image?.source === "serper",
    };
  });
}

export function RefSlotStrip({
  plan,
  references,
  searched,
  onRemove,
  onAddUpload,
  availableUploads,
}: {
  plan: BeatRefPlan;
  references: ReferenceAsset[];
  searched: SearchedImage[];
  onRemove: (slotId: string) => void;
  onAddUpload: (assetId: string) => void;
  availableUploads: ReferenceAsset[];
}) {
  const resolved = resolveSlots(plan, references, searched);

  return (
    <div className="ref-slot-strip">
      {resolved.map(({ slot, label, previewUrl, sourceLabel, untrusted }) => (
        <figure
          key={slot.id}
          className={`ref-slot ref-slot-${slot.lock}`}
          title={lockHints[slot.lock]}
        >
          {previewUrl ? (
            <img src={previewUrl} alt={label} loading="lazy" />
          ) : (
            <div className="ref-slot-empty">
              <ImageSquare size={22} />
            </div>
          )}

          <div className="ref-slot-badges">
            <span className={`ref-badge ref-badge-${slot.lock}`}>
              {lockLabels[slot.lock]}
            </span>
            <span className="ref-badge ref-badge-source">{sourceLabel}</span>
          </div>

          {slot.pinned ? (
            <span className="ref-slot-pin" title="Ghim vào mọi beat">
              <PushPin size={14} weight="fill" />
            </span>
          ) : (
            <button
              className="ref-slot-remove"
              onClick={() => onRemove(slot.id)}
              aria-label={`Bỏ ${label} khỏi beat này`}
            >
              <X size={13} />
            </button>
          )}

          <figcaption>
            <strong>{label}</strong>
            {slot.reason && <span>{slot.reason}</span>}
            {untrusted && (
              <span className="ref-slot-warning">
                <Warning size={12} /> Ảnh web, chưa rõ bản quyền — chỉ dùng làm
                tham chiếu bố cục.
              </span>
            )}
          </figcaption>
        </figure>
      ))}

      {availableUploads.length > 0 && (
        <label className="ref-slot ref-slot-add">
          <span>+ Thêm ref</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) onAddUpload(event.target.value);
            }}
          >
            <option value="">Chọn ảnh đã nạp</option>
            {availableUploads.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
