import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  buildAssFile,
  buildConcatPlan,
  buildKaraokeLine,
  escapeAssText,
  formatAssTime,
  planTotalDuration,
  scalePhrases,
  buildAtempoChain,
} from "./render";
import type { CaptionPhrase } from "../src/types";

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "vox-render-"));
afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

const phrase = (
  text: string,
  start: number,
  end: number,
  words: Array<[string, number, number]>,
): CaptionPhrase => ({
  text,
  start,
  end,
  beatIndex: 1,
  words: words.map(([t, s, e]) => ({ text: t, start: s, end: e })),
});

/** Câu đầu thật của voice.mp3, timestamp lấy từ Groq. */
const realPhrase = phrase("Bạn nhấn đặt mua đơn 39K,", 0, 2.52, [
  ["Bạn", 0, 0.26],
  ["nhấn", 0.26, 0.48],
  ["đặt", 0.48, 0.8],
  ["mua", 0.8, 1.04],
  ["đơn", 1.04, 1.22],
  ["39K,", 1.22, 2.52],
]);

describe("formatAssTime", () => {
  it("dùng đúng định dạng h:mm:ss.cc của ASS", () => {
    expect(formatAssTime(0)).toBe("0:00:00.00");
    expect(formatAssTime(2.52)).toBe("0:00:02.52");
    expect(formatAssTime(75.3)).toBe("0:01:15.30");
    expect(formatAssTime(3661.05)).toBe("1:01:01.05");
  });

  it("số âm bị kẹp về 0 thay vì sinh timestamp vô nghĩa", () => {
    expect(formatAssTime(-5)).toBe("0:00:00.00");
  });

  it("không tràn sang 100 phần trăm giây khi làm tròn", () => {
    expect(formatAssTime(1.999)).toBe("0:00:01.99");
  });
});

describe("escapeAssText", () => {
  it("né ngoặc nhọn vì ASS dùng chúng cho tag", () => {
    expect(escapeAssText("{\\an8}xin chào")).toBe("(∖an8)xin chào");
  });

  it("gộp xuống dòng thành khoảng trắng", () => {
    expect(escapeAssText("một\nhai\r\nba")).toBe("một hai ba");
  });

  it("giữ nguyên dấu tiếng Việt", () => {
    expect(escapeAssText("Đơn hàng 39k của bạn")).toBe("Đơn hàng 39k của bạn");
  });
});

describe("buildKaraokeLine", () => {
  it("mỗi từ một tag k với số centisecond đúng", () => {
    const line = buildKaraokeLine(realPhrase);
    expect(line).toContain("{\\k26}Bạn");
    expect(line).toContain("{\\k22}nhấn");
    // 39K, kéo dài 1.3 giây vì Whisper nuốt khoảng lặng vào từ này.
    expect(line).toContain("{\\k130}39K,");
  });

  it("từ ngắn hơn 1 centisecond vẫn được ít nhất 1", () => {
    const line = buildKaraokeLine(phrase("a", 0, 0.001, [["a", 0, 0.001]]));
    expect(line).toContain("{\\k1}a");
  });

  it("câu không có word thì trả thẳng text", () => {
    expect(buildKaraokeLine(phrase("chỉ có text", 0, 1, []))).toBe("chỉ có text");
  });
});

describe("buildAssFile", () => {
  const ass = buildAssFile([realPhrase], 1080, 1920);

  it("có đủ ba section bắt buộc của ASS", () => {
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
  });

  it("khai đúng khung hình để chữ không lệch tỉ lệ", () => {
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
  });

  it("mỗi câu một dòng Dialogue với thời gian đúng", () => {
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.52,Vox");
  });

  it("bỏ câu có thời lượng bằng 0 để libass không bỏ qua âm thầm", () => {
    const out = buildAssFile([phrase("x", 5, 5, [])], 1080, 1920);
    expect(out).not.toContain("Dialogue:");
  });

  it("ffmpeg đọc được file ASS sinh ra", () => {
    const target = path.join(workDir, "caption.ass");
    fs.writeFileSync(target, ass);
    const output = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", target],
      { encoding: "utf8" },
    );
    expect(output.trim()).toBe("ass");
  });

  it("style tuỳ chỉnh đi vào file", () => {
    const out = buildAssFile([realPhrase], 1080, 1920, {
      ...DEFAULT_STYLE,
      fontName: "Be Vietnam Pro",
      fontSize: 80,
    });
    expect(out).toContain("Be Vietnam Pro,80");
  });
});

describe("buildConcatPlan", () => {
  const resolve = (url: string) => `/tmp${url}`;

  it("cắt clip dài hơn khoảng beat cần", () => {
    const plan = buildConcatPlan(
      [{ index: 1, start: 0, end: 4, videoUrl: "/v/a.mp4", videoDuration: 5.0625 }],
      resolve,
    );
    expect(plan[0].duration).toBe(4);
    expect(plan[0].padSeconds).toBe(0);
    expect(plan[0].file).toBe("/tmp/v/a.mp4");
  });

  it("clip ngắn hơn thì ghi rõ phải giữ khung cuối bao lâu", () => {
    const plan = buildConcatPlan(
      [{ index: 1, start: 0, end: 7, videoUrl: "/v/a.mp4", videoDuration: 5.0625 }],
      resolve,
    );
    expect(plan[0].duration).toBe(5.0625);
    expect(plan[0].padSeconds).toBeCloseTo(1.9375, 3);
  });

  it("bỏ beat chưa có video để không chèn khoảng đen", () => {
    const plan = buildConcatPlan(
      [
        { index: 1, start: 0, end: 4, videoUrl: "", videoDuration: 0 },
        { index: 2, start: 4, end: 8, videoUrl: "/v/b.mp4", videoDuration: 5 },
      ],
      resolve,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].beatIndex).toBe(2);
  });

  it("tổng thời lượng gồm cả phần giữ khung cuối", () => {
    const plan = buildConcatPlan(
      [
        { index: 1, start: 0, end: 4, videoUrl: "/v/a.mp4", videoDuration: 5 },
        { index: 2, start: 4, end: 11, videoUrl: "/v/b.mp4", videoDuration: 5 },
      ],
      resolve,
    );
    expect(planTotalDuration(plan)).toBe(11);
  });
});

describe("scalePhrases", () => {
  const src = [phrase("a", 0, 3, [["a", 0, 1.5], ["b", 1.5, 3]])];

  it("tốc độ 1 thì trả nguyên bản, không tạo object mới vô ích", () => {
    expect(scalePhrases(src, 1)).toBe(src);
  });

  it("x1.5 rút ngắn cả câu lẫn từng từ", () => {
    const [p] = scalePhrases(src, 1.5);
    expect(p.start).toBe(0);
    expect(p.end).toBe(2);
    expect(p.words[1].start).toBe(1);
    expect(p.words[1].end).toBe(2);
  });

  it("x1.2 giữ đúng tỉ lệ", () => {
    const [p] = scalePhrases(src, 1.2);
    expect(p.end).toBeCloseTo(2.5, 6);
  });

  it("tốc độ vô lý bị coi như 1", () => {
    expect(scalePhrases(src, 0)).toBe(src);
    expect(scalePhrases(src, -2)).toBe(src);
  });

  it("không làm hỏng thứ tự thời gian", () => {
    const [p] = scalePhrases(src, 1.5);
    expect(p.words[0].end).toBeLessThanOrEqual(p.words[1].start);
  });
});

describe("buildAtempoChain", () => {
  it("tốc độ 1 không cần bộ lọc nào", () => {
    expect(buildAtempoChain(1)).toEqual([]);
  });

  it("1.2 và 1.5 lọt trong một bộ atempo", () => {
    expect(buildAtempoChain(1.2)).toEqual(["atempo=1.2"]);
    expect(buildAtempoChain(1.5)).toEqual(["atempo=1.5"]);
  });

  it("vượt 2.0 thì xâu chuỗi vì atempo chỉ nhận tới 2 mỗi lần", () => {
    const chain = buildAtempoChain(3);
    expect(chain).toEqual(["atempo=2", "atempo=1.5"]);
    const product = chain.reduce(
      (total, step) => total * Number(step.split("=")[1]),
      1,
    );
    expect(product).toBeCloseTo(3, 6);
  });

  it("mọi tốc độ hợp lệ đều nhân lại đúng bằng chính nó", () => {
    for (const speed of [1.2, 1.5, 2, 4]) {
      const product = buildAtempoChain(speed).reduce(
        (total, step) => total * Number(step.split("=")[1]),
        1,
      );
      expect(product).toBeCloseTo(speed, 5);
    }
  });
});
