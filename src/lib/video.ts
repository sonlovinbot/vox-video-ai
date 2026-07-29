import type { Beat, BeatVideo, VideoQuality, VideoSettings } from "../types";

/** Wan 2.2 i2v-fast chỉ nhận num_frames trong khoảng này. */
export const MIN_FRAMES = 81;
export const MAX_FRAMES = 121;

/** Replicate tính tiền theo thời lượng video ở 16fps, nên preset giữ nguyên 16. */
const BILLING_FPS = 16;

export const VIDEO_PRESETS: Record<
  Exclude<VideoQuality, "custom">,
  VideoSettings
> = {
  draft: {
    quality: "draft",
    resolution: "480p",
    fps: BILLING_FPS,
    interpolate: false,
    goFast: true,
    sampleShift: 12,
  },
  standard: {
    quality: "standard",
    resolution: "720p",
    fps: BILLING_FPS,
    interpolate: false,
    goFast: true,
    sampleShift: 12,
  },
  high: {
    quality: "high",
    resolution: "720p",
    fps: BILLING_FPS,
    interpolate: true,
    goFast: false,
    sampleShift: 12,
  },
};

export const qualityLabels: Record<VideoQuality, string> = {
  draft: "Nháp — 480p, nhanh và rẻ nhất",
  standard: "Chuẩn — 720p",
  high: "Cao — 720p, mượt 30fps",
  custom: "Tuỳ chỉnh",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Không dùng `Number(x) || fallback`: toán tử || nuốt cả số 0 hợp lệ và trả về
 * fallback, nên sampleShift 0 sẽ thành 12 thay vì bị kẹp lên 1.
 */
const numberOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Preset thắng cấu hình tay, trừ khi quality là "custom".
 * Giá trị custom vẫn bị kẹp về khoảng Replicate chấp nhận — một fps 999 gửi đi
 * chỉ đổi lấy lỗi 422 sau khi đã chờ xong hàng đợi.
 */
export function resolveVideoSettings(
  quality: VideoQuality,
  custom: VideoSettings,
): VideoSettings {
  if (quality !== "custom") return VIDEO_PRESETS[quality];
  return {
    ...custom,
    quality: "custom",
    fps: Math.round(clamp(numberOr(custom.fps, BILLING_FPS), 5, 30)),
    sampleShift: clamp(numberOr(custom.sampleShift, 12), 1, 20),
  };
}

/** num_frames suy từ độ dài beat để video khớp timeline kịch bản. */
export function framesForBeat(beat: Beat, fps: number) {
  const duration = Number(beat.end) - Number(beat.start);
  if (!Number.isFinite(duration) || duration <= 0) return MIN_FRAMES;
  return clamp(Math.round(duration * fps), MIN_FRAMES, MAX_FRAMES);
}

export function emptyBeatVideo(): BeatVideo {
  return {
    status: "idle",
    url: "",
    remoteUrl: "",
    predictionId: "",
    durationSeconds: 0,
    frames: 0,
    fps: 0,
    resolution: "",
    error: "",
    createdAt: "",
  };
}

/** Beat cần tạo video: đã có keyframe, và chưa có video hoặc lần trước hỏng. */
export function beatsNeedingVideo(beats: Beat[]) {
  return beats.filter((beat) => {
    if (!beat.outputImage?.trim()) return false;
    const status = beat.video?.status;
    if (status === "completed" && beat.video.url) return false;
    return status !== "generating";
  });
}

export function estimateBatch(beats: Beat[], settings: VideoSettings) {
  const totalSeconds = beats.reduce(
    (total, beat) => total + framesForBeat(beat, settings.fps) / settings.fps,
    0,
  );
  return { count: beats.length, totalSeconds };
}
