import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeTranscription } from "./groq";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Payload thật, lưu lại từ một lần gọi Groq trên voice.mp3 tiếng Việt. */
const real = JSON.parse(
  fs.readFileSync(path.join(here, "__fixtures__groq.json"), "utf8"),
);

describe("normalizeTranscription", () => {
  it("đọc được payload thật của Groq", () => {
    const result = normalizeTranscription(real);
    expect(result.duration).toBe(43.84);
    expect(result.language).toBe("Vietnamese");
    expect(result.words.length).toBeGreaterThan(10);
    expect(result.text).toContain("Bạn nhấn");
  });

  it("đổi field word của Groq thành text cho thống nhất với caption", () => {
    const [first] = normalizeTranscription(real).words;
    expect(first.text).toBe("Bạn");
    expect(first.start).toBe(0);
    expect(first.end).toBe(0.26);
  });

  it("giữ nguyên thứ tự và tính liên tục của timestamp", () => {
    const { words } = normalizeTranscription(real);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index].start).toBeGreaterThanOrEqual(words[index - 1].start);
      expect(words[index].end).toBeGreaterThanOrEqual(words[index].start);
    }
  });

  it("bỏ từ rỗng và từ chỉ có khoảng trắng", () => {
    const result = normalizeTranscription({
      words: [
        { word: "  ", start: 0, end: 1 },
        { word: "ok", start: 1, end: 2 },
        { word: "", start: 2, end: 3 },
      ],
    });
    expect(result.words).toHaveLength(1);
    expect(result.words[0].text).toBe("ok");
  });

  it("kẹp end nhỏ hơn start để không ra thời lượng âm", () => {
    const result = normalizeTranscription({
      words: [{ word: "x", start: 5, end: 2 }],
    });
    expect(result.words[0].end).toBe(5);
  });

  it("chấp nhận cả field text thay cho word", () => {
    const result = normalizeTranscription({
      words: [{ text: "xin", start: 0, end: 1 }],
    });
    expect(result.words[0].text).toBe("xin");
  });

  it("payload rác không làm vỡ", () => {
    expect(normalizeTranscription(null).words).toEqual([]);
    expect(normalizeTranscription({ words: "nope" }).words).toEqual([]);
    expect(normalizeTranscription(undefined).duration).toBe(0);
  });
});
