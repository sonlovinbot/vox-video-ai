import {
  ArrowsClockwise,
  FilmStrip,
  ImageSquare,
  Sparkle,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import type { AspectRatio, Beat } from "../types";

export type MediaTab = "image" | "video";

const statusLabels: Record<Beat["video"]["status"], string> = {
  idle: "Chưa có video",
  queued: "Đang chờ lượt",
  generating: "Đang dựng video",
  completed: "Đã có video",
  failed: "Video lỗi",
  canceled: "Đã huỷ",
};

/**
 * Khung media của một beat với hai tab Ảnh và Video.
 *
 * Tab do component cha giữ, không giữ trong đây: khi chạy hàng loạt, cha cần
 * lật thẻ sang tab Video để user thấy tiến trình.
 */
export function BeatMediaTabs({
  beat,
  aspectRatio,
  tab,
  onTab,
  refPreviewUrl,
  imageBusy,
  videoBusy,
  onCreateVideo,
  canCreateVideo,
  onUploadVideo,
  canUploadVideo,
  videoUploading,
  onRegenerateImage,
  canRegenerateImage,
}: {
  beat: Beat;
  aspectRatio: AspectRatio;
  tab: MediaTab;
  onTab: (tab: MediaTab) => void;
  refPreviewUrl: string;
  imageBusy: boolean;
  videoBusy: boolean;
  onCreateVideo: () => void;
  canCreateVideo: boolean;
  onUploadVideo: (file: File) => void;
  canUploadVideo: boolean;
  videoUploading: boolean;
  onRegenerateImage: () => void;
  canRegenerateImage: boolean;
}) {
  const frameClass = `frame-${aspectRatio.replace(":", "-")}`;
  const hasVideo = beat.video.status === "completed" && Boolean(beat.video.url);

  return (
    <div className="beat-media">
      <div className="beat-media-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "image"}
          className={tab === "image" ? "beat-tab-active" : ""}
          onClick={() => onTab("image")}
        >
          <ImageSquare size={15} />
          Ảnh
        </button>
        <button
          role="tab"
          aria-selected={tab === "video"}
          className={tab === "video" ? "beat-tab-active" : ""}
          onClick={() => onTab("video")}
        >
          <FilmStrip size={15} />
          Video
          {hasVideo && <i className="beat-tab-dot" aria-hidden="true" />}
        </button>

      </div>

      <div className={`story-media ${frameClass}`}>
        {tab === "image" ? (
          beat.outputImage ? (
            <img src={beat.outputImage} alt={`Keyframe B${beat.index}`} />
          ) : imageBusy ? (
            <div className="generating-frame">
              <span className="frame-skeleton" />
              <strong>Đang tạo keyframe</strong>
            </div>
          ) : refPreviewUrl ? (
            <img
              className="story-ref-preview"
              src={refPreviewUrl}
              alt={`Reference chờ tạo keyframe B${beat.index}`}
            />
          ) : (
            <div className="empty-frame">
              <ImageSquare size={30} />
              <span>Chưa có keyframe</span>
            </div>
          )
        ) : hasVideo ? (
          <video
            src={beat.video.url}
            poster={beat.outputImage || undefined}
            controls
            loop
            playsInline
            preload="metadata"
          />
        ) : videoBusy || beat.video.status === "generating" ? (
          <div className="generating-frame generating-video">
            {beat.outputImage && (
              <img
                className="video-thumb"
                src={beat.outputImage}
                alt={`Keyframe đang dựng video B${beat.index}`}
              />
            )}
            <span className="frame-skeleton" />
            <strong>
              {videoUploading
                ? "Đang nạp video"
                : beat.video.status === "queued"
                  ? "Đang chờ lượt"
                  : "Đang dựng video"}
            </strong>
          </div>
        ) : (
          <div className="empty-frame">
            {beat.video.status === "failed" ? (
              <>
                <WarningCircle size={28} />
                <span>{beat.video.error || "Tạo video thất bại"}</span>
              </>
            ) : (
              <>
                <FilmStrip size={30} />
                <span>
                  {beat.outputImage
                    ? "Chưa dựng video từ keyframe này"
                    : "Cần keyframe trước khi dựng video"}
                </span>
              </>
            )}
          </div>
        )}

        {beat.overlay.trim() && (
          <span className="story-editor-overlay">{beat.overlay}</span>
        )}

        <span className="story-time">
          B{beat.index.toString().padStart(2, "0")} /{" "}
          {tab === "video" && beat.video.durationSeconds
            ? `${beat.video.durationSeconds.toFixed(2)}s · ${beat.video.resolution}`
            : statusFor(beat, tab)}
        </span>
      </div>

      <div className="beat-media-actions">
        <span className="beat-media-file">
          {tab === "video"
            ? beat.video.name || "Chưa có file video"
            : beat.outputName || "Chưa có file ảnh"}
        </span>
        {tab === "image" ? (
          <button
            className="button button-quiet button-small"
            disabled={!canRegenerateImage}
            onClick={onRegenerateImage}
          >
            <ArrowsClockwise size={14} />
            Tạo lại ảnh
          </button>
        ) : (
          <>
            <label
              className={`button button-quiet button-small${
                canUploadVideo ? "" : " beat-action-disabled"
              }`}
              title="Nạp video có sẵn cho beat này"
            >
              <UploadSimple size={14} />
              {videoUploading ? "Đang nạp" : "Nạp video"}
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/*"
                hidden
                disabled={!canUploadVideo}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadVideo(file);
                  event.target.value = "";
                }}
              />
            </label>
            <button
              className="button button-primary button-small"
              disabled={!canCreateVideo}
              onClick={onCreateVideo}
            >
              {hasVideo ? (
                <ArrowsClockwise size={14} />
              ) : (
                <Sparkle size={14} weight="fill" />
              )}
              {hasVideo
                ? "Tạo lại video"
                : beat.video.status === "failed"
                  ? "Thử lại"
                  : "Tạo video"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function statusFor(beat: Beat, tab: MediaTab) {
  if (tab === "video") return statusLabels[beat.video.status];
  const mins = Math.floor(beat.start / 60);
  const secs = Math.floor(beat.start % 60);
  const endMins = Math.floor(beat.end / 60);
  const endSecs = Math.floor(beat.end % 60);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(mins)}:${pad(secs)}-${pad(endMins)}:${pad(endSecs)}`;
}
