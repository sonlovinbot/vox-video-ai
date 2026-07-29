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
  selectedId,
  onPick,
  onClose,
}: {
  beatLabel: string;
  initialQuery: string;
  aspectRatio: string;
  count: number;
  selectedId: string;
  onPick: (image: SearchedImage) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [images, setImages] = useState<SearchedImage[]>([]);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
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
          Từ khoá nên tả cảnh vật hoặc vật thể bằng tiếng Anh, không tả phong
          cách — style đã được khoá bằng style reference.
        </p>

        {provider === "serper" && (
          <p className="search-warning">
            <Warning size={15} /> Pexels không có kết quả nên đang hiển thị ảnh
            web từ Serper. Ảnh chưa rõ bản quyền, chỉ nên dùng làm tham chiếu bố
            cục.
          </p>
        )}

        {error && <p className="search-error">{error}</p>}

        <div className="search-grid">
          {images.map((image) => (
            <button
              key={image.id}
              className={`search-result${
                image.id === selectedId ? " search-result-active" : ""
              }`}
              onClick={() => onPick(image)}
            >
              <img src={image.thumbUrl} alt={image.attribution} loading="lazy" />
              <span>{image.attribution}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
