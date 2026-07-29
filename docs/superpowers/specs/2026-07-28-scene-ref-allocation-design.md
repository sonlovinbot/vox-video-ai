# Phân bổ reference image theo scene + Image search (Pexels/Serper)

Ngày: 2026-07-28
Trạng thái: đã duyệt

## Vấn đề

`generateKeyframe` gửi `references.slice(0, 5)` — tất cả ảnh user upload — vào mọi
beat (`src/lib/api.ts:71`). Với dự án "hành trình đơn hàng 39k", user upload 2 ảnh
(thùng hàng + cô gái) thì cả 2 bị nhét vào cả 6 scene, kể cả scene tả kho phân loại
hoặc tuyến vận chuyển — nơi không nhân vật nào xuất hiện.

Gốc rễ nằm ở hai chỗ:

1. Không có khái niệm "beat này dùng ref nào". Ref là thuộc tính của dự án, không
   phải của beat.
2. Prompt áp một luật duy nhất cho mọi ref (`src/lib/workflow.ts:233`):
   *"Preserve subject and character references... Do not redesign identity."*
   Luật này đúng với ảnh chủ thể, sai với ảnh bối cảnh.

## Giải pháp

Ref trở thành thuộc tính của beat, có thứ tự và có tầng lock. DeepSeek đề xuất
phân bổ khi sinh kịch bản, user sửa lại ở một bước mới tên Casting trước khi
generate. Bổ sung nguồn ảnh thứ hai: Pexels (ưu tiên), Serper Images (đường lui).

## Quyết định đã chốt

| Câu hỏi | Chốt |
|---|---|
| Ai phân bổ ref | AI đề xuất, user sửa trong Casting |
| Luồng search | Auto search khi duyệt kịch bản, user chọn lại trong Casting |
| Vị trí preview | Step thứ tư riêng, giữa Script và Storyboard |
| Beat không có ref nội dung | Vẫn ghim style ref để giữ nhất quán thị giác |
| Ảnh remote đến generator | Cache ở Casting, server fetch làm đường lui |

## Data model

### Ba tầng lock

| Lock | Áp cho | Luật trong prompt |
|---|---|---|
| `identity` | Upload role `subject`, `character` | Giữ nguyên hình dáng, tỷ lệ, màu, nhãn hiệu. Không vẽ lại. |
| `style` | Upload role `style` — ghim mọi beat | Chỉ lấy chất liệu, palette, texture. Bỏ qua nội dung. |
| `content` | Pexels/Serper + upload role `environment` | Chỉ lấy bố cục và hình dạng vật thể. Phải vẽ lại thành giấy cắt. Không giữ vẻ ảnh chụp, khuôn mặt, chữ hoặc logo. |

Tầng `content` là điểm mới quan trọng nhất. Ảnh stock chỉ nói cho model biết vật
thể trông thế nào, tuyệt đối không được giữ vẻ ảnh chụp.

### Kiểu mới trong `src/types.ts`

```ts
export type RefLock = "identity" | "style" | "content";
export type RefKind = "upload" | "searched";
export type RefPlanStatus = "pending" | "searching" | "ready" | "failed";

export interface SearchedImage {
  id: string;
  source: "pexels" | "serper";
  thumbUrl: string;
  fullUrl: string;
  cachedUrl: string;
  attribution: string;
  sourcePage: string;
}

export interface BeatRefSlot {
  id: string;
  kind: RefKind;
  assetId: string;
  lock: RefLock;
  reason: string;
  pinned: boolean;
}

export interface BeatRefPlan {
  status: RefPlanStatus;
  slots: BeatRefSlot[];
  searchQuery: string;
  candidates: SearchedImage[];
  newElements: string[];
  error: string;
}
```

`Beat` thêm `refPlan: BeatRefPlan`.
`ProjectState` thêm `castingApproved: boolean` và `searchedImages: SearchedImage[]`
(pool cấp dự án, `BeatRefSlot.assetId` trỏ vào đây khi `kind === "searched"`).

### Thứ tự slots là ràng buộc cứng

Block `REFERENCE ORDER` trong prompt phải khớp chính xác thứ tự mảng ảnh gửi lên
provider. Lệch một vị trí là model gán nhầm luật lock cho ảnh. `refPlan.slots` là
nguồn sự thật duy nhất cho cả prompt lẫn payload.

## DeepSeek

Mở rộng JSON schema ở `server/index.ts:117`, mỗi beat thêm:

```json
"refPlan": {
  "useUploads": [1, 2],
  "searchQuery": "warehouse conveyor belt parcels sorting",
  "newElements": ["đường tuyến bằng giấy", "thẻ giá 39k"]
}
```

`useUploads` là số thứ tự trong reference manifest mà AI nhìn thấy
(`makeReferenceManifest`, `src/lib/workflow.ts:162`). Manifest được truyền vào
prompt DeepSeek — hiện chưa có, phải bổ sung.

Luật ép vào prompt:

- Không đưa ref `role=style` vào `useUploads`; hệ thống tự ghim.
- Chỉ đưa upload vào beat mà chủ thể đó thực sự xuất hiện trong khung hình. Beat
  tả hạ tầng, cơ chế hoặc số liệu thì `useUploads: []`.
- `searchQuery` bằng tiếng Anh, tả cảnh vật và vật thể, không tả style. Rỗng nếu
  beat trừu tượng.
- `useUploads.length + (searchQuery ? 1 : 0) <= 4`, chừa một slot cho style ghim.

Kỳ vọng với ví dụ đơn hàng 39k: B01 dùng thùng hàng; B02 dùng cô gái; B03 kho phân
loại dùng search, không dùng upload nào; B04 tuyến vận chuyển dùng `newElements`
thuần; B06 kết dùng lại cả hai upload.

## Ép luật ở client

`src/lib/casting.ts` (file mới, thuần, có test):

- `parseRefPlanFromAI(raw, references, settings)`
  1. Bỏ index không tồn tại hoặc trỏ vào ref `role=style`.
  2. Gán lock theo role: `subject`/`character` → `identity`,
     `environment` → `content`.
  3. Ghim ref `role=style` vào cuối mảng, `pinned: true`, **tối đa 2 ảnh** theo
     thứ tự user upload. Nhiều style ref hơn thì bỏ phần dư — nếu không, dự án
     có 5 ảnh style sẽ chiếm hết slot và không còn chỗ cho nội dung.
  4. Cắt còn 5 theo ưu tiên: style ghim → identity → content → searched.
  5. Nếu `imageSearchEnabled === false` thì bỏ `searchQuery`, giữ `newElements`.
- `buildReferenceOrderBlock(slots, references, searchedImages)` → text prompt.
- `refPlanIssues(beat)` → danh sách cảnh báo hiển thị trong Casting.
- `emptyRefPlan()` → plan mặc định chỉ có style ghim.

Fallback khi DeepSeek không trả `refPlan`, hoặc user dùng template offline: mọi
beat nhận `emptyRefPlan()` — chỉ style ghim, `newElements` rỗng, user tự phân
trong Casting. Không bao giờ quay lại hành vi cũ là nhét hết ref vào mọi beat.

## Backend

### Endpoint

```
POST /api/images/search  { query, aspectRatio, count } → { images: SearchedImage[], provider }
POST /api/images/cache   { url, source }               → { cachedUrl, attribution }
GET  /api/settings/status                              → thêm pexels, serper
```

### Provider

```
Pexels  GET https://api.pexels.com/v1/search
        ?query=<q>&per_page=<count>&orientation=<portrait|square|landscape>
        header Authorization: <PEXELS_API_KEY>
        → photos[].src.large2x, .src.medium, .photographer, .url

Serper  POST https://google.serper.dev/images
        header X-API-KEY: <SERPER_API_KEY>
        body   { q, num }
        → images[].imageUrl, .thumbnailUrl, .link, .source
```

Chuyển sang Serper khi và chỉ khi: Pexels trả 0 ảnh, `PEXELS_API_KEY` chưa cấu
hình, hoặc Pexels lỗi/quota. `orientation` suy từ `config.aspectRatio`.

Cả hai dùng `fetchWithRetry` sẵn có (`server/index.ts:50`).

`normalizePexels` và `normalizeSerper` chuyển về cùng shape `SearchedImage`. Hai
hàm này nằm ở module riêng `server/imageSearch.ts` (thuần, không đụng `express`
và không đọc `process.env`) để test bằng payload cố định.

### Caching

`/api/images/cache` tải ảnh về `generated/refs/<uuid>.<ext>`, trả path local.

Chốt chặn bắt buộc:

- Cap 8MB mỗi ảnh; chỉ nhận `content-type: image/*`.
- Timeout 15 giây.
- Chỉ cho phép scheme `https:`. Chặn `file:`, `data:`, hostname là IP nội bộ hoặc
  `localhost`. Server đang fetch URL do bên thứ ba cung cấp — đây là bề mặt SSRF.

Cache chạy lúc user chốt ảnh ở Casting, không phải lúc generate. Ảnh Serper hay
403 hoặc hết hạn; lộ lỗi ở màn preview tốt hơn chết giữa lượt generate 36 ảnh.

`generated/` đã nằm trong `.gitignore` nên `generated/refs/` được che sẵn.

### Đổi contract `/api/image/generate`

Thay `referenceImages: string[]` bằng:

```ts
slots: Array<
  | { kind: "upload";   dataUrl: string }
  | { kind: "searched"; url: string }
>
```

Server duyệt theo đúng thứ tự mảng: `upload` dùng data URL sẵn có; `searched` đọc
từ `generated/refs/`, fetch remote nếu cache miss. Sau đó đi đường cũ —
`uploadCoachioImage` cho Coachio, `inlineData` cho Gemini. Logic fallback
Coachio → Gemini không đổi.

Breaking change nội bộ; repo chưa có commit code nên không có backward-compat.

## Settings

```ts
imageSearchEnabled: boolean;  // mặc định false
imageSearchCount: number;     // 6
```

Toggle trong `SettingsDialog` cạnh hàng provider hiện có, kèm dòng trạng thái
"Pexels ✓ · Serper ✓" đọc từ `/api/settings/status`. Tắt thì client bỏ qua
`searchQuery` và ẩn nút "Tìm ảnh" ở Casting.

`.env.local` và `.env.example` thêm `PEXELS_API_KEY`, `SERPER_API_KEY`.

## Bản quyền

Pexels license cho dùng thương mại miễn phí, không bắt buộc ghi nguồn. Serper trả
kết quả Google Images — ảnh có bản quyền bất kỳ, không có license.

Ảnh chỉ làm content reference rồi bị vẽ lại thành giấy cắt nên rủi ro thấp hơn
dùng trực tiếp, nhưng hệ thống phải để user luôn nhìn thấy mình đang dùng gì:

- Lưu `attribution` và `sourcePage` cho mọi ảnh.
- Badge nguồn trên mọi slot trong Casting.
- Ảnh Serper có nhãn cảnh báo: "ảnh web, chưa rõ bản quyền — chỉ dùng làm tham
  chiếu bố cục".

## Màn Casting

`StepId` thành `"setup" | "script" | "casting" | "storyboard"`. Casting mở khóa
khi `scriptApproved`; Storyboard mở khóa khi `castingApproved`.

### File mới

```
src/lib/casting.ts
src/lib/casting.test.ts
src/components/CastingStep.tsx
src/components/RefSlotStrip.tsx
src/components/ImageSearchDialog.tsx
```

`App.tsx` đang 2576 dòng; thêm Casting vào đó là hỏng. Chỉ tách phần đụng tới,
không refactor `SetupStep`, `ScriptStep`, `VoiceStudio`.

### Một beat trong Casting

```
B03 · 00:10–00:15 · Cơ chế                        [Tìm ảnh]
"Đơn hàng dừng ở một nơi ít ai thấy…"
Visual: Lớp newsprint xé mở, lộ băng chuyền phân loại

[ảnh STYLE 📌]  [ảnh CONTENT · Pexels ✕]  [+]
                 "beat này tả hạ tầng, không có chủ thể người"

Tự tạo mới: đường tuyến bằng giấy · thẻ giá 39k
```

Mỗi slot hiện thumbnail, badge lock, badge nguồn, lý do AI chọn. Slot ghim có icon
📌 và không xóa lẻ được. Slot thường có nút ✕.

Header màn: đếm "4/6 beat đã sẵn sàng", nút "Tự phân bổ lại", nút "Duyệt casting →
Storyboard".

Cảnh báo trong dòng, không chặn: beat quá 5 slot; beat không có ref nội dung nào
mà `newElements` cũng rỗng; ảnh cache lỗi.

### Search hàng loạt

"Tự phân bổ lại" search cho mọi beat có `searchQuery`, giới hạn 3 request đồng
thời, `refPlan.status` từng beat cập nhật riêng, beat lỗi có nút thử lại riêng.
Cùng mô hình `generatingBeatIds` mà `StoryboardStep` đang dùng (`App.tsx:1308`).

## Sửa prompt

`buildBeatPrompts` nhận thêm `slots` và sinh `REFERENCE ORDER` động:

```
REFERENCE ORDER
1. STYLE LOCK — style_ref.png: adopt paper medium, palette and texture only.
   Ignore its content.
2. CONTENT LOCK — pexels warehouse: use only layout and object shapes.
   Redraw entirely as cut paper. Do not preserve photographic look, faces,
   text or logos.

CREATE FROM SCRATCH
đường tuyến bằng giấy, thẻ giá 39k
```

Block `REFERENCE LOCK` cũ ở `src/lib/workflow.ts:233` bị bỏ — nó là gốc của lỗi.

## localStorage

`candidates` (6 ảnh × 36 beat) không được lưu. `serializeProject`
(`src/lib/storage.ts:60`) thêm luật: giữ `slots`, `searchQuery`, `newElements`;
`candidates` reset về rỗng, `status` về `"pending"` nếu đang `"searching"`. Load
lại thì search lại khi cần. Không làm vậy thì quota vỡ ở dự án 180 giây.

## Test

`src/lib/casting.test.ts`, thuần, không cần mạng:

- `parseRefPlanFromAI` bỏ index ngoài phạm vi và index trỏ vào ref style
- style ref luôn được ghim kể cả khi AI không nhắc tới
- cắt còn 5 slot đúng thứ tự ưu tiên
- `imageSearchEnabled === false` thì bỏ `searchQuery`, giữ `newElements`
- `buildReferenceOrderBlock` sinh đúng luật cho từng tầng lock, thứ tự khớp slots
- fallback khi thiếu `refPlan`: chỉ style ghim, không nhét hết ref vào

`server/imageSearch.test.ts`: `normalizePexels` và `normalizeSerper` trả cùng
shape từ payload mẫu cố định.

Test hiện có trong `src/lib/workflow.test.ts` phải tiếp tục pass.

## Ngoài phạm vi

Không đụng trong lần này, để riêng:

- Tách `App.tsx` toàn diện
- Guard quota localStorage
- Tải ảnh Coachio về local
- Test cho `storage.ts`
