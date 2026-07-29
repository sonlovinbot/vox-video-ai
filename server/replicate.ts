import { MAX_FRAMES, MIN_FRAMES } from "../src/lib/video";
import type { VideoSettings } from "../src/types";

/**
 * Dựng payload và đọc kết quả của Replicate.
 *
 * Module thuần: không đụng express, không đọc process.env, không gọi mạng — để
 * test bằng payload cố định, cùng khuôn với server/imageSearch.ts.
 */

export type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

const STATUSES: PredictionStatus[] = [
  "starting",
  "processing",
  "succeeded",
  "failed",
  "canceled",
];

export interface NormalizedPrediction {
  id: string;
  status: PredictionStatus;
  output: string;
  error: string;
  getUrl: string;
  cancelUrl: string;
}

/** Tên field lấy đúng theo openapi schema của wan-video/wan-2.2-i2v-fast. */
export function buildPredictionInput(
  prompt: string,
  imageUrl: string,
  frames: number,
  settings: VideoSettings,
  seed?: number,
) {
  const input: Record<string, unknown> = {
    prompt,
    image: imageUrl,
    num_frames: Math.min(Math.max(Math.round(frames), MIN_FRAMES), MAX_FRAMES),
    resolution: settings.resolution,
    frames_per_second: settings.fps,
    interpolate_output: settings.interpolate,
    go_fast: settings.goFast,
    sample_shift: settings.sampleShift,
  };
  // Bỏ hẳn field seed khi không chỉ định để Replicate tự random. Kiểm tra
  // undefined chứ không kiểm truthy, vì seed 0 là giá trị hợp lệ.
  if (seed !== undefined) input.seed = seed;
  return input;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function normalizePrediction(payload: unknown): NormalizedPrediction {
  const source = (payload && typeof payload === "object" ? payload : {}) as Record<
    string,
    unknown
  >;
  const urls = (source.urls || {}) as Record<string, unknown>;
  const rawStatus = text(source.status) as PredictionStatus;

  // Wan trả output là một chuỗi URI. Model khác cùng họ trả mảng, nên nhận cả
  // hai và lấy phần tử cuối — phần tử cuối là bản đã qua interpolate.
  const rawOutput = source.output;
  const output = Array.isArray(rawOutput)
    ? text(rawOutput.at(-1))
    : text(rawOutput);

  return {
    id: text(source.id),
    // Status lạ phải rơi về starting, không phải succeeded: đoán nhầm là dừng
    // poll sớm và báo xong khi video còn chưa render.
    status: STATUSES.includes(rawStatus) ? rawStatus : "starting",
    output,
    error: text(source.error) || text((source.error as any)?.detail),
    getUrl: text(urls.get),
    cancelUrl: text(urls.cancel),
  };
}

export function isTerminal(status: PredictionStatus) {
  return status === "succeeded" || status === "failed" || status === "canceled";
}
