import { describe, expect, it } from "vitest";
import { updateEnvContent } from "./apiKeys";

describe("updateEnvContent", () => {
  it("updates selected keys while preserving comments and unrelated settings", () => {
    const current = [
      "# local config",
      "DEEPSEEK_API_KEY=old-key",
      "CUSTOM_SETTING=keep-me",
      "",
    ].join("\n");
    const result = updateEnvContent(current, {
      deepseek: "new-key",
      gemini: "gemini-key",
    });
    expect(result).toContain("# local config");
    expect(result).toContain('DEEPSEEK_API_KEY="new-key"');
    expect(result).toContain('GEMINI_API_KEY="gemini-key"');
    expect(result).toContain("CUSTOM_SETTING=keep-me");
    expect(result).not.toContain("old-key");
  });

  it("ignores blank values instead of erasing saved keys", () => {
    const current = "PEXELS_API_KEY=saved\n";
    expect(updateEnvContent(current, { pexels: "   " })).toBe(current);
  });

  it("removes duplicate definitions so a restart keeps the new value", () => {
    const result = updateEnvContent(
      "GEMINI_API_KEY=first\nGEMINI_API_KEY=second\n",
      { gemini: "latest" },
    );
    expect(result.match(/GEMINI_API_KEY=/g)).toHaveLength(1);
    expect(result).toContain('GEMINI_API_KEY="latest"');
  });
});
