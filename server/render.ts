import type { CaptionPhrase } from "../src/types";

/**
 * Sinh phụ đề ASS có karaoke và kế hoạch ghép clip.
 *
 * Phần thuần tách khỏi phần gọi ffmpeg để test được bằng chuỗi cố định.
 *
 * Dùng ASS thay vì vẽ chữ bằng drawtext: tag \k của ASS sinh ra đúng để làm
 * karaoke — libass tự tô từng chữ theo nhịp, ffmpeg burn thẳng qua bộ lọc
 * subtitles. Không cần trình duyệt, không cần render từng frame.
 */

export interface RenderStyle {
  fontName: string;
  fontSize: number;
  /** Màu chữ khi chưa đọc tới, dạng &HAABBGGRR của ASS. */
  primary: string;
  /** Màu chữ đã đọc qua — chính là màu karaoke tô. */
  highlight: string;
  outline: string;
  marginV: number;
}

export const DEFAULT_STYLE: RenderStyle = {
  // Be Vietnam Pro mang đủ bộ dấu tiếng Việt ở các weight nặng, thứ mà phần lớn
  // font geometric sans không có. libass tự rơi về font hệ thống nếu thiếu.
  fontName: "Be Vietnam Pro",
  fontSize: 62,
  primary: "&H00FFFFFF",
  highlight: "&H0000D4FF",
  outline: "&H00201A14",
  marginV: 260,
};

export interface ConcatStep {
  /** Đường dẫn clip nguồn trên đĩa. */
  file: string;
  /** Cắt từ giây thứ mấy của clip nguồn. */
  trimStart: number;
  /** Độ dài lấy ra, tính bằng giây. */
  duration: number;
  beatIndex: number;
  /** Clip ngắn hơn khoảng thời gian cần lấp; đuôi phải giữ khung cuối. */
  padSeconds: number;
}

export const SPEED_OPTIONS = [1, 1.2, 1.5] as const;

/**
 * Chia thời gian câu và từ cho tốc độ phát.
 *
 * Timeline luôn được GIỮ Ở THỜI GIAN GỐC ở mọi nơi khác; tốc độ chỉ áp một lần
 * duy nhất, ngay trước khi sinh ASS và dựng lệnh ffmpeg. Nếu nhân tốc độ vào
 * timeline từ sớm thì mỗi lần đổi tốc độ lại phải đo lại giọng đọc.
 */
export function scalePhrases(phrases: CaptionPhrase[], speed: number) {
  const rate = speed > 0 ? speed : 1;
  if (rate === 1) return phrases;
  return phrases.map((phrase) => ({
    ...phrase,
    start: phrase.start / rate,
    end: phrase.end / rate,
    words: phrase.words.map((word) => ({
      ...word,
      start: word.start / rate,
      end: word.end / rate,
    })),
  }));
}

/**
 * atempo của ffmpeg chỉ nhận 0.5–2.0 mỗi lần, nên tốc độ ngoài khoảng đó phải
 * xâu chuỗi nhiều bộ lọc. 1.2 và 1.5 lọt trong một bộ, nhưng viết tổng quát để
 * sau này thêm x2.5 không phải sửa lại.
 */
export function buildAtempoChain(speed: number) {
  let remaining = speed > 0 ? speed : 1;
  const steps: number[] = [];
  while (remaining > 2) {
    steps.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    steps.push(0.5);
    remaining /= 0.5;
  }
  steps.push(Number(remaining.toFixed(6)));
  return steps.filter((step) => step !== 1).map((step) => `atempo=${step}`);
}

/** ASS phân cách trường bằng dấu phẩy nên phải né, và nó không có escape thật. */
export function escapeAssText(text: string) {
  return String(text ?? "")
    .replace(/\\/g, "∖")
    .replace(/[\r\n]+/g, " ")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .trim();
}

/** ASS đếm thời gian theo h:mm:ss.cc — hai chữ số phần trăm giây. */
export function formatAssTime(seconds: number) {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.round((total - Math.floor(total)) * 100);
  const pad = (value: number, size = 2) => value.toString().padStart(size, "0");
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(Math.min(centis, 99))}`;
}

/**
 * Một dòng Dialogue cho mỗi câu, mỗi từ bọc trong \k<centisecond>.
 * libass tô dần từng từ đúng theo thời lượng đã đo từ Groq.
 */
export function buildKaraokeLine(phrase: CaptionPhrase) {
  if (!phrase.words.length) return escapeAssText(phrase.text);
  return phrase.words
    .map((word) => {
      const centis = Math.max(1, Math.round((word.end - word.start) * 100));
      return `{\\k${centis}}${escapeAssText(word.text)} `;
    })
    .join("")
    .trimEnd();
}

export interface OverlayInput {
  /** Nhãn nhỏ trên tiêu đề cover. */
  coverEyebrow: string;
  coverTitle: string;
  /** Cover hiện bao nhiêu giây, ĐÃ chia tốc độ. */
  coverSeconds: number;
  /** Mỗi beat một chip chương, thời gian ĐÃ chia tốc độ. */
  chapters: Array<{
    index: number;
    label: string;
    overlay?: string;
    start: number;
    end: number;
  }>;
}

/**
 * Cover và HUD dựng bằng chính ASS, không cần công cụ nào thêm.
 *
 * \pos đặt chữ tuyệt đối theo PlayRes, còn chế độ vẽ \p1 dựng được hình chữ
 * nhật cho thanh tiến độ. Nhờ vậy file render mang đúng lớp mà preview có, và
 * vẫn chỉ một binary ffmpeg.
 */
function buildOverlayEvents(
  overlay: OverlayInput,
  width: number,
  height: number,
) {
  const events: string[] = [];
  const left = Math.round(width * 0.075);
  const barTop = Math.round(height * 0.035);
  const barWidth = width - left * 2;
  const barHeight = Math.max(5, Math.round(height * 0.0035));
  const total = overlay.chapters.length || 1;
  const gap = Math.round(barWidth * 0.012);
  const cellWidth = Math.round((barWidth - gap * (total - 1)) / total);
  const last = overlay.chapters.at(-1)?.end ?? 0;

  overlay.chapters.forEach((chapter, position) => {
    // Thanh tiến độ: vẽ lại toàn bộ ở mỗi chương, ô đang chạy tô vàng.
    const cells = overlay.chapters
      .map((_, cell) => {
        const x = left + cell * (cellWidth + gap);
        const colour =
          cell === position ? "&H0000D4FF&" : cell < position ? "&H00B4B4B4&" : "&H00505050&";
        return (
          `{\\pos(0,0)\\c${colour}\\alpha&H30&\\p1}` +
          `m ${x} ${barTop} l ${x + cellWidth} ${barTop} ` +
          `l ${x + cellWidth} ${barTop + barHeight} l ${x} ${barTop + barHeight}{\\p0}`
        );
      })
      .join("");
    events.push(
      `Dialogue: 1,${formatAssTime(chapter.start)},${formatAssTime(chapter.end)},Hud,,0,0,0,,${cells}`,
    );

    const label = escapeAssText(chapter.label).toUpperCase();
    if (label) {
      events.push(
        `Dialogue: 2,${formatAssTime(chapter.start)},${formatAssTime(chapter.end)},Hud,,0,0,0,,` +
          `{\\pos(${left},${barTop + Math.round(height * 0.028)})\\an7\\b1}` +
          `{\\c&H0000D4FF&}${String(chapter.index).padStart(2, "0")}  ` +
          `{\\c&H00FFFFFF&}${label}`,
      );
    }

    const editorOverlay = escapeAssText(chapter.overlay || "");
    const overlayStart =
      position === 0
        ? Math.max(chapter.start, overlay.coverSeconds)
        : chapter.start;
    if (editorOverlay && overlayStart < chapter.end) {
      events.push(
        `Dialogue: 2,${formatAssTime(overlayStart)},${formatAssTime(chapter.end)},Overlay,,0,0,0,,` +
          `{\\pos(${Math.round(width / 2)},${Math.round(height * 0.105)})\\an8}` +
          editorOverlay,
      );
    }
  });

  const title = escapeAssText(overlay.coverTitle);
  if (title && overlay.coverSeconds > 0) {
    const end = Math.min(overlay.coverSeconds, last || overlay.coverSeconds);
    const eyebrow = escapeAssText(overlay.coverEyebrow).toUpperCase();
    if (eyebrow) {
      events.push(
        `Dialogue: 3,${formatAssTime(0)},${formatAssTime(end)},Cover,,0,0,0,,` +
          `{\\pos(${left},${Math.round(height * 0.15)})\\an7\\b1\\fs${Math.round(
            height * 0.019,
          )}\\c&H0000D4FF&}${eyebrow}`,
      );
    }
    events.push(
      `Dialogue: 3,${formatAssTime(0)},${formatAssTime(end)},Cover,,0,0,0,,` +
        `{\\pos(${left},${Math.round(height * 0.185)})\\an7\\b1}${title}`,
    );
  }
  return events;
}

export function buildAssFile(
  phrases: CaptionPhrase[],
  width: number,
  height: number,
  style: RenderStyle = DEFAULT_STYLE,
  overlay?: OverlayInput,
) {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Hai điểm dễ sai:
    // 1. SecondaryColour là màu TRƯỚC khi karaoke tô tới, PrimaryColour là màu
    //    SAU. Nghe ngược nhưng đó đúng là cách ASS định nghĩa.
    // 2. BorderStyle=3 cho nền hộp đặc thay vì chỉ viền chữ. Cần thiết vì cảnh
    //    paper-collage phần lớn là giấy màu sáng — chữ trắng có viền vẫn chìm,
    //    đúng lỗi thấy trong bản render trước.
    `Style: Vox,${style.fontName},${style.fontSize},${style.highlight},${style.primary},${style.outline},&HB4141014,-1,0,0,0,100,100,0,0,3,10,0,2,90,90,${style.marginV},1`,
    // Hud và Cover không dùng karaoke nên PrimaryColour để trắng thẳng.
    `Style: Hud,${style.fontName},${Math.round(height * 0.021)},&H00FFFFFF,&H00FFFFFF,&H00201A14,&H00000000,-1,0,0,0,100,100,2,0,1,3,0,7,0,0,0,1`,
    `Style: Overlay,${style.fontName},${Math.round(height * 0.028)},&H00FFFFFF,&H00FFFFFF,&H00201A14,&HB4141014,-1,0,0,0,100,100,0,0,3,7,0,8,90,90,0,1`,
    `Style: Cover,${style.fontName},${Math.round(height * 0.046)},&H00FFFFFF,&H00FFFFFF,&H00201A14,&H00000000,-1,0,0,0,100,100,0,0,1,5,0,7,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = phrases
    .filter((phrase) => phrase.end > phrase.start)
    .map(
      (phrase) =>
        `Dialogue: 0,${formatAssTime(phrase.start)},${formatAssTime(
          phrase.end,
        )},Vox,,0,0,0,,${buildKaraokeLine(phrase)}`,
    );

  const overlayEvents = overlay ? buildOverlayEvents(overlay, width, height) : [];
  return `${[...header, ...overlayEvents, ...events].join("\n")}\n`;
}

/**
 * Ghép clip theo biên beat thật.
 *
 * Clip Wan dài cố định theo num_frames, còn beat thì dài theo giọng đọc. Ngắn
 * hơn thì giữ khung cuối cho đủ (padSeconds), dài hơn thì cắt bớt. Nhờ pipeline
 * đã đảo voice lên trước, hai con số này thường sát nhau nên pad hiếm khi lớn.
 */
export function buildConcatPlan(
  beats: Array<{ index: number; start: number; end: number; videoUrl: string; videoDuration: number }>,
  resolveFile: (videoUrl: string) => string,
): ConcatStep[] {
  return beats
    .filter((beat) => beat.videoUrl && beat.end > beat.start)
    .map((beat) => {
      const needed = beat.end - beat.start;
      const available = beat.videoDuration || needed;
      const duration = Math.min(needed, available);
      return {
        file: resolveFile(beat.videoUrl),
        trimStart: 0,
        // 6 chữ số chứ không phải 3: làm tròn tới mili giây gây sai số nửa mili
        // mỗi clip, cộng dồn qua 36 beat là đủ lệch tiếng so với audio.
        duration: Number(duration.toFixed(6)),
        beatIndex: beat.index,
        padSeconds: Number(Math.max(0, needed - available).toFixed(6)),
      };
    });
}

export function planTotalDuration(plan: ConcatStep[]) {
  return Number(
    plan.reduce((total, step) => total + step.duration + step.padSeconds, 0).toFixed(6),
  );
}
