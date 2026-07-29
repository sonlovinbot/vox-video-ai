import type {
  BeatRefPlan,
  BeatRefSlot,
  RefLock,
  ReferenceAsset,
  SearchedImage,
} from "../types";

/** Coachio và Gemini đều chỉ nhận tối đa 5 ảnh reference mỗi request. */
export const MAX_SLOTS = 5;

/** Nhiều style ref hơn mức này sẽ chiếm hết slot, không còn chỗ cho nội dung. */
export const MAX_PINNED_STYLE = 2;

const lockByRole: Record<ReferenceAsset["role"], RefLock> = {
  subject: "identity",
  character: "identity",
  environment: "content",
  style: "style",
};

/** Slot nào bị cắt trước khi chạm trần MAX_SLOTS. Số nhỏ = giữ lại lâu hơn. */
const lockPriority: Record<RefLock, number> = {
  style: 0,
  identity: 1,
  content: 2,
};

function newSlot(
  kind: BeatRefSlot["kind"],
  assetId: string,
  lock: RefLock,
  reason: string,
  pinned = false,
): BeatRefSlot {
  return { id: crypto.randomUUID(), kind, assetId, lock, reason, pinned };
}

function pinnedStyleSlots(references: ReferenceAsset[]): BeatRefSlot[] {
  return references
    .filter((asset) => asset.role === "style")
    .slice(0, MAX_PINNED_STYLE)
    .map((asset) =>
      newSlot(
        "upload",
        asset.id,
        "style",
        "Style reference ghim vào mọi beat để giữ nhất quán chất liệu.",
        true,
      ),
    );
}

/**
 * Cắt còn MAX_SLOTS. Slot ghim không bao giờ bị cắt; phần còn lại rụng từ
 * lock ưu tiên thấp nhất, nhưng thứ tự trả về vẫn giữ nguyên thứ tự gốc vì
 * prompt và payload phải khớp nhau theo vị trí.
 */
export function enforceSlotCap(slots: BeatRefSlot[]): BeatRefSlot[] {
  if (slots.length <= MAX_SLOTS) return slots;
  const ranked = slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      if (a.slot.pinned !== b.slot.pinned) return a.slot.pinned ? -1 : 1;
      const byLock =
        lockPriority[a.slot.lock] - lockPriority[b.slot.lock];
      return byLock !== 0 ? byLock : a.index - b.index;
    })
    .slice(0, MAX_SLOTS);
  const keep = new Set(ranked.map((entry) => entry.index));
  return slots.filter((_, index) => keep.has(index));
}

export function emptyRefPlan(references: ReferenceAsset[]): BeatRefPlan {
  return {
    status: "pending",
    slots: pinnedStyleSlots(references),
    searchQuery: "",
    candidates: [],
    newElements: [],
    error: "",
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Chuyển gợi ý refPlan của DeepSeek thành slot đã kiểm chứng.
 *
 * Không tin AI: index ngoài phạm vi bị bỏ, index trỏ vào ref style bị bỏ (style
 * do hệ thống ghim), lock gán lại theo role thật của asset. Thiếu refPlan thì
 * rơi về emptyRefPlan — chỉ style ghim, tuyệt đối không nhét hết ref vào beat.
 */
export function parseRefPlanFromAI(
  raw: unknown,
  references: ReferenceAsset[],
  searchEnabled: boolean,
): BeatRefPlan {
  const plan = emptyRefPlan(references);
  if (!raw || typeof raw !== "object") return plan;

  const source = raw as Record<string, unknown>;

  // AI đánh số theo reference manifest, bắt đầu từ 1.
  const contentSlots = (Array.isArray(source.useUploads) ? source.useUploads : [])
    .map((value) => Number(value))
    .filter((position) => Number.isInteger(position))
    .map((position) => references[position - 1])
    .filter(
      (asset): asset is ReferenceAsset =>
        Boolean(asset) && asset.role !== "style",
    )
    .filter(
      (asset, index, list) =>
        list.findIndex((item) => item.id === asset.id) === index,
    )
    .map((asset) =>
      newSlot(
        "upload",
        asset.id,
        lockByRole[asset.role],
        `AI chọn ${asset.name} cho beat này.`,
      ),
    );

  plan.slots = enforceSlotCap([...contentSlots, ...plan.slots]);
  plan.newElements = readStringArray(source.newElements);
  plan.searchQuery = searchEnabled
    ? String(source.searchQuery ?? "").trim()
    : "";
  return plan;
}

const lockRules: Record<RefLock, string> = {
  identity:
    "IDENTITY LOCK — preserve silhouette, proportions, colors, labels and visible markings exactly. Do not redesign the subject.",
  style:
    "STYLE LOCK — adopt paper medium, palette and texture only. Ignore its content entirely.",
  content:
    "CONTENT LOCK — use only layout and object shapes. Redraw entirely as cut paper. Do not preserve the photographic look, faces, text or logos.",
};

function slotLabel(
  slot: BeatRefSlot,
  references: ReferenceAsset[],
  searched: SearchedImage[],
) {
  if (slot.kind === "upload") {
    return references.find((asset) => asset.id === slot.assetId)?.name || "reference";
  }
  const image = searched.find((item) => item.id === slot.assetId);
  return image ? `${image.source} stock photo` : "stock photo";
}

/**
 * Sinh block REFERENCE ORDER. Thứ tự dòng phải khớp chính xác thứ tự mảng ảnh
 * gửi lên provider — lệch một vị trí là model gán nhầm luật lock cho ảnh.
 */
export function buildReferenceOrderBlock(
  plan: BeatRefPlan,
  references: ReferenceAsset[],
  searched: SearchedImage[],
) {
  if (!plan.slots.length) {
    return "No reference images for this beat. Build every element from scratch in the locked paper-collage style.";
  }
  return plan.slots
    .map(
      (slot, index) =>
        `${index + 1}. ${lockRules[slot.lock]} (${slotLabel(
          slot,
          references,
          searched,
        )})`,
    )
    .join("\n");
}

export function refPlanIssues(plan: BeatRefPlan): string[] {
  const issues: string[] = [];
  if (plan.slots.length > MAX_SLOTS) {
    issues.push(
      `Beat có ${plan.slots.length} ref, vượt giới hạn ${MAX_SLOTS} của nhà cung cấp.`,
    );
  }
  const hasContent = plan.slots.some((slot) => slot.lock !== "style");
  if (!hasContent && !plan.newElements.length) {
    issues.push(
      "Beat chưa có ref nội dung nào và cũng chưa khai element tự tạo — ảnh dễ ra chung chung.",
    );
  }
  if (plan.status === "failed" && plan.error) {
    issues.push(plan.error);
  }
  return issues;
}
