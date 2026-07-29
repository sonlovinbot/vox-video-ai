# Scene Ref Allocation + Image Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ref image trở thành thuộc tính của từng beat với ba tầng lock, có nguồn ảnh Pexels/Serper, và một bước Casting để review trước khi generate storyboard.

**Architecture:** Logic phân bổ nằm trong module thuần `src/lib/casting.ts` (có test, không đụng React/mạng). Backend thêm hai endpoint search/cache và đổi contract `/api/image/generate` từ mảng data URL phẳng sang mảng slot có thứ tự. UI thêm step thứ tư tách thành component riêng, không nhồi vào `App.tsx`.

**Tech Stack:** React 19, Vite 7, Express 5, TypeScript 5.9, Vitest 3, `@google/genai`.

**Spec:** `docs/superpowers/specs/2026-07-28-scene-ref-allocation-design.md`

## Global Constraints

- Tối đa **5 slot** mỗi beat (giới hạn của Coachio và Gemini).
- Style ref ghim tối đa **2 ảnh**; `useUploads.length + (searchQuery ? 1 : 0) <= 4`.
- Thứ tự `refPlan.slots` phải khớp chính xác thứ tự mảng ảnh gửi lên provider.
- Pexels luôn được thử trước; Serper chỉ chạy khi Pexels trả 0 ảnh, thiếu key, hoặc lỗi.
- `/api/images/cache`: chỉ scheme `https:`, chặn IP nội bộ và `localhost`, cap 8MB, timeout 15s, `content-type` phải là `image/*`.
- `candidates` không bao giờ được ghi vào localStorage.
- Toàn bộ chuỗi hiển thị cho user bằng tiếng Việt; nội dung prompt gửi model bằng tiếng Anh.
- `src/lib/workflow.test.ts` hiện có phải tiếp tục pass.

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/types.ts` (sửa) | `RefLock`, `RefKind`, `SearchedImage`, `BeatRefSlot`, `BeatRefPlan`; thêm field vào `Beat`, `ProjectState`, `AppSettings`, `ProviderStatus` |
| `src/lib/casting.ts` (mới) | Logic thuần: parse refPlan từ AI, ghim style, cắt slot, sinh block prompt, liệt kê cảnh báo |
| `src/lib/casting.test.ts` (mới) | Test cho trên |
| `src/lib/workflow.ts` (sửa) | `buildBeatPrompts` nhận slots, bỏ block `REFERENCE LOCK` phẳng |
| `server/imageSearch.ts` (mới) | `normalizePexels`, `normalizeSerper` — thuần, không đụng express/env |
| `server/imageSearch.test.ts` (mới) | Test normalizer bằng payload cố định |
| `server/index.ts` (sửa) | Endpoint search/cache, status, contract slots, DeepSeek refPlan |
| `src/lib/api.ts` (sửa) | `searchImages`, `cacheImage`; `generateKeyframe` gửi slots |
| `src/lib/settings.ts` (sửa) | `imageSearchEnabled`, `imageSearchCount` |
| `src/lib/storage.ts` (sửa) | Normalize `refPlan`, strip `candidates` khi serialize |
| `src/components/RefSlotStrip.tsx` (mới) | Dải slot của một beat |
| `src/components/ImageSearchDialog.tsx` (mới) | Lưới candidate + ô sửa query |
| `src/components/CastingStep.tsx` (mới) | Màn bước 4 |
| `src/App.tsx` (sửa) | Đăng ký step, state, wiring |
| `src/styles.css` (sửa) | Style cho Casting |
| `.env.example`, `.env.local` (sửa) | `PEXELS_API_KEY`, `SERPER_API_KEY` |

---

### Task 1: Types, settings, env

**Files:** Modify `src/types.ts`, `src/lib/settings.ts`, `.env.example`, `.env.local`

**Interfaces produced:** toàn bộ type ở bảng trên; `defaultSettings.imageSearchEnabled = false`, `imageSearchCount = 6`.

- [ ] Thêm type mới vào `src/types.ts` đúng như khối code trong spec
- [ ] `Beat` thêm `refPlan: BeatRefPlan`
- [ ] `ProjectState` thêm `castingApproved: boolean`, `searchedImages: SearchedImage[]`
- [ ] `StepId` thêm `"casting"`
- [ ] `ProviderStatus` thêm `pexels: boolean`, `serper: boolean`
- [ ] `AppSettings` thêm `imageSearchEnabled`, `imageSearchCount`; cập nhật `defaultSettings`
- [ ] Thêm hai key vào `.env.example` (placeholder) và `.env.local` (giá trị thật)
- [ ] Chạy `npx tsc -b --noEmit` — chỉ được còn lỗi ở chỗ chưa cấp `refPlan`
- [ ] Commit

### Task 2: `src/lib/casting.ts` — logic thuần (TDD)

**Files:** Create `src/lib/casting.ts`, `src/lib/casting.test.ts`

**Interfaces produced:**
```ts
emptyRefPlan(references: ReferenceAsset[]): BeatRefPlan
parseRefPlanFromAI(raw: unknown, references: ReferenceAsset[], searchEnabled: boolean): BeatRefPlan
buildReferenceOrderBlock(plan: BeatRefPlan, references: ReferenceAsset[], searched: SearchedImage[]): string
refPlanIssues(plan: BeatRefPlan): string[]
MAX_SLOTS = 5, MAX_PINNED_STYLE = 2
```

- [ ] Viết `casting.test.ts` trước, phủ đúng 6 ca trong spec
- [ ] Chạy `npm test` — phải FAIL vì module chưa tồn tại
- [ ] Viết `casting.ts` tối thiểu để pass
- [ ] Chạy `npm test` — PASS, và `workflow.test.ts` vẫn PASS
- [ ] Commit

### Task 3: Prompt dùng slots

**Files:** Modify `src/lib/workflow.ts`, `src/lib/workflow.test.ts`

- [ ] `buildBeatPrompts(config, references, beat, searched)` sinh `REFERENCE ORDER` từ `buildReferenceOrderBlock`, thêm `CREATE FROM SCRATCH` từ `newElements`
- [ ] Xóa block `REFERENCE LOCK` phẳng (dòng ~233) — gốc của lỗi
- [ ] Thêm test: prompt của beat không có content ref thì không chứa chuỗi "Preserve subject"
- [ ] Thêm test: thứ tự dòng trong `REFERENCE ORDER` khớp thứ tự `slots`
- [ ] `npm test` PASS
- [ ] Commit

### Task 4: `server/imageSearch.ts` normalizer (TDD)

**Files:** Create `server/imageSearch.ts`, `server/imageSearch.test.ts`

**Interfaces produced:**
```ts
normalizePexels(payload: unknown): SearchedImage[]
normalizeSerper(payload: unknown): SearchedImage[]
pexelsOrientation(aspectRatio: string): "portrait" | "square" | "landscape"
isSafeImageUrl(url: string): boolean
```

- [ ] Viết test với payload mẫu cố định của cả hai provider, cộng ca `isSafeImageUrl` chặn `http:`, `file:`, `localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.x`
- [ ] `npm test` FAIL
- [ ] Viết implementation
- [ ] `npm test` PASS
- [ ] Commit

### Task 5: Backend search + cache endpoint

**Files:** Modify `server/index.ts`

- [ ] `GET /api/settings/status` trả thêm `pexels`, `serper`
- [ ] `POST /api/images/search` — Pexels trước, Serper fallback, dùng `fetchWithRetry`
- [ ] `POST /api/images/cache` — tải về `generated/refs/`, áp đủ 4 chốt chặn ở Global Constraints
- [ ] `mkdirSync` cho `generated/refs`
- [ ] Kiểm thủ công bằng `curl` với server đang chạy, xác nhận trả đúng shape
- [ ] Commit

### Task 6: Contract `/api/image/generate` dùng slots

**Files:** Modify `server/index.ts`, `src/lib/api.ts`

- [ ] Server nhận `slots`, resolve theo thứ tự: `upload` → data URL; `searched` → đọc `generated/refs/`, fetch remote nếu miss
- [ ] `generateWithCoachio` và `generateWithGemini` nhận mảng data URL đã resolve — giữ nguyên logic fallback
- [ ] `src/lib/api.ts`: `generateKeyframe` gửi `slots`; thêm `searchImages`, `cacheImage`
- [ ] Commit

### Task 7: DeepSeek trả refPlan

**Files:** Modify `server/index.ts`

- [ ] Truyền reference manifest có đánh số vào prompt DeepSeek (hiện chưa có)
- [ ] Thêm khối `refPlan` vào JSON schema + 4 luật trong spec
- [ ] Nới validate: thiếu `refPlan` thì vẫn nhận beat, client tự fallback
- [ ] Commit

### Task 8: Storage

**Files:** Modify `src/lib/storage.ts`

- [ ] `normalizeBeat` cấp `refPlan` mặc định cho project cũ
- [ ] `normalizeProject` cấp `castingApproved`, `searchedImages`
- [ ] `serializeProject` xóa `candidates`, hạ `status` `"searching"` → `"pending"`
- [ ] Commit

### Task 9: Component Casting

**Files:** Create `src/components/RefSlotStrip.tsx`, `ImageSearchDialog.tsx`, `CastingStep.tsx`; modify `src/styles.css`

- [ ] `RefSlotStrip` — thumbnail, badge lock, badge nguồn, lý do, nút xóa, slot ghim có 📌
- [ ] `ImageSearchDialog` — ô query sửa được, lưới 6 candidate, badge cảnh báo bản quyền cho ảnh Serper
- [ ] `CastingStep` — header đếm tiến độ, "Tự phân bổ lại" (giới hạn 3 request đồng thời), cảnh báo trong dòng, nút duyệt
- [ ] Commit

### Task 10: Wiring `App.tsx` + verify

**Files:** Modify `src/App.tsx`

- [ ] `navItems`/`StepTabs` thêm Casting; gate `scriptApproved` → Casting → `castingApproved` → Storyboard
- [ ] Toggle `imageSearchEnabled` trong `SettingsDialog` + dòng trạng thái Pexels/Serper
- [ ] Duyệt kịch bản thì hydrate refPlan và auto-search nếu bật
- [ ] `npm test` PASS
- [ ] `npm run build` thành công
- [ ] Commit

## Self-Review

- Spec coverage: ba tầng lock (T2, T3), DeepSeek refPlan (T7), ép luật client (T2), endpoint (T5), caching + SSRF (T4, T5), contract slots (T6), settings (T1, T10), bản quyền (T9), Casting UI (T9, T10), localStorage (T8), test (T2, T3, T4). Không có mục nào của spec thiếu task.
- Type consistency: `parseRefPlanFromAI`, `buildReferenceOrderBlock`, `emptyRefPlan`, `refPlanIssues` dùng cùng tên ở T2, T3, T8, T9.
- Ngoài phạm vi (tách `App.tsx` toàn diện, quota guard, cache ảnh Coachio, test `storage.ts`) không xuất hiện trong task nào — đúng chủ ý.
