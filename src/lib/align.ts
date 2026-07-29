import type { CaptionWord } from "../types";

/**
 * Sửa chữ của Whisper bằng kịch bản gốc, giữ nguyên thời gian của Whisper.
 *
 * Kịch bản là thứ đã được đọc thành tiếng nên nó là NGUỒN SỰ THẬT VỀ CHỮ:
 * "shipper" bị nghe thành "síp bơ" thì kịch bản biết đúng, Whisper không.
 * Ngược lại Whisper là nguồn sự thật về THỜI GIAN.
 *
 * Nên không hỏi LLM đoán lại — chỉ cần gióng hai chuỗi rồi lấy chữ của bên này
 * ghép với giờ của bên kia. Cách này tất định và test được.
 */

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

export function tokenizeScript(script: string) {
  return script.split(/\s+/).filter(Boolean);
}

/**
 * Gióng hai chuỗi token bằng quy hoạch động (Levenshtein có truy vết).
 * Trả về map: chỉ số từ Whisper -> chỉ số token kịch bản, hoặc -1 nếu thừa.
 */
export function alignTokens(heard: string[], script: string[]) {
  const a = heard.map(normalize);
  const b = script.map(normalize);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const cost = Array.from({ length: rows }, () => new Int32Array(cols));

  for (let i = 0; i < rows; i += 1) cost[i][0] = i;
  for (let j = 0; j < cols; j += 1) cost[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const same = a[i - 1] === b[j - 1];
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + (same ? 0 : 1),
        cost[i - 1][j] + 1,
        cost[i][j - 1] + 1,
      );
    }
  }

  const map = new Array<number>(a.length).fill(-1);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    const same = a[i - 1] === b[j - 1];
    if (cost[i][j] === cost[i - 1][j - 1] + (same ? 0 : 1)) {
      map[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (cost[i][j] === cost[i - 1][j] + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return map;
}

/**
 * Thay chữ nghe được bằng chữ trong kịch bản, giữ nguyên start và end.
 *
 * Token kịch bản bị Whisper bỏ sót sẽ được nối vào từ đứng trước, để không câu
 * nào mất chữ — thà caption có một từ dài hơn còn hơn thiếu chữ giữa câu.
 */
export function alignWordsToScript(
  words: CaptionWord[],
  script: string,
): CaptionWord[] {
  const tokens = tokenizeScript(script);
  if (!words.length || !tokens.length) return words;

  const map = alignTokens(
    words.map((word) => word.text),
    tokens,
  );

  const result: CaptionWord[] = [];
  let consumed = -1;

  words.forEach((word, index) => {
    const target = map[index];
    if (target < 0) {
      // Whisper nghe thừa một từ không có trong kịch bản: bỏ chữ, nhưng giữ
      // khoảng thời gian bằng cách nối vào từ trước.
      const previous = result[result.length - 1];
      if (previous) previous.end = Math.max(previous.end, word.end);
      return;
    }
    const missing = tokens.slice(consumed + 1, target);
    const text = [...missing, tokens[target]].join(" ");
    consumed = target;
    result.push({ text, start: word.start, end: word.end });
  });

  // Đuôi kịch bản mà Whisper không nghe thấy: gắn vào từ cuối cùng.
  const tail = tokens.slice(consumed + 1);
  if (tail.length && result.length) {
    const last = result[result.length - 1];
    last.text = `${last.text} ${tail.join(" ")}`;
  }

  return result;
}
