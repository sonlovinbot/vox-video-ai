import { describe, expect, it } from "vitest";
import { alignTokens, alignWordsToScript, tokenizeScript } from "./align";
import type { CaptionWord } from "../types";

const w = (text: string, start: number, end: number): CaptionWord => ({
  text,
  start,
  end,
});

describe("tokenizeScript", () => {
  it("tách theo khoảng trắng và bỏ chỗ trống", () => {
    expect(tokenizeScript("  Bạn nhấn   đặt mua  ")).toEqual([
      "Bạn",
      "nhấn",
      "đặt",
      "mua",
    ]);
  });
});

describe("alignTokens", () => {
  it("khớp 1-1 khi hai chuỗi giống nhau", () => {
    expect(alignTokens(["a", "b", "c"], ["a", "b", "c"])).toEqual([0, 1, 2]);
  });

  it("bỏ qua khác biệt dấu và hoa thường", () => {
    expect(alignTokens(["BẠN", "nhan"], ["bạn", "nhấn"])).toEqual([0, 1]);
  });

  it("vẫn gióng đúng khi nghe sai một từ giữa câu", () => {
    expect(alignTokens(["giao", "síp", "hàng"], ["giao", "shipper", "hàng"])).toEqual(
      [0, 1, 2],
    );
  });
});

describe("alignWordsToScript", () => {
  it("thay chữ nghe sai bằng chữ kịch bản, giữ nguyên thời gian", () => {
    const words = [w("giao", 0, 0.4), w("síp", 0.4, 0.9), w("hàng", 0.9, 1.3)];
    const result = alignWordsToScript(words, "giao shipper hàng");
    expect(result.map((x) => x.text)).toEqual(["giao", "shipper", "hàng"]);
    expect(result[1].start).toBe(0.4);
    expect(result[1].end).toBe(0.9);
  });

  it("giữ đúng chính tả và dấu của kịch bản", () => {
    const words = [w("39K,", 0, 1.3)];
    const result = alignWordsToScript(words, "39k.");
    expect(result[0].text).toBe("39k.");
  });

  it("Whisper bỏ sót từ thì nối từ đó vào từ liền trước", () => {
    const words = [w("người", 0, 0.3), w("hàng", 0.3, 0.8)];
    const result = alignWordsToScript(words, "người bán giao hàng");
    expect(result.map((x) => x.text).join(" ")).toContain("bán");
    expect(result.map((x) => x.text).join(" ")).toContain("giao");
    // Không được mất chữ nào của kịch bản.
    for (const token of ["người", "bán", "giao", "hàng"]) {
      expect(result.map((x) => x.text).join(" ")).toContain(token);
    }
  });

  it("Whisper nghe thừa thì bỏ chữ nhưng giữ khoảng thời gian", () => {
    const words = [w("a", 0, 0.3), w("ừm", 0.3, 0.6), w("b", 0.6, 1)];
    const result = alignWordsToScript(words, "a b");
    expect(result.map((x) => x.text)).toEqual(["a", "b"]);
    expect(result.at(-1)?.end).toBe(1);
  });

  it("đuôi kịch bản không nghe thấy vẫn được gắn vào từ cuối", () => {
    const words = [w("xin", 0, 0.4)];
    const result = alignWordsToScript(words, "xin chào các bạn");
    expect(result[0].text).toBe("xin chào các bạn");
  });

  it("thời gian luôn không giảm sau khi gióng", () => {
    const words = [w("a", 0, 0.3), w("x", 0.3, 0.6), w("c", 0.6, 1.2)];
    const result = alignWordsToScript(words, "a b c");
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].start);
      expect(result[i].end).toBeGreaterThanOrEqual(result[i].start);
    }
  });

  it("kịch bản rỗng thì trả nguyên bản Whisper", () => {
    const words = [w("a", 0, 1)];
    expect(alignWordsToScript(words, "")).toEqual(words);
  });

  it("không từ nào thì trả mảng rỗng", () => {
    expect(alignWordsToScript([], "abc")).toEqual([]);
  });

  it("câu thật: sửa được lỗi nghe nhầm mà không lệch giờ", () => {
    const words = [
      w("Kiện", 0, 0.3),
      w("hàng", 0.3, 0.6),
      w("bàn", 0.6, 0.9),
      w("giao", 0.9, 1.2),
      w("cho", 1.2, 1.4),
      w("síp", 1.4, 1.7),
      w("bơ", 1.7, 2.0),
    ];
    const result = alignWordsToScript(
      words,
      "Kiện hàng bàn giao cho shipper",
    );
    expect(result.map((x) => x.text).join(" ")).toBe(
      "Kiện hàng bàn giao cho shipper",
    );
    expect(result[0].start).toBe(0);
    expect(result.at(-1)?.end).toBeCloseTo(2.0, 5);
  });
});
