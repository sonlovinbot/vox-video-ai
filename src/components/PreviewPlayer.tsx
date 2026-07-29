import { Pause, Play, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AspectRatio, Beat, VoiceTimeline } from "../types";

interface Segment {
  beatIndex: number;
  start: number;
  end: number;
  videoUrl: string;
  /** Clip ngắn hơn đoạn cần lấp; phần đuôi sẽ đứng hình. */
  videoDuration: number;
}

/**
 * Xem thử trong trình duyệt, không render file.
 *
 * Thẻ audio là ĐỒNG HỒ CHỦ: mọi thứ khác bám theo currentTime của nó. Làm ngược
 * lại — lấy video làm chuẩn rồi chỉnh audio — sẽ trôi dần, vì mỗi clip là một
 * file riêng và trình duyệt không đồng bộ chúng với nhau.
 *
 * Nhờ vậy sửa timing thấy ngay tức thì, không tốn giây render nào.
 */
export function PreviewPlayer({
  beats,
  timeline,
  aspectRatio,
  cover,
  speed,
}: {
  beats: Beat[];
  timeline: VoiceTimeline;
  aspectRatio: AspectRatio;
  cover: { eyebrow: string; title: string; seconds: number };
  speed: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const segments = useMemo<Segment[]>(
    () =>
      beats
        .filter((beat) => beat.video.url && beat.end > beat.start)
        .map((beat) => ({
          beatIndex: beat.index,
          start: beat.start,
          end: beat.end,
          videoUrl: beat.video.url,
          videoDuration: beat.video.durationSeconds || beat.end - beat.start,
        })),
    [beats],
  );

  const total = timeline.durationSeconds || segments.at(-1)?.end || 0;

  /**
   * Không bao giờ trả về null.
   *
   * Giữa hai beat luôn có khe hở — giọng đọc nghỉ lấy hơi, mà biên beat lại bám
   * theo lời nói. Trước đây khe đó thành khung đen, nhìn như video hỏng. Giờ
   * khe được lấp bằng clip gần nhất, giữ nguyên khung cuối của nó, đúng cách
   * dựng phim thật xử lý khoảng lặng.
   */
  const current = useMemo(() => {
    if (!segments.length) return null;
    const inside = segments.find((s) => time >= s.start && time < s.end);
    if (inside) return inside;
    const before = [...segments].reverse().find((s) => s.start <= time);
    return before ?? segments[0];
  }, [segments, time]);
  const phrase = timeline.phrases.find((p) => time >= p.start && time <= p.end + 0.2);
  const beatLabel =
    beats.find((beat) => beat.index === current?.beatIndex)?.job || "";
  const editorOverlay =
    beats.find((beat) => beat.index === current?.beatIndex)?.overlay || "";

  /**
   * Tốc độ chỉ đổi playbackRate của hai thẻ media.
   *
   * currentTime của audio vẫn báo theo thời gian GỐC của file bất kể tốc độ,
   * nên toàn bộ caption và HUD khớp sẵn, không phải nhân chia gì thêm.
   */
  useEffect(() => {
    const rate = speed > 0 ? speed : 1;
    if (audioRef.current) audioRef.current.playbackRate = rate;
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [speed, current]);

  // Bám clip theo đồng hồ audio. Chỉ seek khi lệch quá 0,25 giây, nếu không thì
  // mỗi lần cập nhật lại giật hình vì seek liên tục.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;
    const want = Math.min(time - current.start, current.videoDuration - 0.05);
    if (want < 0) return;
    if (Math.abs(video.currentTime - want) > 0.25) video.currentTime = want;
    if (playing && video.paused) void video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
  }, [time, current, playing]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setTime(value);
  };

  if (!timeline.audioUrl) {
    return (
      <p className="preview-empty">
        <WarningCircle size={18} />
        Chưa có voice master. Tạo voice ở tab Voice trước, rồi đo timing bằng Groq.
      </p>
    );
  }

  if (!segments.length) {
    return (
      <p className="preview-empty">
        <WarningCircle size={18} />
        Chưa beat nào có video. Dựng video ở tab Storyboard trước.
      </p>
    );
  }

  return (
    <div className="preview-player">
      <div className={`preview-stage frame-${aspectRatio.replace(":", "-")}`}>
        {current && (
          <video
            ref={videoRef}
            key={current.videoUrl}
            src={current.videoUrl}
            muted
            playsInline
            preload="auto"
          />
        )}

        {/* Cover: nhãn vàng + tiêu đề lớn trong mấy giây đầu. Đây cũng chính là
            khung đem đi làm thumbnail, nên nó phải nằm trong video thật chứ
            không phải một ảnh dựng riêng dễ lệch với nội dung. */}
        {cover.title.trim() && time < cover.seconds && (
          <div className="preview-cover">
            {cover.eyebrow.trim() && <span>{cover.eyebrow}</span>}
            <h2>{cover.title}</h2>
          </div>
        )}

        {/* Grade: tối trên và dưới để HUD và caption luôn đủ tương phản, đúng
            cách bản 39k làm. Không có lớp này thì chữ chìm vào cảnh giấy sáng. */}
        <div className="preview-grade" aria-hidden="true" />

        <div className="preview-hud">
          <div className="preview-pills">
            {segments.map((segment) => (
              <i
                key={segment.beatIndex}
                className={
                  segment.beatIndex === current?.beatIndex
                    ? "pill-active"
                    : segment.end <= time
                      ? "pill-done"
                      : ""
                }
              />
            ))}
          </div>
          <div className="preview-chapter">
            <b>{String(current?.beatIndex ?? 1).padStart(2, "0")}</b>
            <span>{beatLabel}</span>
          </div>
        </div>

        {editorOverlay.trim() && time >= cover.seconds && (
          <div className="preview-editor-overlay">{editorOverlay}</div>
        )}

        {phrase && (
          <div className="preview-caption">
            <span className="preview-caption-pill">
              {phrase.words.length ? (
                phrase.words.map((word, index) => {
                  // Ba trạng thái chứ không phải hai: từ đang đọc nổi bật hẳn,
                  // từ đã đọc sáng bình thường, từ chưa tới thì mờ.
                  const active = time >= word.start && time <= word.end;
                  const spoken = time > word.end;
                  return (
                    <span
                      key={`${word.text}-${index}`}
                      className={
                        active
                          ? "caption-word-active"
                          : spoken
                            ? "caption-word-spoken"
                            : ""
                      }
                    >
                      {word.text}
                    </span>
                  );
                })
              ) : (
                <span className="caption-word-spoken">{phrase.text}</span>
              )}
            </span>
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        src={timeline.audioUrl}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
      />

      <div className="preview-controls">
        <button className="button button-primary button-small" onClick={toggle}>
          {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
          {playing ? "Tạm dừng" : "Phát thử"}
        </button>
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.05}
          value={time}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="preview-time">
          {time.toFixed(1)}s / {total.toFixed(1)}s
          {current ? ` · B${current.beatIndex.toString().padStart(2, "0")}` : ""}
        </span>
      </div>
    </div>
  );
}
