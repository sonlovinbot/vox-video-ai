import { describe, expect, it } from "vitest";
import {
  buildPredictionInput,
  isTerminal,
  normalizePrediction,
} from "./replicate";
import { VIDEO_PRESETS } from "../src/lib/video";

const image = "https://replicate.delivery/pbxt/abc/keyframe.png";

describe("buildPredictionInput", () => {
  it("gửi đúng tên field mà Wan 2.2 khai báo", () => {
    const input = buildPredictionInput(
      "Animate B01",
      image,
      81,
      VIDEO_PRESETS.draft,
    );
    expect(input).toEqual({
      prompt: "Animate B01",
      image,
      num_frames: 81,
      resolution: "480p",
      frames_per_second: 16,
      interpolate_output: false,
      go_fast: true,
      sample_shift: 12,
    });
  });

  it("preset Cao bật interpolate và tắt go_fast", () => {
    const input = buildPredictionInput("x", image, 96, VIDEO_PRESETS.high);
    expect(input.interpolate_output).toBe(true);
    expect(input.go_fast).toBe(false);
    expect(input.resolution).toBe("720p");
    expect(input.num_frames).toBe(96);
  });

  it("kẹp num_frames về khoảng Wan chấp nhận", () => {
    expect(
      buildPredictionInput("x", image, 500, VIDEO_PRESETS.draft).num_frames,
    ).toBe(121);
    expect(
      buildPredictionInput("x", image, 3, VIDEO_PRESETS.draft).num_frames,
    ).toBe(81);
  });

  it("không gửi seed khi không chỉ định, để Replicate tự chọn", () => {
    expect(
      "seed" in buildPredictionInput("x", image, 81, VIDEO_PRESETS.draft),
    ).toBe(false);
  });

  it("gửi seed khi có, kể cả seed 0", () => {
    expect(
      buildPredictionInput("x", image, 81, VIDEO_PRESETS.draft, 0).seed,
    ).toBe(0);
    expect(
      buildPredictionInput("x", image, 81, VIDEO_PRESETS.draft, 42).seed,
    ).toBe(42);
  });
});

describe("normalizePrediction", () => {
  const base = {
    id: "abc123",
    status: "processing",
    urls: {
      get: "https://api.replicate.com/v1/predictions/abc123",
      cancel: "https://api.replicate.com/v1/predictions/abc123/cancel",
    },
  };

  it("đọc id, status và hai URL điều khiển", () => {
    const result = normalizePrediction(base);
    expect(result.id).toBe("abc123");
    expect(result.status).toBe("processing");
    expect(result.getUrl).toBe(base.urls.get);
    expect(result.cancelUrl).toBe(base.urls.cancel);
    expect(result.output).toBe("");
  });

  it("output của Wan là một chuỗi URI", () => {
    const result = normalizePrediction({
      ...base,
      status: "succeeded",
      output: "https://replicate.delivery/pbxt/xyz/out.mp4",
    });
    expect(result.output).toBe("https://replicate.delivery/pbxt/xyz/out.mp4");
  });

  it("output dạng mảng thì lấy phần tử cuối", () => {
    const result = normalizePrediction({
      ...base,
      status: "succeeded",
      output: ["https://a/1.mp4", "https://a/2.mp4"],
    });
    expect(result.output).toBe("https://a/2.mp4");
  });

  it("giữ nguyên thông báo lỗi của Replicate", () => {
    const result = normalizePrediction({
      ...base,
      status: "failed",
      error: "CUDA out of memory",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("CUDA out of memory");
  });

  it("status lạ hoặc thiếu bị coi là starting chứ không phải succeeded", () => {
    expect(normalizePrediction({ ...base, status: "gì đó" }).status).toBe(
      "starting",
    );
    expect(normalizePrediction({ id: "x" }).status).toBe("starting");
  });

  it("payload rác không làm vỡ", () => {
    const result = normalizePrediction(null);
    expect(result.id).toBe("");
    expect(result.status).toBe("starting");
    expect(result.output).toBe("");
  });
});

describe("isTerminal", () => {
  it("chỉ ba trạng thái kết thúc mới dừng vòng poll", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("starting")).toBe(false);
    expect(isTerminal("processing")).toBe(false);
  });
});
