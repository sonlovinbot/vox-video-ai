import { describe, expect, it } from "vitest";
import { beatsWithRoleLabels, isNarrativeRoleLabel } from "./labels";

describe("isNarrativeRoleLabel", () => {
  it("bắt được nhãn vai trò kể chuyện", () => {
    for (const bad of [
      "Mở đầu gây tò mò",
      "MỞ ĐẦU GÂY TÒ MÒ",
      "Hook",
      "Móc câu",
      "Bối cảnh",
      "Cao trào",
      "Kết luận",
      "Payoff",
      "layer1",
      "Beat 3",
      "scene 02",
    ]) {
      expect(isNarrativeRoleLabel(bad), bad).toBe(true);
    }
  });

  it("để yên nhãn tả nội dung", () => {
    for (const good of [
      "Đặt mua",
      "Xác nhận đơn",
      "Đóng gói",
      "Về kho trung chuyển",
      "Phân loại",
      "Giao tận tay",
      "Nhà máy lắp ráp",
    ]) {
      expect(isNarrativeRoleLabel(good), good).toBe(false);
    }
  });

  it("nhãn rỗng cũng coi là cần sửa", () => {
    expect(isNarrativeRoleLabel("")).toBe(true);
    expect(isNarrativeRoleLabel("   ")).toBe(true);
  });

  it("không bắt nhầm khi từ vai trò chỉ nằm giữa cụm nội dung", () => {
    expect(isNarrativeRoleLabel("Kho hàng mở cửa sớm")).toBe(false);
  });
});

describe("beatsWithRoleLabels", () => {
  it("chỉ trả beat cần đặt lại nhãn", () => {
    const beats = [
      { index: 1, job: "Mở đầu gây tò mò" },
      { index: 2, job: "Đóng gói" },
      { index: 3, job: "Kết luận" },
    ];
    expect(beatsWithRoleLabels(beats).map((b) => b.index)).toEqual([1, 3]);
  });
});
