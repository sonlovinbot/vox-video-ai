import { describe, expect, it } from "vitest";
import {
  MAX_PINNED_STYLE,
  MAX_SLOTS,
  buildReferenceOrderBlock,
  emptyRefPlan,
  parseRefPlanFromAI,
  refPlanIssues,
} from "./casting";
import type { ReferenceAsset, SearchedImage } from "../types";

function ref(
  id: string,
  role: ReferenceAsset["role"],
  name = `${id}.png`,
): ReferenceAsset {
  return { id, name, type: "image/png", size: 1, previewUrl: "", role, notes: "" };
}

const box = ref("a", "subject", "thung-hang.png");
const girl = ref("b", "character", "co-gai.png");
const style = ref("c", "style", "style-ref.png");
const street = ref("d", "environment", "pho.png");

const searched: SearchedImage[] = [
  {
    id: "s1",
    source: "pexels",
    thumbUrl: "https://x/t.jpg",
    fullUrl: "https://x/f.jpg",
    cachedUrl: "",
    attribution: "Ảnh: Ai Đó / Pexels",
    sourcePage: "https://pexels.com/photo/1",
  },
];

describe("parseRefPlanFromAI", () => {
  it("bỏ index ngoài phạm vi và index trỏ vào ref style", () => {
    const plan = parseRefPlanFromAI(
      { useUploads: [1, 3, 99, 0, -2], searchQuery: "", newElements: [] },
      [box, girl, style],
      true,
    );
    const uploads = plan.slots.filter((slot) => !slot.pinned);
    expect(uploads.map((slot) => slot.assetId)).toEqual(["a"]);
  });

  it("ghim style ref kể cả khi AI không nhắc tới", () => {
    const plan = parseRefPlanFromAI(
      { useUploads: [], searchQuery: "", newElements: [] },
      [box, style],
      true,
    );
    const pinned = plan.slots.filter((slot) => slot.pinned);
    expect(pinned).toHaveLength(1);
    expect(pinned[0].assetId).toBe("c");
    expect(pinned[0].lock).toBe("style");
  });

  it("ghim tối đa MAX_PINNED_STYLE ảnh style", () => {
    const styles = [
      ref("s-1", "style"),
      ref("s-2", "style"),
      ref("s-3", "style"),
      ref("s-4", "style"),
    ];
    const plan = parseRefPlanFromAI(
      { useUploads: [], searchQuery: "", newElements: [] },
      styles,
      true,
    );
    expect(plan.slots.filter((slot) => slot.pinned)).toHaveLength(
      MAX_PINNED_STYLE,
    );
  });

  it("gán lock theo role của upload", () => {
    const plan = parseRefPlanFromAI(
      { useUploads: [1, 2, 3], searchQuery: "", newElements: [] },
      [box, girl, street],
      true,
    );
    expect(plan.slots.map((slot) => slot.lock)).toEqual([
      "identity",
      "identity",
      "content",
    ]);
  });

  it("cắt còn MAX_SLOTS theo ưu tiên style ghim → identity → content", () => {
    const many = [
      ref("u1", "subject"),
      ref("u2", "character"),
      ref("u3", "subject"),
      ref("u4", "environment"),
      ref("u5", "environment"),
      ref("u6", "environment"),
      style,
    ];
    const plan = parseRefPlanFromAI(
      { useUploads: [1, 2, 3, 4, 5, 6], searchQuery: "", newElements: [] },
      many,
      true,
    );
    expect(plan.slots).toHaveLength(MAX_SLOTS);
    expect(plan.slots.filter((slot) => slot.pinned)).toHaveLength(1);
    expect(plan.slots.filter((slot) => slot.lock === "identity")).toHaveLength(3);
    expect(plan.slots.filter((slot) => slot.lock === "content")).toHaveLength(1);
  });

  it("bỏ searchQuery nhưng giữ newElements khi search tắt", () => {
    const plan = parseRefPlanFromAI(
      {
        useUploads: [],
        searchQuery: "warehouse conveyor",
        newElements: ["đường tuyến giấy"],
      },
      [style],
      false,
    );
    expect(plan.searchQuery).toBe("");
    expect(plan.newElements).toEqual(["đường tuyến giấy"]);
  });

  it("giữ searchQuery khi search bật", () => {
    const plan = parseRefPlanFromAI(
      { useUploads: [], searchQuery: "warehouse conveyor", newElements: [] },
      [style],
      true,
    );
    expect(plan.searchQuery).toBe("warehouse conveyor");
  });

  it("thiếu refPlan thì chỉ ghim style, không nhét hết ref vào", () => {
    const plan = parseRefPlanFromAI(undefined, [box, girl, style], true);
    expect(plan.slots).toHaveLength(1);
    expect(plan.slots[0].assetId).toBe("c");
    expect(plan.slots[0].pinned).toBe(true);
  });
});

describe("emptyRefPlan", () => {
  it("chỉ chứa style ref đã ghim", () => {
    const plan = emptyRefPlan([box, girl, style]);
    expect(plan.slots.map((slot) => slot.assetId)).toEqual(["c"]);
    expect(plan.status).toBe("pending");
  });

  it("không có style ref thì slots rỗng", () => {
    expect(emptyRefPlan([box]).slots).toEqual([]);
  });
});

describe("buildReferenceOrderBlock", () => {
  it("sinh đúng luật cho từng tầng lock", () => {
    const plan = parseRefPlanFromAI(
      { useUploads: [1], searchQuery: "", newElements: [] },
      [box, style],
      true,
    );
    const block = buildReferenceOrderBlock(plan, [box, style], []);
    expect(block).toContain("IDENTITY LOCK");
    expect(block).toContain("STYLE LOCK");
    expect(block).toContain("Do not redesign");
    expect(block).toContain("adopt paper medium");
  });

  it("ảnh searched dùng CONTENT LOCK và bắt vẽ lại thành giấy", () => {
    const plan = emptyRefPlan([]);
    plan.slots.push({
      id: "slot-1",
      kind: "searched",
      assetId: "s1",
      lock: "content",
      reason: "",
      pinned: false,
    });
    const block = buildReferenceOrderBlock(plan, [], searched);
    expect(block).toContain("CONTENT LOCK");
    expect(block).toContain("Redraw entirely as cut paper");
    expect(block).not.toContain("IDENTITY LOCK");
  });

  it("thứ tự dòng khớp chính xác thứ tự slots", () => {
    const plan = parseRefPlanFromAI(
      { useUploads: [1, 2], searchQuery: "", newElements: [] },
      [box, girl, style],
      true,
    );
    const block = buildReferenceOrderBlock(plan, [box, girl, style], []);
    const lines = block
      .split("\n")
      .filter((line) => /^\d+\./.test(line.trim()));
    expect(lines).toHaveLength(plan.slots.length);
    plan.slots.forEach((slot, index) => {
      const asset = [box, girl, style].find((item) => item.id === slot.assetId);
      expect(lines[index]).toContain(asset!.name);
    });
  });

  it("không có slot nào thì báo rõ là dựng hoàn toàn mới", () => {
    const block = buildReferenceOrderBlock(emptyRefPlan([]), [], []);
    expect(block).toContain("No reference images");
  });
});

describe("refPlanIssues", () => {
  it("cảnh báo khi vượt MAX_SLOTS", () => {
    const plan = emptyRefPlan([style]);
    for (let index = 0; index < MAX_SLOTS; index += 1) {
      plan.slots.push({
        id: `x${index}`,
        kind: "upload",
        assetId: "a",
        lock: "identity",
        reason: "",
        pinned: false,
      });
    }
    expect(refPlanIssues(plan).join(" ")).toContain("5");
  });

  it("cảnh báo khi không có ref nội dung và cũng không có element mới", () => {
    expect(refPlanIssues(emptyRefPlan([style])).join(" ")).toMatch(/nội dung/i);
  });

  it("không cảnh báo khi chỉ có style nhưng đã khai newElements", () => {
    const plan = emptyRefPlan([style]);
    plan.newElements = ["đường tuyến giấy"];
    expect(refPlanIssues(plan)).toEqual([]);
  });

  it("cảnh báo khi plan lỗi", () => {
    const plan = emptyRefPlan([style]);
    plan.newElements = ["x"];
    plan.status = "failed";
    plan.error = "Pexels quá tải";
    expect(refPlanIssues(plan).join(" ")).toContain("Pexels quá tải");
  });
});
