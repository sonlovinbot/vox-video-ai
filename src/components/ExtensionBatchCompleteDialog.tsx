import { CheckCircle, Sparkle, X } from "@phosphor-icons/react";

export function ExtensionBatchCompleteDialog({
  executor,
  completedCount,
  remainingCount,
  onContinue,
  onClose,
}: {
  executor: "chatgpt" | "gemini";
  completedCount: number;
  remainingCount: number;
  onContinue: () => void;
  onClose: () => void;
}) {
  const label = executor === "gemini" ? "Gemini" : "ChatGPT";

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="extension-complete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-complete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button extension-complete-close" onClick={onClose} aria-label="Đóng">
          <X size={20} />
        </button>
        <CheckCircle className="extension-complete-icon" size={42} weight="fill" />
        <h2 id="extension-complete-title">
          {remainingCount > 0 ? "Đã xong lượt này" : "Đã tạo xong storyboard"}
        </h2>
        <p>
          {label} đã hoàn tất {completedCount} ảnh.
          {remainingCount > 0
            ? ` Còn ${remainingCount} ảnh chưa tạo. Bạn có thể kiểm tra kết quả rồi chủ động chạy lượt tiếp theo.`
            : " Tất cả keyframe đã sẵn sàng để kiểm tra."}
        </p>
        <div className="extension-complete-summary">
          <strong>{completedCount}</strong>
          <span>ảnh vừa hoàn tất</span>
          <strong>{remainingCount}</strong>
          <span>ảnh còn lại</span>
        </div>
        <div className="export-actions">
          <button className="button button-quiet" onClick={onClose}>
            {remainingCount > 0 ? "Để sau" : "Đóng"}
          </button>
          {remainingCount > 0 && (
            <button className="button button-primary" onClick={onContinue}>
              <Sparkle size={18} weight="fill" />
              Chạy tiếp {Math.min(12, remainingCount)} ảnh
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
