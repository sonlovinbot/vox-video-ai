import type { Beat } from "../types";

export type ImageRunMode = "new" | "failed";

/** Một lượt extension đủ lớn để xử lý storyboard 60 giây trong một lần. */
export const EXTENSION_IMAGE_BATCH_SIZE = 12;

export function selectImageRunCandidates(
  beats: Beat[],
  mode: ImageRunMode,
) {
  const failed = beats.filter(
    (beat) => !beat.outputImage && beat.generationStatus === "failed",
  );
  const untouched = beats.filter(
    (beat) => !beat.outputImage && beat.generationStatus !== "failed",
  );
  return mode === "failed" ? [...failed, ...untouched] : untouched;
}

export function splitImageRunWaves<T>(items: T[], size = 5) {
  const waveSize = Math.max(1, Math.floor(size) || 1);
  const waves: T[][] = [];
  for (let index = 0; index < items.length; index += waveSize) {
    waves.push(items.slice(index, index + waveSize));
  }
  return waves;
}

export function imageRunContinuation(
  beats: Beat[],
): "blocked_by_error" | "remaining" | "complete" {
  if (
    beats.some(
      (beat) => !beat.outputImage && beat.generationStatus === "failed",
    )
  ) {
    return "blocked_by_error";
  }
  return beats.some((beat) => !beat.outputImage) ? "remaining" : "complete";
}
