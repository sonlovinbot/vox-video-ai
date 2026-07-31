import { describe, expect, it } from "vitest";
import type { Beat } from "../types";
import { generateBeats, defaultConfig } from "./workflow";
import {
  imageRunContinuation,
  selectImageRunCandidates,
  splitImageRunWaves,
} from "./imageRuns";

function beats(count: number) {
  const source = generateBeats({ ...defaultConfig, duration: 60 });
  return Array.from({ length: count }, (_, index) => ({
    ...source[index % source.length],
    id: `beat-${index + 1}`,
    index: index + 1,
    outputImage: "",
    generationStatus: "idle",
  })) as Beat[];
}

describe("image run planning", () => {
  it("splits the entire storyboard into sequential waves of five", () => {
    expect(splitImageRunWaves(beats(12)).map((wave) => wave.length)).toEqual([
      5, 5, 2,
    ]);
  });

  it("new mode excludes failed and completed beats", () => {
    const source = beats(4);
    source[0].outputImage = "/done.png";
    source[0].generationStatus = "completed";
    source[1].generationStatus = "failed";
    expect(selectImageRunCandidates(source, "new").map((beat) => beat.id)).toEqual([
      "beat-3",
      "beat-4",
    ]);
  });

  it("retry mode runs failures first and then every untouched beat", () => {
    const source = beats(5);
    source[0].outputImage = "/done.png";
    source[0].generationStatus = "completed";
    source[3].generationStatus = "failed";
    expect(
      selectImageRunCandidates(source, "failed").map((beat) => beat.id),
    ).toEqual(["beat-4", "beat-2", "beat-3", "beat-5"]);
  });

  it("continues until complete, but blocks the next group on an error", () => {
    const source = beats(2);
    expect(imageRunContinuation(source)).toBe("remaining");
    source[0].generationStatus = "failed";
    expect(imageRunContinuation(source)).toBe("blocked_by_error");
    source[0].generationStatus = "completed";
    source[0].outputImage = "/one.png";
    source[1].generationStatus = "completed";
    source[1].outputImage = "/two.png";
    expect(imageRunContinuation(source)).toBe("complete");
  });
});
