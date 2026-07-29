import type { Beat, CaptionPhrase, CaptionWord, VoiceTimeline } from "../types";

/** Khoảng lặng đủ dài để coi là hết một câu, tính bằng giây. */
export const PHRASE_GAP = 0.32;

/** Caption dài hơn mức này khó đọc kịp trên màn dọc. */
export const MAX_WORDS_PER_PHRASE = 9;

/** Wan 2.2 tối đa 121 frame ở 16fps. */
export const MAX_BEAT_SECONDS = 121 / 16;

export function emptyTimeline(): VoiceTimeline {
  return {
    status: "idle",
    audioUrl: "",
    audioName: "",
    durationSeconds: 0,
    language: "",
    phrases: [],
    error: "",
    createdAt: "",
  };
}

/**
 * Gom từ thành câu theo khoảng lặng giữa hai từ.
 *
 * Cùng cách remotion/src/timeline.ts làm tay bằng ffmpeg silencedetect, nhưng lấy
 * số từ Groq nên không phải đo lại mỗi lần đổi giọng đọc.
 */
export function groupWordsIntoPhrases(
  words: CaptionWord[],
  gap = PHRASE_GAP,
  maxWords = MAX_WORDS_PER_PHRASE,
): CaptionPhrase[] {
  const phrases: CaptionPhrase[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (!current.length) return;
    phrases.push({
      text: current.map((word) => word.text).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end,
      beatIndex: 0,
      words: current,
    });
    current = [];
  };

  words.forEach((word, index) => {
    current.push(word);
    const next = words[index + 1];
    if (!next) return;
    const silence = next.start - word.end;
    // Dấu câu quan trọng ngang khoảng lặng, vì Whisper hay NUỐT khoảng lặng vào
    // từ đứng trước thay vì để trống: trong voice.mp3 thật, "39K," dài 1,3 giây
    // cho một từ và gap sau nó bằng 0, dù tai nghe rõ một nhịp ngắt.
    const endsClause = /[.!?…,;:]$/.test(word.text);
    if (silence >= gap || endsClause || current.length >= maxWords) flush();
  });
  flush();

  return phrases;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Gán câu vào beat bằng độ trùng từ với narration, quét tiến theo thứ tự.
 *
 * Không chia theo tỉ lệ thời gian: narration chính là thứ đã được đọc thành
 * tiếng, nên khớp chữ đáng tin hơn nhiều so với đoán theo vị trí.
 */
export function assignPhrasesToBeats(
  phrases: CaptionPhrase[],
  beats: Beat[],
): CaptionPhrase[] {
  if (!beats.length) return phrases.map((phrase) => ({ ...phrase, beatIndex: 0 }));

  const beatTokens = beats.map((beat) => new Set(normalize(beat.narration)));
  let cursor = 0;

  return phrases.map((phrase) => {
    const tokens = normalize(phrase.text);
    let best = cursor;
    let bestScore = -1;

    // Chỉ nhìn tới trước, không lùi: lời thoại đọc theo thứ tự kịch bản.
    for (let index = cursor; index < Math.min(cursor + 3, beats.length); index += 1) {
      const score = tokens.filter((token) => beatTokens[index].has(token)).length;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    cursor = best;
    return { ...phrase, beatIndex: beats[best].index };
  });
}

/** Đặt lại biên beat theo giọng đọc thật thay vì chia đều theo lý thuyết. */
export function applyTimelineToBeats(
  beats: Beat[],
  phrases: CaptionPhrase[],
): Beat[] {
  return beats.map((beat) => {
    const own = phrases.filter((phrase) => phrase.beatIndex === beat.index);
    if (!own.length) return beat;
    return {
      ...beat,
      start: Number(own[0].start.toFixed(2)),
      end: Number(own[own.length - 1].end.toFixed(2)),
    };
  });
}

export function totalDuration(phrases: CaptionPhrase[]) {
  return phrases.length ? phrases[phrases.length - 1].end : 0;
}

export function timelineIssues(timeline: VoiceTimeline, beats: Beat[]) {
  const issues: string[] = [];
  if (timeline.status !== "ready") return issues;

  const covered = new Set(timeline.phrases.map((phrase) => phrase.beatIndex));
  const orphans = beats.filter((beat) => !covered.has(beat.index));
  if (orphans.length) {
    issues.push(
      `Beat ${orphans
        .map((beat) => `B${beat.index.toString().padStart(2, "0")}`)
        .join(", ")} không khớp được câu nào trong giọng đọc.`,
    );
  }

  const tooLong = beats.filter(
    (beat) => beat.end - beat.start > MAX_BEAT_SECONDS,
  );
  if (tooLong.length) {
    issues.push(
      `Beat ${tooLong
        .map((beat) => `B${beat.index.toString().padStart(2, "0")}`)
        .join(", ")} dài hơn ${MAX_BEAT_SECONDS.toFixed(
        1,
      )} giây — Wan không dựng nổi một clip dài vậy, hãy tách beat hoặc rút lời.`,
    );
  }
  return issues;
}
