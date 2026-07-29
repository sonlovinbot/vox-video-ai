import type { CaptionWord } from "../src/types";

/**
 * Chuẩn hoá kết quả transcription của Groq Whisper.
 *
 * Module thuần: không đụng express, không đọc process.env, không gọi mạng — test
 * bằng payload thật đã lưu ở server/__fixtures__groq.json.
 */

export interface NormalizedTranscription {
  words: CaptionWord[];
  duration: number;
  language: string;
  text: string;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTranscription(payload: unknown): NormalizedTranscription {
  const source = (payload && typeof payload === "object" ? payload : {}) as Record<
    string,
    unknown
  >;
  const rawWords = Array.isArray(source.words) ? source.words : [];

  const words = rawWords
    .map((item) => {
      const entry = (item || {}) as Record<string, unknown>;
      // Groq đặt tên field là "word"; ta dùng "text" cho thống nhất với caption.
      const text = String(entry.word ?? entry.text ?? "").trim();
      return { text, start: num(entry.start), end: num(entry.end) };
    })
    .filter((word) => word.text.length > 0)
    // Whisper thỉnh thoảng trả end nhỏ hơn start ở từ cuối câu; kẹp lại để mọi
    // phép tính thời lượng phía sau không ra số âm.
    .map((word) => ({ ...word, end: Math.max(word.end, word.start) }));

  return {
    words,
    duration: num(source.duration),
    language: String(source.language || ""),
    text: String(source.text || "").trim(),
  };
}
