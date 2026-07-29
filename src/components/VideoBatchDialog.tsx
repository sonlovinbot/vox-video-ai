import { FilmStrip, WarningCircle, X } from "@phosphor-icons/react";
import { estimateBatch, qualityLabels, resolveVideoSettings } from "../lib/video";
import type { AppSettings, Beat } from "../types";

/**
 * Xác nhận trước khi dựng video hàng loạt.
 *
 * Không hiện số tiền: Replicate không công bố đơn giá qua API, và một con số
 * bịa còn tệ hơn không có. Thay vào đó hiện tổng số giây video — đúng thứ
 * Replicate dùng để tính tiền — để user tự đối chiếu với trang model.
 */
export function VideoBatchDialog({
  beats,
  settings,
  onConfirm,
  onClose,
}: {
  beats: Beat[];
  settings: AppSettings;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const video = resolveVideoSettings(settings.video.quality, settings.video);
  const estimate = estimateBatch(beats, video);
  const withoutKeyframe = beats.filter((beat) => !beat.outputImage).length;

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-batch-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="video-batch-title">Dựng video hàng loạt</h2>
            <p>Mỗi keyframe thành một đoạn video theo motion prompt của beat đó.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </header>

        {estimate.count === 0 ? (
          <p className="search-error">
            Không có beat nào cần dựng video. Hãy tạo keyframe trước, hoặc mọi
            beat đã có video rồi.
          </p>
        ) : (
          <>
            <div className="export-summary">
              <code>
                {estimate.count} beat · {estimate.totalSeconds.toFixed(1)} giây video
              </code>
              <span>
                {qualityLabels[video.quality]} · {video.resolution} · {video.fps}fps
                {video.interpolate ? " · nội suy 30fps" : ""}
              </span>
              <span>Model: {settings.replicateModel}</span>
            </div>

            <p className="export-detail">
              Replicate tính tiền theo thời lượng video ở 16fps. Đơn giá xem tại
              trang model — tôi không nhúng con số vào app để tránh hiển thị giá
              sai khi Replicate đổi bảng giá.
            </p>

            <p className="export-detail">
              Chạy 5 video song song cho đến khi hết hàng đợi. Bấm Dừng bất cứ
              lúc nào — các prediction đang chạy sẽ bị huỷ thật trên Replicate,
              không chạy ngầm tính tiền tiếp.
            </p>

            {withoutKeyframe > 0 && (
              <p className="export-warn">
                <WarningCircle size={16} />
                {withoutKeyframe} beat chưa có keyframe nên bị bỏ qua.
              </p>
            )}
          </>
        )}

        <div className="export-actions">
          <button className="button button-quiet" onClick={onClose}>
            Huỷ
          </button>
          <button
            className="button button-primary"
            onClick={onConfirm}
            disabled={estimate.count === 0}
          >
            <FilmStrip size={18} />
            Dựng {estimate.count} video
          </button>
        </div>
      </section>
    </div>
  );
}
