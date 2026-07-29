import { describe, expect, it } from "vitest";
import {
  buildBeatPrompts,
  defaultConfig,
  generateBeats,
  hydrateStoryboard,
} from "./workflow";
import { parseRefPlanFromAI } from "./casting";
import type { ReferenceAsset } from "../types";

describe("workflow", () => {
  it("creates six beats for a 30 second project", () => {
    const beats = generateBeats({
      ...defaultConfig,
      duration: 30,
      context: "Sự mở rộng của xe điện tại Đông Nam Á.",
    });
    expect(beats).toHaveLength(6);
    expect(beats[0].start).toBe(0);
    expect(beats.at(-1)?.end).toBe(30);
  });

  it("keeps motion prompts silent and flat", () => {
    const beat = generateBeats(defaultConfig)[0];
    const { motionPrompt } = buildBeatPrompts(defaultConfig, [], beat);
    expect(motionPrompt).toContain("Silent video");
    expect(motionPrompt).toContain("rigid flat paper layer");
  });

  it("không áp luật preserve identity cho beat không có ref chủ thể", () => {
    const beat = generateBeats(defaultConfig)[0];
    const { imagePrompt } = buildBeatPrompts(defaultConfig, [], beat);
    expect(imagePrompt).not.toContain("Preserve subject and character");
    expect(imagePrompt).toContain("No reference images");
  });

  it("thứ tự dòng REFERENCE ORDER khớp thứ tự slots", () => {
    const references: ReferenceAsset[] = [
      {
        id: "a",
        name: "thung-hang.png",
        type: "image/png",
        size: 1,
        previewUrl: "",
        role: "subject",
        notes: "",
      },
      {
        id: "c",
        name: "style-ref.png",
        type: "image/png",
        size: 1,
        previewUrl: "",
        role: "style",
        notes: "",
      },
    ];
    const beat = generateBeats(defaultConfig, references)[0];
    beat.refPlan = parseRefPlanFromAI(
      { useUploads: [1], searchQuery: "", newElements: ["thẻ giá 39k"] },
      references,
      true,
    );
    const { imagePrompt } = buildBeatPrompts(defaultConfig, references, beat);
    const identityAt = imagePrompt.indexOf("thung-hang.png");
    const styleAt = imagePrompt.indexOf("style-ref.png");
    expect(identityAt).toBeGreaterThan(-1);
    expect(styleAt).toBeGreaterThan(identityAt);
    expect(imagePrompt).toContain("CREATE FROM SCRATCH");
    expect(imagePrompt).toContain("thẻ giá 39k");
  });

  it("hydrates every storyboard beat with both prompts", () => {
    const beats = generateBeats(defaultConfig);
    const storyboard = hydrateStoryboard(defaultConfig, [], beats);
    expect(storyboard.every((beat) => beat.imagePrompt && beat.motionPrompt)).toBe(
      true,
    );
  });
});
