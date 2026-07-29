import type {
  AppSettings,
  Beat,
  BeatRefSlot,
  ProjectConfig,
  ProviderStatus,
  ReferenceAsset,
  SearchedImage,
} from "../types";

export interface RawRefPlan {
  useUploads?: unknown;
  searchQuery?: unknown;
  newElements?: unknown;
}

type ScriptBeat = Pick<
  Beat,
  "job" | "narration" | "visual" | "transition" | "overlay"
> & { refPlan?: RawRefPlan };

export interface ImageGenerationResult {
  provider: "coachio" | "gemini";
  imageUrl: string;
  fallbackUsed: boolean;
  taskId?: string;
}

export interface ReferenceAnalysis {
  id: string;
  description: string;
  keywords: string[];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : `Yêu cầu thất bại (${response.status}).`,
    );
  }
  return body as T;
}

export function getProviderStatus() {
  return apiFetch<{ providers: ProviderStatus }>("/api/settings/status");
}

export function generateScriptWithAI(
  config: ProjectConfig,
  references: ReferenceAsset[],
  settings: AppSettings,
  signal?: AbortSignal,
) {
  return apiFetch<{ beats: ScriptBeat[]; model: string }>("/api/script/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config,
      model: settings.deepseekModel,
      imageSearchEnabled: settings.imageSearchEnabled,
      // Chỉ gửi metadata, không gửi ảnh — DeepSeek chỉ cần biết có gì và vai trò.
      references: references.map((asset) => ({
        name: asset.name,
        role: asset.role,
        notes: asset.notes,
        visualDescription: asset.visualDescription || "",
        visualKeywords: asset.visualKeywords || [],
      })),
    }),
    signal,
  });
}

export async function analyzeReferences(
  references: ReferenceAsset[],
  signal?: AbortSignal,
) {
  const payload = await Promise.all(
    references.slice(0, 6).map(async (asset) => ({
      id: asset.id,
      name: asset.name,
      role: asset.role,
      notes: asset.notes,
      dataUrl: await previewToDataUrl(asset),
    })),
  );
  return apiFetch<{ analyses: ReferenceAnalysis[]; model: string }>(
    "/api/references/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ references: payload }),
      signal,
    },
  );
}

export function searchImages(
  query: string,
  aspectRatio: string,
  count: number,
  signal?: AbortSignal,
) {
  return apiFetch<{ images: SearchedImage[]; provider: string }>(
    "/api/images/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, aspectRatio, count }),
      signal,
    },
  );
}

export interface VideoGenerationResult {
  url: string;
  remoteUrl: string;
  predictionId: string;
  frames: number;
  fps: number;
  durationSeconds: number;
  resolution: string;
}

/**
 * Tạo video từ keyframe của một beat.
 *
 * Huỷ bằng cách abort signal: server bắt được và gọi cancel lên Replicate, nên
 * nút Dừng thực sự dừng chứ không chỉ rời mắt khỏi request đang chạy.
 */
export function generateVideo(
  prompt: string,
  imageUrl: string,
  frames: number,
  settings: AppSettings,
  signal?: AbortSignal,
) {
  return apiFetch<VideoGenerationResult>("/api/video/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      imageUrl,
      frames,
      model: settings.replicateModel,
      settings: settings.video,
    }),
    signal,
  });
}

/** Server đóng gói vì client vướng CORS khi fetch ảnh từ Coachio. */
export async function downloadExportPackage(
  entries: Array<{ name: string; url: string }>,
  prompts: string[],
  fileName: string,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/export/package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries, prompts, fileName }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.message || `Không xuất được gói (${response.status}).`);
  }
  return response.blob();
}

export function cacheImage(url: string, signal?: AbortSignal) {
  return apiFetch<{ cachedUrl: string }>("/api/images/cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
}

async function previewToDataUrl(asset: ReferenceAsset) {
  if (asset.previewUrl.startsWith("data:")) return asset.previewUrl;
  const response = await fetch(asset.previewUrl);
  if (!response.ok) throw new Error(`Không đọc được reference ${asset.name}.`);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Không đọc được reference ${asset.name}.`));
    reader.readAsDataURL(blob);
  });
}

/**
 * Dựng payload slot theo ĐÚNG thứ tự refPlan.slots — prompt đánh số reference
 * theo thứ tự này, đổi chỗ là model áp nhầm luật lock.
 */
export async function buildSlotPayload(
  slots: BeatRefSlot[],
  references: ReferenceAsset[],
  searched: SearchedImage[],
) {
  const payload = await Promise.all(
    slots.slice(0, 5).map(async (slot) => {
      if (slot.kind === "upload") {
        const asset = references.find((item) => item.id === slot.assetId);
        if (!asset?.previewUrl) return null;
        return { kind: "upload" as const, dataUrl: await previewToDataUrl(asset) };
      }
      const image = searched.find((item) => item.id === slot.assetId);
      const url = image?.cachedUrl || image?.fullUrl;
      return url ? { kind: "searched" as const, url } : null;
    }),
  );
  return payload.filter((item) => item !== null);
}

export async function generateKeyframe(
  prompt: string,
  config: ProjectConfig,
  slots: BeatRefSlot[],
  references: ReferenceAsset[],
  searched: SearchedImage[],
  settings: AppSettings,
  signal?: AbortSignal,
) {
  return apiFetch<ImageGenerationResult>("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspectRatio: config.aspectRatio,
      resolution: settings.imageResolution,
      provider: settings.imageProvider,
      fallbackToGemini: settings.fallbackToGemini,
      coachioModel: settings.coachioModel,
      geminiModel: settings.geminiModel,
      slots: await buildSlotPayload(slots, references, searched),
    }),
    signal,
  });
}

/** Trả đường dẫn file trên máy chủ, không phải blob — blob URL chết khi F5. */
export function generateVoice(
  text: string,
  language: string,
  settings: AppSettings,
  signal?: AbortSignal,
) {
  const voiceId = language.toLowerCase().includes("việt")
    ? settings.voiceIdVi
    : settings.voiceIdEn || settings.voiceIdVi;
  return apiFetch<{ url: string; model: string }>("/api/voice/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId, model: settings.elevenLabsModel }),
    signal,
  });
}

export function transcribeVoice(audioUrl: string, language: string, signal?: AbortSignal) {
  return apiFetch<{
    words: Array<{ text: string; start: number; end: number }>;
    duration: number;
    language: string;
  }>("/api/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioUrl, language }),
    signal,
  });
}

export interface RenderResult {
  url: string;
  durationSeconds: number;
  width: number;
  height: number;
  clips: number;
  captions: boolean;
  captionFile: string;
  captionNote: string;
}

export function renderVideo(
  beats: Array<{
    index: number;
    start: number;
    end: number;
    job: string;
    overlay: string;
    videoUrl: string;
    videoDuration: number;
  }>,
  phrases: unknown[],
  audioUrl: string,
  aspectRatio: string,
  burnCaptions: boolean,
  speed: number,
  cover: { eyebrow: string; title: string; seconds: number },
  signal?: AbortSignal,
) {
  return apiFetch<RenderResult>("/api/render/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      beats,
      phrases,
      audioUrl,
      aspectRatio,
      burnCaptions,
      speed,
      cover,
    }),
    signal,
  });
}

export function suggestBrief(
  title: string,
  coverEyebrow: string,
  language: string,
  duration: number,
  settings: AppSettings,
  signal?: AbortSignal,
) {
  return apiFetch<{
    context: string;
    objective: string;
    audience: string;
    callToAction: string;
  }>("/api/brief/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      coverEyebrow,
      language,
      duration,
      model: settings.deepseekModel,
    }),
    signal,
  });
}
