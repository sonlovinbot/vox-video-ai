import { Plus, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Field } from "./ui";
import { qualityLabels } from "../lib/video";
import type { VideoQuality } from "../types";

const choices: Exclude<VideoQuality, "custom">[] = ["draft", "standard", "high"];

export function NewProjectDialog({
  defaultQuality,
  onCreate,
  onClose,
}: {
  defaultQuality: VideoQuality;
  onCreate: (title: string, quality: VideoQuality) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [quality, setQuality] = useState<VideoQuality>(
    defaultQuality === "custom" ? "draft" : defaultQuality,
  );

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="new-project-title">Dự án mới</h2>
            <p>Dự án đang làm vẫn nằm trong lịch sử, không bị mất.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </header>

        <Field label="Tên dự án">
          <input
            value={title}
            autoFocus
            placeholder="Hành trình của một đơn hàng 39k"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCreate(title, quality);
            }}
          />
        </Field>

        <Field label="Chất lượng video">
          <select
            value={quality}
            onChange={(event) => setQuality(event.target.value as VideoQuality)}
          >
            {choices.map((value) => (
              <option key={value} value={value}>
                {qualityLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <p className="export-detail">
          Đổi được bất cứ lúc nào trong Settings. Chất lượng càng cao thì mỗi
          giây video càng tốn, nên bản nháp thường nên để 480p.
        </p>

        <div className="export-actions">
          <button className="button button-quiet" onClick={onClose}>
            Huỷ
          </button>
          <button
            className="button button-primary"
            onClick={() => onCreate(title, quality)}
          >
            <Plus size={18} />
            Tạo dự án
          </button>
        </div>
      </section>
    </div>
  );
}
