import { MagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { searchImages } from "../lib/api";
import type { SearchSource, SearchedImage } from "../types";

/**
 * Lưới chọn ảnh tham chiếu bố cục cho một beat. Pexels được thử trước ở backend;
 * kết quả Serper luôn kèm cảnh báo bản quyền vì đó là ảnh web bất kỳ.
 */
export function ImageSearchDialog({
  beatLabel,
  initialQuery,
  aspectRatio,
  count,
  enabledSources,
  selectedId = "",
  selectedIds = [],
  applicationNote,
  onPick,
  onClose,
}: {
  beatLabel: string;
  initialQuery: string;
  aspectRatio: string;
  count: number;
  enabledSources: SearchSource[];
  selectedId?: string;
  selectedIds?: string[];
  applicationNote?: string;
  onPick: (image: SearchedImage) => void | Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [images, setImages] = useState<SearchedImage[]>([]);
  const [sources, setSources] = useState<SearchSource[]>(enabledSources);
  const [providers, setProviders] = useState<string[]>([]);
  const [englishQuery, setEnglishQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickingId, setPickingId] = useState("");
  const [error, setError] = useState("");

  const run = async (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) {
      setError("Nhập từ khoá mô tả cảnh vật cần tìm.");
      return;
    }
    if (!sources.length) {
      setError("Hãy bật ít nhất một nguồn ảnh.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await searchImages(trimmed, aspectRatio, count, sources);
      setImages(result.images);
      setProviders(result.providers);
      setEnglishQuery(result.query);
      if (!result.images.length) setError("Không tìm thấy ảnh nào phù hợp.");
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : "Tìm ảnh thất bại.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialQuery.trim()) void run(initialQuery);
    // Chỉ chạy một lần khi mở dialog cho beat này.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="search-title">Tìm ảnh tham chiếu</h2>
            <p>{beatLabel}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </header>

        <div className="search-bar">
          <input
            value={query}
            placeholder="warehouse conveyor belt parcels sorting"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void run(query);
            }}
          />
          <button
            className="button button-primary"
            onClick={() => void run(query)}
            disabled={busy}
          >
            {busy ? <span className="button-loader" /> : <MagnifyingGlass size={18} />}
            Tìm
          </button>
        </div>

        <div className="search-sources" aria-label="Nguồn tìm ảnh">
          {(["pexels", "serper"] as const).map((source) => (
            <label key={source}>
              <input
                type="checkbox"
                checked={sources.includes(source)}
                onChange={(event) =>
                  setSources((current) =>
                    event.target.checked
                      ? [...new Set([...current, source])]
                      : current.filter((item) => item !== source),
                  )
                }
              />
              {source === "pexels" ? "Pexels" : "Serper / Google Images"}
            </label>
          ))}
        </div>

        <p className="search-hint">
          Bạn có thể nhập bằng bất kỳ ngôn ngữ nào. Hệ thống luôn chuyển sang
          tiếng Anh trước khi tìm.
          {englishQuery && <> Query đã dùng: <strong>{englishQuery}</strong>.</>}
        </p>

        {applicationNote && (
          <div className="search-application">
            <strong>Ảnh sẽ được áp dụng thế nào?</strong>
            <p>{applicationNote}</p>
          </div>
        )}

        {providers.includes("serper") && (
          <p className="search-warning">
            <Warning size={15} /> Kết quả Serper là ảnh web chưa rõ bản quyền,
            chỉ nên dùng làm tham chiếu bố cục.
          </p>
        )}

        {error && <p className="search-error">{error}</p>}
        {!busy && !error && images.length === 0 && (
          <p className="search-empty">
            Nhập keyword rồi bấm Tìm để xem ảnh trước khi thêm vào project.
          </p>
        )}

        <div className="search-grid">
          {images.map((image) => (
            <button
              key={image.id}
              className={`search-result${
                image.id === selectedId || selectedIds.includes(image.id)
                  ? " search-result-active"
                  : ""
              }`}
              disabled={Boolean(pickingId)}
              onClick={async () => {
                setPickingId(image.id);
                try {
                  await onPick(image);
                } finally {
                  setPickingId("");
                }
              }}
            >
              <img src={image.thumbUrl} alt={image.attribution} loading="lazy" />
              <span>
                {pickingId === image.id ? "Đang thêm ảnh..." : image.attribution}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
