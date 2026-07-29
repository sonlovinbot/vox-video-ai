import { CheckCircle, DownloadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { downloadExportPackage } from "../lib/api";
import { packageFileName, planExport } from "../lib/exportPack";
import type { Beat, ToastState } from "../types";

/**
 * Xuất gói ảnh + prompt để nạp thủ công vào extension Coachio Video Flow.
 *
 * Extension ghép images[i] với prompts[i] theo chỉ số, nên beat chưa có keyframe
 * bị loại khỏi cả hai danh sách — planExport lo việc đó và trả về danh sách bị
 * bỏ để hiện cảnh báo ở đây.
 */
export function ExportPackDialog({
  beats,
  title,
  notify,
  onClose,
}: {
  beats: Beat[];
  title: string;
  notify: (message: string, tone?: ToastState["tone"]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => planExport(beats), [beats]);
  const fileName = packageFileName(title);
  const complete = plan.skipped.length === 0 && plan.entries.length > 0;

  const download = async () => {
    setBusy(true);
    try {
      const blob = await downloadExportPackage(
        plan.entries.map(({ name, url }) => ({ name, url })),
        plan.prompts,
        fileName,
      );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
      notify(`Đã tải ${fileName}.`, "success");
      onClose();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất được gói.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-pack-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="export-pack-title">Xuất gói cho Coachio Video Flow</h2>
            <p>Ảnh keyframe và motion prompt, ghép cặp theo thứ tự.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </header>

        <p className={complete ? "export-ok" : "export-warn"}>
          {complete ? <CheckCircle size={16} /> : <WarningCircle size={16} />}
          {plan.entries.length}/{beats.length} beat có keyframe
        </p>

        {plan.skipped.length > 0 && (
          <p className="export-detail">
            Beat{" "}
            {plan.skipped.map((index) => `B${index.toString().padStart(2, "0")}`).join(", ")}{" "}
            chưa có ảnh nên bị bỏ khỏi gói. Số ảnh vẫn bằng số prompt, các cặp
            còn lại ghép đúng.
          </p>
        )}

        {plan.entries.length === 0 ? (
          <p className="search-error">
            Chưa tạo được keyframe nào. Hãy sinh ảnh ở Storyboard trước.
          </p>
        ) : (
          <>
            <div className="export-summary">
              <code>{fileName}</code>
              <span>
                {plan.entries.length} ảnh ({plan.entries[0].name} –{" "}
                {plan.entries.at(-1)?.name}) + prompts.txt với{" "}
                {plan.prompts.length} motion prompt
              </span>
            </div>

            <ol className="export-steps">
              <li>Giải nén file vừa tải.</li>
              <li>
                Ở extension bấm <strong>Upload ảnh</strong>, quét chọn cả{" "}
                {plan.entries.length} file ảnh. Giữ nguyên thứ tự theo tên —
                extension ghép ảnh với prompt theo chỉ số.
              </li>
              <li>
                Bấm <strong>Upload prompt</strong>, chọn{" "}
                <code>prompts.txt</code>.
              </li>
              <li>
                Đặt chế độ frame là <strong>single</strong> — một ảnh cho một
                video.
              </li>
            </ol>
          </>
        )}

        <div className="export-actions">
          <button className="button button-quiet" onClick={onClose}>
            Huỷ
          </button>
          <button
            className="button button-primary"
            onClick={() => void download()}
            disabled={busy || plan.entries.length === 0}
          >
            {busy ? <span className="button-loader" /> : <DownloadSimple size={18} />}
            Tải ZIP
          </button>
        </div>
      </section>
    </div>
  );
}
