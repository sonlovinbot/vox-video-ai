import { describe, expect, it } from "vitest";
import {
  MAX_BEAT_SECONDS,
  applyTimelineToBeats,
  assignPhrasesToBeats,
  emptyTimeline,
  groupWordsIntoPhrases,
  timelineIssues,
  totalDuration,
} from "./timeline";
import { defaultConfig, generateBeats } from "./workflow";
import type { Beat, CaptionWord } from "../types";

const word = (text: string, start: number, end: number): CaptionWord => ({
  text,
  start,
  end,
});

/** 14 từ đầu của voice.mp3 thật, lấy từ lần gọi Groq. */
const realWords: CaptionWord[] = [
  word("Bạn", 0, 0.26),
  word("nhấn", 0.26, 0.48),
  word("đặt", 0.48, 0.8),
  word("mua", 0.8, 1.04),
  word("đơn", 1.04, 1.22),
  word("39K,", 1.22, 2.52),
  word("điều", 2.52, 2.62),
  word("gì", 2.62, 2.8),
  word("xảy", 2.8, 3.04),
  word("ra", 3.04, 3.16),
  word("sau", 3.16, 3.38),
  word("đó?", 3.38, 4.06),
  word("Hệ", 4.48, 4.64),
  word("thống", 4.64, 4.86),
];

function beatWith(index: number, narration: string): Beat {
  const base = generateBeats(defaultConfig)[0];
  return { ...base, id: `beat-${index}`, index, narration, start: 0, end: 0 };
}

describe("groupWordsIntoPhrases", () => {
  it("cắt câu ở khoảng lặng dài", () => {
    const phrases = groupWordsIntoPhrases([
      word("một", 0, 0.2),
      word("hai", 0.2, 0.4),
      word("ba", 1.5, 1.7),
    ]);
    expect(phrases).toHaveLength(2);
    expect(phrases[0].text).toBe("một hai");
    expect(phrases[1].text).toBe("ba");
  });

  it("cắt câu sau dấu chấm hỏi và chấm than", () => {
    const phrases = groupWordsIntoPhrases([
      word("sao?", 0, 0.2),
      word("Vì", 0.21, 0.4),
    ]);
    expect(phrases).toHaveLength(2);
  });

  it("không để câu dài quá giới hạn từ", () => {
    const long = Array.from({ length: 25 }, (_, i) =>
      word(`t${i}`, i * 0.1, i * 0.1 + 0.09),
    );
    const phrases = groupWordsIntoPhrases(long, 0.32, 5);
    expect(phrases.every((phrase) => phrase.words.length <= 5)).toBe(true);
  });

  it("start và end của câu bám vào từ đầu và từ cuối", () => {
    const [first] = groupWordsIntoPhrases(realWords);
    expect(first.start).toBe(0);
    expect(first.end).toBe(2.52);
  });

  it("chia đúng lời thoại thật thành các câu đọc được", () => {
    const phrases = groupWordsIntoPhrases(realWords);
    expect(phrases.length).toBeGreaterThanOrEqual(3);
    expect(phrases[0].text).toContain("Bạn nhấn");
    // Khoảng lặng 0.42 giây trước "Hệ" phải tách sang câu mới.
    expect(phrases.at(-1)?.text).toBe("Hệ thống");
  });

  it("danh sách rỗng trả mảng rỗng", () => {
    expect(groupWordsIntoPhrases([])).toEqual([]);
  });
});

describe("assignPhrasesToBeats", () => {
  const beats = [
    beatWith(1, "Bạn nhấn đặt mua đơn 39k. Điều gì xảy ra sau đó?"),
    beatWith(2, "Hệ thống xác nhận đơn hàng."),
    beatWith(3, "Người bán in mã vận đơn."),
  ];

  it("gán câu vào beat có nhiều từ trùng nhất", () => {
    const phrases = assignPhrasesToBeats(groupWordsIntoPhrases(realWords), beats);
    expect(phrases[0].beatIndex).toBe(1);
    expect(phrases.at(-1)?.beatIndex).toBe(2);
  });

  it("không lùi lại beat đã qua", () => {
    const phrases = assignPhrasesToBeats(
      [
        { text: "Hệ thống xác nhận", start: 0, end: 1, beatIndex: 0, words: [] },
        { text: "Bạn nhấn đặt mua", start: 1, end: 2, beatIndex: 0, words: [] },
      ],
      beats,
    );
    expect(phrases[1].beatIndex).toBeGreaterThanOrEqual(phrases[0].beatIndex);
  });

  it("không có beat nào thì mọi câu để beatIndex 0", () => {
    const phrases = assignPhrasesToBeats(groupWordsIntoPhrases(realWords), []);
    expect(phrases.every((phrase) => phrase.beatIndex === 0)).toBe(true);
  });
});

describe("applyTimelineToBeats", () => {
  it("đặt lại biên beat theo giọng đọc thật", () => {
    const beats = [beatWith(1, "một hai"), beatWith(2, "ba bốn")];
    const phrases = [
      { text: "một hai", start: 0, end: 2.5, beatIndex: 1, words: [] },
      { text: "ba bốn", start: 2.9, end: 6.1, beatIndex: 2, words: [] },
    ];
    const applied = applyTimelineToBeats(beats, phrases);
    expect(applied[0].start).toBe(0);
    expect(applied[0].end).toBe(2.5);
    expect(applied[1].start).toBe(2.9);
    expect(applied[1].end).toBe(6.1);
  });

  it("beat không có câu nào thì giữ nguyên thời gian cũ", () => {
    const beats = [{ ...beatWith(1, "x"), start: 3, end: 9 }];
    expect(applyTimelineToBeats(beats, [])[0]).toEqual(beats[0]);
  });

  it("beat nhiều câu thì lấy từ đầu câu đầu tới cuối câu cuối", () => {
    const beats = [beatWith(1, "x")];
    const phrases = [
      { text: "a", start: 1, end: 2, beatIndex: 1, words: [] },
      { text: "b", start: 2.2, end: 4.4, beatIndex: 1, words: [] },
    ];
    const applied = applyTimelineToBeats(beats, phrases);
    expect(applied[0].start).toBe(1);
    expect(applied[0].end).toBe(4.4);
  });
});

describe("timelineIssues", () => {
  const ready = (phrases: any[]) => ({
    ...emptyTimeline(),
    status: "ready" as const,
    phrases,
  });

  it("cảnh báo beat dài hơn giới hạn của Wan", () => {
    const beats = [{ ...beatWith(1, "x"), start: 0, end: MAX_BEAT_SECONDS + 1 }];
    const issues = timelineIssues(
      ready([{ text: "x", start: 0, end: 9, beatIndex: 1, words: [] }]),
      beats,
    );
    expect(issues.join(" ")).toContain("B01");
    expect(issues.join(" ")).toMatch(/dài hơn/);
  });

  it("cảnh báo beat không khớp câu nào", () => {
    const beats = [beatWith(1, "a"), beatWith(2, "b")];
    const issues = timelineIssues(
      ready([{ text: "a", start: 0, end: 1, beatIndex: 1, words: [] }]),
      beats,
    );
    expect(issues.join(" ")).toContain("B02");
  });

  it("timeline chưa sẵn sàng thì không cảnh báo gì", () => {
    expect(timelineIssues(emptyTimeline(), [beatWith(1, "a")])).toEqual([]);
  });

  it("mọi beat khớp và đủ ngắn thì im lặng", () => {
    const beats = [{ ...beatWith(1, "a"), start: 0, end: 5 }];
    expect(
      timelineIssues(
        ready([{ text: "a", start: 0, end: 5, beatIndex: 1, words: [] }]),
        beats,
      ),
    ).toEqual([]);
  });
});

describe("totalDuration", () => {
  it("lấy mốc kết thúc của câu cuối", () => {
    expect(
      totalDuration([
        { text: "a", start: 0, end: 2, beatIndex: 1, words: [] },
        { text: "b", start: 2, end: 7.5, beatIndex: 2, words: [] },
      ]),
    ).toBe(7.5);
  });

  it("rỗng thì bằng không", () => {
    expect(totalDuration([])).toBe(0);
  });
});
