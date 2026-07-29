import { describe, expect, it } from "vitest";
import {
  buildPromptsFile,
  flattenPrompt,
  packageFileName,
  planExport,
} from "./exportPack";
import { buildBeatPrompts, defaultConfig, generateBeats } from "./workflow";
import type { Beat } from "../types";

/**
 * Bản sao nguyên văn parsePrompts của extension Coachio Video Flow
 * (Isfahan-auto-flow-main/prompt-parser.js). Không sửa một ký tự.
 *
 * Đây là lý do duy nhất các test dưới có giá trị: chúng chứng minh file
 * prompts.txt ta sinh ra được extension đọc thành đúng N prompt, thay vì
 * khẳng định suông về định dạng.
 */
function parsePrompts(value: string) {
  const input = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!input) return [];

  const separator = /\n[ \t]*\n/.test(input) ? /\n[ \t]*\n+/ : /\n+/;
  return input
    .split(separator)
    .map((prompt) => prompt.trim())
    .filter(Boolean);
}

function beatWithImage(index: number, image: string): Beat {
  const beats = generateBeats({ ...defaultConfig, duration: 60 });
  const beat = beats[index - 1];
  const prompts = buildBeatPrompts(defaultConfig, [], beat);
  return { ...beat, ...prompts, outputImage: image };
}

describe("flattenPrompt", () => {
  it("ép prompt nhiều dòng về một dòng liền", () => {
    const flat = flattenPrompt("CAMERA\nOne locked camera.\n\nACTION\nMove once.");
    expect(flat).toBe("CAMERA One locked camera. ACTION Move once.");
    expect(flat).not.toContain("\n");
  });

  it("gộp khoảng trắng thừa và cắt hai đầu", () => {
    expect(flattenPrompt("  a   \n\n\n   b  \t c  ")).toBe("a b c");
  });

  it("chịu được carriage return của Windows", () => {
    expect(flattenPrompt("a\r\n\r\nb")).toBe("a b");
  });

  it("chuỗi rỗng trả rỗng", () => {
    expect(flattenPrompt("")).toBe("");
    expect(flattenPrompt("   \n  \n ")).toBe("");
  });
});

describe("buildPromptsFile", () => {
  it("nối các prompt bằng đúng một dòng trống", () => {
    expect(buildPromptsFile(["a", "b", "c"])).toBe("a\n\nb\n\nc\n");
  });

  it("round-trip: extension parse ra đúng số prompt đã đưa vào", () => {
    const prompts = ["một", "hai", "ba", "bốn"];
    expect(parsePrompts(buildPromptsFile(prompts))).toEqual(prompts);
  });

  it("round-trip với motion prompt thật của VOX", () => {
    const beats = [1, 2, 3].map((index) =>
      beatWithImage(index, `/generated/b${index}.png`),
    );
    const plan = planExport(beats);
    const file = buildPromptsFile(plan.prompts);
    const parsed = parsePrompts(file);

    // Motion prompt thô có dòng trống giữa CAMERA/ACTION/TIMING; nếu không ép
    // về một dòng thì 3 beat sẽ nở thành hàng chục prompt rời.
    expect(parsed).toHaveLength(3);
    expect(parsed).toEqual(plan.prompts);
    expect(parsed[0]).toContain("B01");
    expect(parsed[1]).toContain("B02");
  });

  it("prompt thô chưa ép sẽ vỡ — đây là lỗi mà flattenPrompt ngăn", () => {
    const raw = beatWithImage(1, "/generated/b1.png").motionPrompt;
    expect(parsePrompts(raw).length).toBeGreaterThan(3);
  });
});

describe("planExport", () => {
  it("loại beat chưa có ảnh khỏi cả ảnh lẫn prompt để không lệch cặp", () => {
    const beats = [
      beatWithImage(1, "/generated/b1.png"),
      { ...beatWithImage(2, ""), outputImage: "" },
      beatWithImage(3, "/generated/b3.png"),
    ];
    const plan = planExport(beats);

    expect(plan.entries).toHaveLength(2);
    expect(plan.prompts).toHaveLength(2);
    expect(plan.skipped).toEqual([2]);
    expect(plan.entries[0].name).toBe("B01.png");
    expect(plan.entries[1].name).toBe("B03.png");
    expect(plan.prompts[0]).toContain("B01");
    expect(plan.prompts[1]).toContain("B03");
  });

  it("số ảnh luôn bằng số prompt", () => {
    const beats = [
      beatWithImage(1, "/generated/b1.png"),
      { ...beatWithImage(2, ""), outputImage: "" },
      beatWithImage(3, "https://cdn.example.com/b3.jpg"),
      { ...beatWithImage(4, ""), outputImage: "" },
    ];
    const plan = planExport(beats);
    expect(plan.entries.length).toBe(plan.prompts.length);
  });

  it("đệm số 0 để ô chọn nhiều file sắp đúng thứ tự", () => {
    const beats = Array.from({ length: 11 }, (_, index) =>
      beatWithImage(index + 1, `/generated/b${index + 1}.png`),
    );
    const names = planExport(beats).entries.map((entry) => entry.name);
    expect(names[0]).toBe("B01.png");
    expect(names[9]).toBe("B10.png");
    expect([...names].sort()).toEqual(names);
  });

  it("giữ đuôi file theo URL ảnh", () => {
    const beats = [
      beatWithImage(1, "/generated/refs/x.jpg"),
      beatWithImage(2, "https://cdn.example.com/y.webp?v=2"),
      beatWithImage(3, "https://cdn.example.com/no-extension"),
    ];
    const names = planExport(beats).entries.map((entry) => entry.name);
    expect(names).toEqual(["B01.jpg", "B02.webp", "B03.png"]);
  });

  it("không beat nào có ảnh thì plan rỗng", () => {
    const plan = planExport([{ ...beatWithImage(1, ""), outputImage: "" }]);
    expect(plan.entries).toEqual([]);
    expect(plan.prompts).toEqual([]);
    expect(plan.skipped).toEqual([1]);
  });
});

describe("packageFileName", () => {
  it("slug hoá tên dự án", () => {
    expect(packageFileName("VinFast tại Đông Nam Á")).toBe(
      "vox-vinfast-tai-dong-nam-a.zip",
    );
  });

  it("tên rỗng vẫn ra file hợp lệ", () => {
    expect(packageFileName("   ")).toBe("vox-storyboard.zip");
    expect(packageFileName("!!!")).toBe("vox-storyboard.zip");
  });
});
