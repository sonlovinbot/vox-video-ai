import type { Beat } from "../types";

export interface ExportEntry {
  /** Tên file trong ZIP, đệm số 0 để ô chọn nhiều file sắp đúng thứ tự. */
  name: string;
  /** URL ảnh gốc: đường dẫn /generated/... hoặc URL https của nhà cung cấp. */
  url: string;
  beatIndex: number;
}

export interface ExportPlan {
  entries: ExportEntry[];
  prompts: string[];
  /** Số thứ tự các beat bị bỏ vì chưa có keyframe. */
  skipped: number[];
}

const allowedExtensions = new Set(["png", "jpg", "jpeg", "webp"]);

/**
 * Ép prompt về một dòng liền.
 *
 * parsePrompts của extension tách prompt bằng dòng trống. Motion prompt của VOX
 * có dòng trống giữa CAMERA, ACTION và TIMING, nên nếu xuất thô thì một beat nở
 * thành hàng chục prompt rời và mọi cặp ảnh–prompt lệch hết.
 */
export function flattenPrompt(value: string) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nối các prompt bằng đúng một dòng trống — định dạng parsePrompts mong đợi. */
export function buildPromptsFile(prompts: string[]) {
  return `${prompts.join("\n\n")}\n`;
}

function imageExtension(url: string) {
  const withoutQuery = url.split(/[?#]/)[0];
  const extension = withoutQuery.split(".").pop()?.toLowerCase() || "";
  return allowedExtensions.has(extension) ? extension : "png";
}

/**
 * Chọn beat nào vào gói và ghép tên file với prompt.
 *
 * Extension ghép images[i] với prompts[i] theo chỉ số, nên beat chưa có ảnh
 * phải bị loại khỏi CẢ HAI danh sách. Chỉ loại khỏi ảnh thôi là mọi prompt phía
 * sau lệch một nấc và toàn bộ video chạy sai prompt.
 */
export function planExport(beats: Beat[]): ExportPlan {
  const entries: ExportEntry[] = [];
  const prompts: string[] = [];
  const skipped: number[] = [];

  for (const beat of beats) {
    const url = beat.outputImage?.trim();
    if (!url) {
      skipped.push(beat.index);
      continue;
    }
    entries.push({
      name: `B${beat.index.toString().padStart(2, "0")}.${imageExtension(url)}`,
      url,
      beatIndex: beat.index,
    });
    prompts.push(flattenPrompt(beat.motionPrompt));
  }

  return { entries, prompts, skipped };
}

export function packageFileName(title: string) {
  const slug =
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // đ và Đ không tách dấu qua NFD nên phải thay tay.
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "storyboard";
  return `vox-${slug}.zip`;
}
