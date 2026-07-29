/**
 * Nhãn chương hiện lên đầu video nên phải tả NỘI DUNG beat, không phải vai trò
 * của beat trong kịch bản. "Mở đầu gây tò mò" nói cho biên kịch, không nói gì
 * cho người xem; "Về kho trung chuyển" mới là thứ họ cần.
 *
 * Luật đã đưa vào prompt DeepSeek, nhưng dự án lưu từ trước vẫn giữ nhãn cũ nên
 * cần phát hiện được để mời user đặt lại.
 */

const ROLE_WORDS = [
  "mo dau",
  "hook",
  "moc cau",
  "gay to mo",
  "boi canh",
  "cao trao",
  "cao diem",
  "van de",
  "co che",
  "bang chung",
  "ket luan",
  "ket bai",
  "chot lai",
  "payoff",
  "intro",
  "outro",
  "nhip",
  "beat",
  "layer",
  "scene",
];

const normalize = (value: string) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Nhãn mô tả vai trò kể chuyện thay vì nội dung. */
export function isNarrativeRoleLabel(job: string) {
  const text = normalize(job);
  if (!text) return true;
  // "layer1", "beat 3", "scene-02" — đánh số kỹ thuật, cũng vô nghĩa với người xem.
  if (/^(layer|beat|scene|nhip)\s*\d*$/.test(text)) return true;
  return ROLE_WORDS.some(
    (word) => text === word || text.startsWith(`${word} `) || text.endsWith(` ${word}`),
  );
}

export function beatsWithRoleLabels(beats: Array<{ index: number; job: string }>) {
  return beats.filter((beat) => isNarrativeRoleLabel(beat.job));
}
