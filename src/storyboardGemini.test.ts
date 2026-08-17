import fs from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("storyboard browser extension actions", () => {
  it("offers separate ChatGPT and Gemini generation buttons", () => {
    expect(appSource).toContain("Generate with ChatGPT");
    expect(appSource).toContain("Generate with Gemini");
    expect(appSource).toContain('generateWithExtension("chatgpt")');
    expect(appSource).toContain('generateWithExtension("gemini")');
    expect(appSource).toContain("imageProvider: extensionExecutor");
    expect(appSource).toContain("EXTENSION_IMAGE_BATCH_SIZE");
    expect(appSource).toContain("ExtensionBatchCompleteDialog");
  });
});
