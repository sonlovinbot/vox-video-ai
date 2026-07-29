# Timeline từ giọng đọc, preview và render

Ngày: 2026-07-28
Trạng thái: đã duyệt

## Vấn đề

Bốn thứ hỏng hoặc thiếu, đã kiểm chứng bằng dữ liệu thật.

**1. Audio mất khi F5.** `src/App.tsx:1983` dùng `URL.createObjectURL(blob)`. Object
URL chỉ sống trong phiên trang; chỉ mỗi `audioName` (chuỗi) được lưu. Tạo lại voice
tốn thời gian và tiền ElevenLabs.

**2. Độ dài video sai từ gốc.** `num_frames` suy từ `beat.end - beat.start`, mà con
số đó là lý thuyết (`duration / beatCount`), không phải giọng đọc thật. Beat có thể
đọc mất 6,5 giây trong khi clip chỉ 5,06 giây.

**3. Prompt đang gọi lỗi vào.** Khối cuối `motionPrompt`
(`src/lib/workflow.ts`) là danh sách phủ định:

> `AVOID` No cuts, abrupt zooms, orbit, camera roll, morphing, melting, fake text…

Diffusion model xử lý phủ định kém; nhắc tên thứ mình sợ trong prompt dương làm tăng
khả năng nó xuất hiện. Đây nhiều khả năng là nguồn của méo và biến dạng.

**4. Không có đường ra video hoàn chỉnh.** Có 11 clip rời và một file voice, nhưng
không có bước ghép, không có preview, không có caption.

## Dữ kiện đã xác minh

**`wan-2.2-i2v-fast` KHÔNG có `negative_prompt`.** Đọc openapi schema thật:

| Model | `negative_prompt` | Điều khiển độ dài |
|---|---|---|
| `wan-2.2-i2v-fast` | không | `num_frames` 81–121, fps 5–30 |
| `wan-2.2-i2v-a14b` | không | như trên |
| `wan-2.5-i2v` | có | `duration` chỉ 5 hoặc 10 giây |

Nên không thể "chèn negative word" với model hiện tại, và đổi sang 2.5 thì mất quyền
khớp độ dài theo beat — thứ đang cần nhất.

**Groq whisper-large-v3 chạy tốt tiếng Việt.** Thử thật trên
`Downloads/11 vox style/remotion/public/voice.mp3`: trả 133 từ có timestamp riêng, 11
segment, `duration` 43.84 — khớp chính xác con số `AUDIO_DURATION = 43.84` mà
`remotion/src/timeline.ts` đo tay bằng `ffmpeg silencedetect`. Toàn bộ timeline viết
tay có thể tự sinh.

**`ffmpeg` có sẵn** tại `/opt/homebrew/bin/ffmpeg`.

## Quyết định đã chốt

| Câu hỏi | Chốt |
|---|---|
| Engine render | ffmpeg + ASS karaoke |
| Thứ tự pipeline | Voice trước, video sau |
| Negative prompt | Viết lại prompt dương, giữ `wan-2.2-i2v-fast` |

Lý do chọn ffmpeg thay vì Remotion hay HyperFrames: một binary thay vì Chromium 2GB
trên Railway, render vài giây thay vì vài phút, không phí giấy phép (Remotion thu
$100/tháng với công ty từ 4 người), và định dạng ASS có tag `\k` sinh ra đúng để làm
karaoke — libass tô từng chữ theo nhịp, ffmpeg burn thẳng.

Remotion vẫn dùng được, chỉ không đặt lên Railway. HyperFrames giải đúng bài toán
giấy phép nhưng phải viết lại toàn bộ composition để đổi lấy thứ ffmpeg cũng làm.

## Kiến trúc

### Đảo pipeline

```
Kịch bản → Casting → Keyframe → Voice → Groq đo timing thật
                                            ↓
                            beat.start/end cập nhật theo giọng đọc
                                            ↓
                                  Video (num_frames đúng ngay)
                                            ↓
                                    Preview → Render
```

Sửa tận gốc thay vì trim về sau. Giới hạn còn lại: Wan tối đa 121 frame ≈ 7,5 giây;
beat dài hơn phải cảnh báo ngay ở màn Voice chứ không để lộ lúc render.

### Kiểu dữ liệu mới — `src/types.ts`

```ts
export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionPhrase {
  text: string;
  start: number;
  end: number;
  beatIndex: number;      // 0 khi không gán được vào beat nào
  words: CaptionWord[];
}

export interface VoiceTimeline {
  status: "idle" | "transcribing" | "ready" | "failed";
  audioUrl: string;        // "/generated/audio/<id>.mp3" — sống qua F5
  durationSeconds: number;
  language: string;
  phrases: CaptionPhrase[];
  error: string;
  createdAt: string;
}
```

`ProjectState` thêm `timeline: VoiceTimeline`.
`Beat` thêm `apiMotionPrompt: string`.
`AppSettings` thêm `groqModel: string`, `captionsEnabled: boolean`.
`ProviderStatus` thêm `groq: boolean`.

### Logic thuần — `src/lib/timeline.ts` (mới, có test)

```ts
groupWordsIntoPhrases(words, maxGap, maxWords): CaptionPhrase[]
assignPhrasesToBeats(phrases, beats): CaptionPhrase[]
applyTimelineToBeats(beats, phrases): Beat[]   // cập nhật start/end thật
timelineIssues(timeline, beats): string[]      // beat quá 7,5 giây, beat không có lời
totalDuration(phrases): number
```

Gom từ thành câu theo khoảng lặng: khoảng cách giữa hai từ vượt `maxGap` (mặc định
0,32 giây) thì cắt câu. Đây chính là cách `remotion/src/timeline.ts` làm tay, nhưng
lấy số từ Groq thay vì `silencedetect`.

Gán câu vào beat theo thứ tự và theo độ trùng từ với `beat.narration`, không theo tỉ
lệ thời gian — narration là thứ đã đọc ra thành tiếng nên khớp chữ đáng tin hơn.

### Backend

```
POST /api/voice/generate    sửa: lưu mp3 vào generated/audio, trả { url, name }
POST /api/voice/transcribe  mới: gửi audio lên Groq, trả words + segments + duration
POST /api/render/preview    mới: sinh file ASS để preview kiểm tra (không burn)
POST /api/render/video      mới: ffmpeg trim + concat + xfade + audio + burn ASS
GET  /api/settings/status   thêm groq
```

`server/groq.ts` (mới, thuần, có test): `normalizeTranscription(payload)` →
`{ words, duration, language }`.

`server/render.ts` (mới, thuần phần sinh chuỗi, có test):
```ts
buildAssFile(phrases, style, videoSize): string   // có tag \k karaoke
buildConcatPlan(beats, phrases): ConcatStep[]     // clip nào, trim từ đâu tới đâu
escapeAssText(text): string
```
Phần thuần tách khỏi phần gọi `ffmpeg` để test được bằng chuỗi cố định.

`generated/audio/` và `generated/renders/` phục vụ bởi `express.static("/generated")`
sẵn có; `generated/` đã trong `.gitignore`.

### Prompt cho Wan — `src/lib/workflow.ts`

`buildBeatPrompts` trả thêm `apiMotionPrompt`. **`motionPrompt` giữ nguyên từng ký
tự** vì phần copy prompt và gói ZIP cho extension phải không đổi.

Khác biệt:
- Một đoạn liền, không khối chữ HOA
- Không có danh sách AVOID
- Mọi ràng buộc viết thành khẳng định: "every element stays a rigid flat paper cutout
  holding its exact printed shape, colour and position"
- Camera nói rõ là khoá và song song với poster
- Ngắn hơn đáng kể — Wan phản hồi tốt với prompt cô đọng

### Giao diện

- `BeatMediaTabs` thêm nút **Tạo lại** riêng cho từng tab: tab Ảnh tạo lại keyframe,
  tab Video tạo lại video
- Tab Storyboard đổi thứ tự: Storyboard → **Voice** → Video → **Preview**
- Màn Voice thêm nút "Đo timing bằng Groq", bảng câu kèm timestamp, cảnh báo beat quá
  7,5 giây
- `PreviewPlayer` (mới): phát clip lần lượt theo timeline, một thẻ `<audio>` làm đồng
  hồ chủ, caption karaoke vẽ bằng DOM. Không render file, sửa timing thấy ngay
- `RenderDialog` (mới): chọn có burn caption không, hiện độ dài dự kiến, gọi
  `/api/render/video`, trả link mp4

## Test

`src/lib/timeline.test.ts`: gom câu theo khoảng lặng, gán câu vào beat, cập nhật biên
beat, phát hiện beat vượt 7,5 giây, beat không có lời.

`server/groq.test.ts`: `normalizeTranscription` với payload thật đã lưu lại từ lần
gọi Groq trên `voice.mp3`.

`server/render.test.ts`: `buildAssFile` sinh đúng header và tag `\k` với số
centisecond đúng; `escapeAssText` xử lý dấu ngoặc nhọn và xuống dòng; `buildConcatPlan`
không để lệch cặp clip–câu.

Kiểm thật: render một video hoàn chỉnh, `ffprobe` xác nhận độ dài khớp audio, mở file
xem caption có chạy đúng nhịp.

## Ngoài phạm vi

- Đẩy lên Cloudflare R2
- Remotion làm bản "điện ảnh" (giữ nguyên, chạy tay, sẽ ăn cùng timeline tự sinh)
- `last_image` nối mạch giữa beat
- wan-2.5-i2v cho negative prompt thật và 1080p
