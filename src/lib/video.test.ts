import { describe, expect, it } from "vitest";
import {
  MAX_FRAMES,
  MIN_FRAMES,
  VIDEO_PRESETS,
  beatsNeedingVideo,
  emptyBeatVideo,
  estimateBatch,
  framesForBeat,
  resolveVideoSettings,
} from "./video";
import { defaultConfig, generateBeats } from "./workflow";
import type { Beat, VideoSettings } from "../types";

function beat(start: number, end: number, patch: Partial<Beat> = {}): Beat {
  const base = generateBeats(defaultConfig)[0];
  return { ...base, start, end, ...patch };
}

const standard = VIDEO_PRESETS.standard;

describe("VIDEO_PRESETS", () => {
  it("nháp rẻ nhất, cao đắt nhất", () => {
    expect(VIDEO_PRESETS.draft.resolution).toBe("480p");
    expect(VIDEO_PRESETS.draft.interpolate).toBe(false);
    expect(VIDEO_PRESETS.standard.resolution).toBe("720p");
    expect(VIDEO_PRESETS.high.interpolate).toBe(true);
  });

  it("mọi preset dùng fps Replicate tính tiền", () => {
    for (const preset of Object.values(VIDEO_PRESETS)) {
      expect(preset.fps).toBe(16);
      expect(preset.sampleShift).toBeGreaterThanOrEqual(1);
      expect(preset.sampleShift).toBeLessThanOrEqual(20);
    }
  });
});

describe("resolveVideoSettings", () => {
  it("preset trả đúng cấu hình của preset đó", () => {
    expect(resolveVideoSettings("draft", standard)).toEqual(VIDEO_PRESETS.draft);
    expect(resolveVideoSettings("high", standard)).toEqual(VIDEO_PRESETS.high);
  });

  it("custom mới dùng tới cấu hình chỉnh tay", () => {
    const custom: VideoSettings = {
      quality: "custom",
      resolution: "480p",
      fps: 24,
      interpolate: true,
      goFast: false,
      sampleShift: 8,
    };
    expect(resolveVideoSettings("custom", custom)).toEqual(custom);
  });

  it("custom vẫn bị kẹp về khoảng Replicate chấp nhận", () => {
    const wild: VideoSettings = {
      quality: "custom",
      resolution: "720p",
      fps: 999,
      interpolate: false,
      goFast: true,
      sampleShift: 50,
    };
    const resolved = resolveVideoSettings("custom", wild);
    expect(resolved.fps).toBe(30);
    expect(resolved.sampleShift).toBe(20);
  });

  it("custom với giá trị quá nhỏ cũng bị kẹp", () => {
    const wild: VideoSettings = {
      quality: "custom",
      resolution: "720p",
      fps: 1,
      interpolate: false,
      goFast: true,
      sampleShift: 0,
    };
    const resolved = resolveVideoSettings("custom", wild);
    expect(resolved.fps).toBe(5);
    expect(resolved.sampleShift).toBe(1);
  });
});

describe("framesForBeat", () => {
  it("beat 5 giây ở 16fps ra 81 frame", () => {
    expect(framesForBeat(beat(0, 5), 16)).toBe(81);
  });

  it("beat dài hơn cho nhiều frame hơn", () => {
    expect(framesForBeat(beat(0, 6), 16)).toBe(96);
    expect(framesForBeat(beat(0, 7), 16)).toBe(112);
  });

  it("kẹp trần ở MAX_FRAMES với beat quá dài", () => {
    expect(framesForBeat(beat(0, 30), 16)).toBe(MAX_FRAMES);
  });

  it("kẹp sàn ở MIN_FRAMES với beat quá ngắn", () => {
    expect(framesForBeat(beat(0, 1), 16)).toBe(MIN_FRAMES);
    expect(framesForBeat(beat(0, 0), 16)).toBe(MIN_FRAMES);
  });

  it("beat có thời gian âm hoặc lộn ngược không làm vỡ request", () => {
    expect(framesForBeat(beat(10, 4), 16)).toBe(MIN_FRAMES);
  });

  it("fps cao hơn cần nhiều frame hơn cho cùng độ dài", () => {
    expect(framesForBeat(beat(0, 5), 24)).toBe(120);
  });

  it("mọi độ dài dự án hiện tại đều nằm trong khoảng hợp lệ", () => {
    for (const duration of [30, 60, 180] as const) {
      for (const item of generateBeats({ ...defaultConfig, duration })) {
        const frames = framesForBeat(item, 16);
        expect(frames).toBeGreaterThanOrEqual(MIN_FRAMES);
        expect(frames).toBeLessThanOrEqual(MAX_FRAMES);
      }
    }
  });
});

describe("beatsNeedingVideo", () => {
  const withVideo = (status: Beat["video"]["status"], url = "") =>
    beat(0, 5, { video: { ...emptyBeatVideo(), status, url } });

  it("bỏ qua beat chưa có keyframe", () => {
    const beats = [beat(0, 5, { outputImage: "" })];
    expect(beatsNeedingVideo(beats)).toEqual([]);
  });

  it("nhận beat có ảnh mà chưa có video", () => {
    const beats = [beat(0, 5, { outputImage: "/generated/a.png" })];
    expect(beatsNeedingVideo(beats)).toHaveLength(1);
  });

  it("nhận lại beat lỗi và beat bị huỷ", () => {
    const beats = [
      { ...withVideo("failed"), outputImage: "/generated/a.png" },
      { ...withVideo("canceled"), outputImage: "/generated/b.png" },
    ];
    expect(beatsNeedingVideo(beats)).toHaveLength(2);
  });

  it("bỏ qua beat đã có video xong", () => {
    const beats = [
      {
        ...withVideo("completed", "/generated/videos/a.mp4"),
        outputImage: "/generated/a.png",
      },
    ];
    expect(beatsNeedingVideo(beats)).toEqual([]);
  });
});

describe("estimateBatch", () => {
  it("cộng đúng số beat và tổng giây video", () => {
    const beats = [
      beat(0, 5, { outputImage: "/generated/a.png" }),
      beat(5, 5 + 6, { outputImage: "/generated/b.png" }),
    ];
    const estimate = estimateBatch(beats, standard);
    expect(estimate.count).toBe(2);
    // 81/16 + 96/16 = 5.0625 + 6 = 11.0625
    expect(estimate.totalSeconds).toBeCloseTo(11.06, 1);
  });

  it("không có beat nào thì bằng không", () => {
    expect(estimateBatch([], standard)).toEqual({ count: 0, totalSeconds: 0 });
  });

  it("interpolate không làm đổi thời lượng, chỉ đổi độ mượt", () => {
    const beats = [beat(0, 5, { outputImage: "/generated/a.png" })];
    expect(estimateBatch(beats, VIDEO_PRESETS.high).totalSeconds).toBeCloseTo(
      estimateBatch(beats, VIDEO_PRESETS.standard).totalSeconds,
      5,
    );
  });
});

describe("emptyBeatVideo", () => {
  it("bắt đầu ở idle và rỗng hoàn toàn", () => {
    const video = emptyBeatVideo();
    expect(video.status).toBe("idle");
    expect(video.url).toBe("");
    expect(video.remoteUrl).toBe("");
    expect(video.durationSeconds).toBe(0);
  });
});
