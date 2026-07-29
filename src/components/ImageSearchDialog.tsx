import { MagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { searchImages } from "../lib/api";
import type { SearchedImage } from "../types";

/**
 * Lưới chọn ảnh tham chiếu bố cục cho một beat. Pexels được thử trước ở backend;
 * kết quả Serper luôn kèm cảnh báo bản quyền vì đó là ảnh web bất kỳ.
 */
export function ImageSearchDialog({
  beatLabel,
  initialQuery,
  aspectRatio,
  count,
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
  selectedId?: string;
  selectedIds?: string[];
  applicationNote?: string;
  onPick: (image: SearchedImage) => void | Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [images, setImages] = useState<SearchedImage[]>([]);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickingId, setPickingId] = useState("");
  const [error, setError] = useState("");

  const run = async (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) {
      setError("Nhập từ khoá tiếng Anh mô tả cảnh vật cần tìm.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await searchImages(trimmed, aspectRatio, count);
      setImages(result.images);
      setProvider(result.provider);
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

        <p className="search-hint">
          Từ khoá nên tả cảnh vật hoặc vật thể bằng tiếng Anh. Không tả phong
          cách vì style đã được khoá bằng style reference.
        </p>

        {applicationNote && (
          <div className="search-application">
            <strong>Ảnh sẽ được áp dụng thế nào?</strong>
            <p>{applicationNote}</p>
          </div>
        )}

        {provider === "serper" && (
          <p className="search-warning">
            <Warning size={15} /> Pexels không có kết quả nên đang hiển thị ảnh
            web từ Serper. Ảnh chưa rõ bản quyền, chỉ nên dùng làm tham chiếu bố
            cục.
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
