import { describe, expect, it } from "vitest";
import {
  buildBeatPrompts,
  buildStylePrompt,
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
    expect(motionPrompt).toContain("one smooth continuous camera behaviour");
    expect(motionPrompt).toContain("living printed poster");
  });

  it("builds a consistent professional Vox visual bible", () => {
    const prompt = buildStylePrompt(defaultConfig, []);
    expect(prompt).toContain("risograph overprint");
    expect(prompt).toContain("foreground, midground and background");
    expect(prompt).toContain("limited palette of two chromatic inks");
    expect(prompt).toContain("not like an adjective-heavy AI collage");
  });

  it("varies shot grammar and palette between adjacent beats", () => {
    const [first, second] = generateBeats(defaultConfig);
    const firstPrompts = buildBeatPrompts(defaultConfig, [], first);
    const secondPrompts = buildBeatPrompts(defaultConfig, [], second);

    expect(firstPrompts.imagePrompt).toContain("CLOSE hero crop");
    expect(firstPrompts.imagePrompt).toContain("signal red");
    expect(secondPrompts.imagePrompt).toContain("WIDE system view");
    expect(secondPrompts.imagePrompt).toContain("cobalt blue");
    expect(firstPrompts.motionPrompt).toContain("one very slow push-in");
    expect(secondPrompts.motionPrompt).toContain("left-to-right lateral move");
    expect(firstPrompts.apiMotionPrompt).toContain("tactile risograph grain");
    expect(firstPrompts.apiMotionPrompt).toContain("confident editorial pacing");
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
