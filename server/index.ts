import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  isSafeImageUrl,
  normalizePexels,
  normalizeSerper,
  pexelsOrientation,
} from "./imageSearch";
import { createZip, type ZipEntry } from "./zip";
import { buildPromptsFile } from "../src/lib/exportPack";
import { buildPredictionInput, isTerminal, normalizePrediction } from "./replicate";
import { VIDEO_PRESETS } from "../src/lib/video";
import { normalizeTranscription } from "./groq";
import {
  buildAssFile,
  buildAtempoChain,
  buildConcatPlan,
  planTotalDuration,
  scalePhrases,
} from "./render";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import type { VideoSettings } from "../src/types";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const app = express();
const port = Number(process.env.PORT || 4174);
const coachioBaseUrl =
  process.env.COACHIO_BASE_URL || "https://api.coachio.ai/api/v1";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.resolve(currentDir, "../generated");
const refsDir = path.join(generatedDir, "refs");
const videosDir = path.join(generatedDir, "videos");
const audioDir = path.join(generatedDir, "audio");
const rendersDir = path.join(generatedDir, "renders");

app.use(express.json({ limit: "80mb" }));
fs.mkdirSync(refsDir, { recursive: true });
fs.mkdirSync(videosDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(rendersDir, { recursive: true });
app.use("/generated", express.static(generatedDir));

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new HttpError(503, `Chưa cấu hình ${name} trên máy chủ.`);
  return value;
}

async function checkedJson(response: Response, provider: string) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage =
      body?.message || body?.error?.message || body?.detail || response.statusText;
    throw new HttpError(
      response.status,
      `${provider}: ${String(providerMessage || "yêu cầu thất bại")}`,
    );
  }
  return body;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
) {
  let delay = 800;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, init);
    if (
      attempt === attempts ||
      (response.status !== 429 && response.status < 500)
    ) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2;
  }
  throw new HttpError(502, "Không thể kết nối nhà cung cấp.");
}

function dataUrlParts(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new HttpError(400, "Reference image không đúng định dạng data URL.");
  return { mimeType: match[1], data: match[2] };
}

app.get("/api/settings/status", (_request, response) => {
  response.json({
    providers: {
      coachio: Boolean(process.env.COACHIO_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
      pexels: Boolean(process.env.PEXELS_API_KEY),
      serper: Boolean(process.env.SERPER_API_KEY),
      replicate: Boolean(process.env.REPLICATE_API_TOKEN),
      groq: Boolean(process.env.GROQ_API_KEY),
    },
  });
});

async function searchPexels(query: string, count: number, aspectRatio: string) {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) return [];
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(count));
  url.searchParams.set("orientation", pexelsOrientation(aspectRatio));
  const result = await fetchWithRetry(url.toString(), {
    headers: { Authorization: apiKey },
  });
  return normalizePexels(await checkedJson(result, "Pexels"));
}

async function searchSerper(query: string, count: number) {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return [];
  const result = await fetchWithRetry("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: count }),
  });
  return normalizeSerper(await checkedJson(result, "Serper"));
}

app.post("/api/images/search", async (request, response, next) => {
  try {
    const query = String(request.body?.query || "").trim();
    const aspectRatio = String(request.body?.aspectRatio || "9:16");
    const count = Math.min(Math.max(Number(request.body?.count) || 6, 1), 12);
    if (!query) throw new HttpError(400, "Từ khoá tìm ảnh không được để trống.");
    if (!process.env.PEXELS_API_KEY && !process.env.SERPER_API_KEY) {
      throw new HttpError(503, "Chưa cấu hình PEXELS_API_KEY hoặc SERPER_API_KEY.");
    }

    // Pexels luôn được thử trước; Serper chỉ chạy khi Pexels không ra kết quả.
    let images: Awaited<ReturnType<typeof searchPexels>> = [];
    let provider = "pexels";
    try {
      images = await searchPexels(query, count, aspectRatio);
    } catch {
      images = [];
    }
    if (!images.length) {
      images = await searchSerper(query, count);
      provider = "serper";
    }
    response.json({ images: images.slice(0, count), provider });
  } catch (error) {
    next(error);
  }
});

const MAX_CACHED_IMAGE_BYTES = 8 * 1024 * 1024;

app.post("/api/images/cache", async (request, response, next) => {
  try {
    const url = String(request.body?.url || "").trim();
    if (!isSafeImageUrl(url)) {
      throw new HttpError(400, "URL ảnh không hợp lệ hoặc trỏ vào mạng nội bộ.");
    }
    const remote = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!remote.ok) {
      throw new HttpError(502, `Không tải được ảnh (${remote.status}).`);
    }
    const contentType = remote.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new HttpError(415, `URL không trả về ảnh (${contentType || "không rõ"}).`);
    }
    const buffer = Buffer.from(await remote.arrayBuffer());
    if (buffer.byteLength > MAX_CACHED_IMAGE_BYTES) {
      throw new HttpError(413, "Ảnh vượt quá 8MB.");
    }
    const extension = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";
    const fileName = `${crypto.randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(refsDir, fileName), buffer);
    response.json({ cachedUrl: `/generated/refs/${fileName}` });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      next(new HttpError(504, "Tải ảnh quá 15 giây."));
      return;
    }
    next(error);
  }
});

app.post("/api/brief/suggest", async (request, response, next) => {
  try {
    const apiKey = requireEnv("DEEPSEEK_API_KEY");
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    const model = String(request.body?.model || process.env.DEEPSEEK_MODEL || "deepseek-chat");
    const title = String(request.body?.title || "").trim();
    const label = String(request.body?.coverEyebrow || "GIẢI THÍCH").trim();
    const language = String(request.body?.language || "Tiếng Việt");
    const duration = Number(request.body?.duration) || 30;
    if (!title) throw new HttpError(400, "Chưa có tiêu đề để gợi ý.");

    const prompt = `Viết brief định hướng cho một video giải thích phong cách editorial paper-collage.

TIÊU ĐỀ: ${title}
NHÃN VIDEO: ${label}
NGÔN NGỮ: ${language}
THỜI LƯỢNG: ${duration} giây

Trả JSON: {"context":"...","objective":"...","audience":"...","callToAction":"..."}

- context: 3-5 câu nêu DỮ KIỆN nền của chủ đề, đủ để viết kịch bản mà không phải tra thêm. Nêu các công đoạn hoặc các bên tham gia theo đúng thứ tự xảy ra, vì phong cách này kể bằng từng lớp. Không bịa số liệu, mốc thời gian hay tên riêng cụ thể; nếu cần con số thì viết dạng mô tả.
- objective: một câu, người xem hiểu được ĐIỀU GÌ sau khi xem.
- audience: một câu tả người xem mục tiêu.
- callToAction: một câu ngắn dưới 12 từ.
- Toàn bộ viết bằng ${language}.`;

    const aiResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Bạn là biên tập viên video giải thích. Chỉ nêu dữ kiện phổ quát, không bịa số liệu cụ thể.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const payload = await checkedJson(aiResponse, "DeepSeek");
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new HttpError(502, "DeepSeek không trả nội dung brief.");
    const parsed = JSON.parse(String(content).replace(/^```json\s*|\s*```$/g, ""));
    response.json({
      context: String(parsed.context || ""),
      objective: String(parsed.objective || ""),
      audience: String(parsed.audience || ""),
      callToAction: String(parsed.callToAction || ""),
      model,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/references/analyze", async (request, response, next) => {
  try {
    const references = Array.isArray(request.body?.references)
      ? request.body.references.slice(0, 6)
      : [];
    if (!references.length) {
      response.json({ analyses: [], model: "" });
      return;
    }

    const model = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
    const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
    const parts: any[] = [
      {
        text: `Phân tích các ảnh reference cho một video giải thích.

Với từng ảnh, trả:
- id: giữ nguyên ID được cung cấp.
- description: một câu tiếng Việt mô tả chính xác chủ thể, hành động, bối cảnh, màu sắc và chi tiết nhận diện nhìn thấy được. Không đoán thương hiệu hoặc danh tính nếu ảnh không cho thấy rõ.
- keywords: 3-8 cụm từ tiếng Anh cụ thể có thể dùng để tìm stock photo cùng chủ thể hoặc bối cảnh. Ưu tiên danh từ nhìn thấy thật trong ảnh, không dùng từ chỉ phong cách.

Chỉ trả JSON: {"analyses":[{"id":"","description":"","keywords":[""]}]}.`,
      },
    ];

    for (const reference of references) {
      const id = String(reference?.id || "");
      const name = String(reference?.name || "reference");
      const role = String(reference?.role || "subject");
      const notes = String(reference?.notes || "");
      const { mimeType, data } = dataUrlParts(String(reference?.dataUrl || ""));
      parts.push({
        text: `REFERENCE id=${id} | file=${name} | role=${role} | user notes=${notes || "none"}`,
      });
      parts.push({ inlineData: { mimeType, data } });
    }

    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json" },
    });
    const content = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!content) throw new HttpError(502, "Gemini không trả phân tích ảnh.");
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
    const allowedIds = new Set(references.map((item: any) => String(item?.id || "")));
    const analyses = (Array.isArray(parsed.analyses) ? parsed.analyses : [])
      .map((item: any) => ({
        id: String(item?.id || ""),
        description: String(item?.description || "").trim(),
        keywords: (Array.isArray(item?.keywords) ? item.keywords : [])
          .map((keyword: unknown) => String(keyword || "").trim())
          .filter(Boolean)
          .slice(0, 8),
      }))
      .filter((item: any) => allowedIds.has(item.id) && item.description);
    response.json({ analyses, model });
  } catch (error) {
    next(error);
  }
});

app.post("/api/script/generate", async (request, response, next) => {
  try {
    const apiKey = requireEnv("DEEPSEEK_API_KEY");
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    const model = String(request.body?.model || process.env.DEEPSEEK_MODEL || "deepseek-chat");
    const config = request.body?.config;
    if (!config?.context?.trim()) throw new HttpError(400, "Context không được để trống.");
    const beatCount = config.duration === 180 ? 36 : config.duration === 60 ? 11 : 6;
    const searchEnabled = Boolean(request.body?.imageSearchEnabled);

    // Manifest đánh số 1-based; refPlan.useUploads tham chiếu chính các số này.
    const references = Array.isArray(request.body?.references)
      ? request.body.references
      : [];
    const manifest = references.length
      ? references
          .map(
            (asset: any, index: number) =>
              `${index + 1}. ${String(asset?.name || "reference")} | role=${String(
                asset?.role || "subject",
              )} | notes=${String(asset?.notes || "không có ghi chú")} | AI sees=${String(
                asset?.visualDescription || "chưa phân tích",
              )} | exact keywords=${(Array.isArray(asset?.visualKeywords)
                ? asset.visualKeywords
                : []
              ).join(", ") || "không có"}`,
          )
          .join("\n")
      : "Chưa có reference nào.";

    const prompt = `Viết kịch bản video editorial paper-collage.

THÔNG TIN
Tên: ${config.title}
Context: ${config.context}
Mục tiêu: ${config.objective}
Khán giả: ${config.audience}
Ngôn ngữ: ${config.language}
Thời lượng: ${config.duration} giây
Cấu trúc: ${config.storyArc}
CTA: ${config.callToAction}

REFERENCE USER ĐÃ NẠP
${manifest}

YÊU CẦU
- Trả đúng ${beatCount} beat.
- Mỗi beat có job, narration, visual, transition, overlay, refPlan.

NHÃN CHƯƠNG (job)
job hiện lên đầu video như nhãn chương, nên nó phải nói NỘI DUNG beat đó, không phải vai trò kể chuyện.
- Đúng: "Đặt mua", "Xác nhận đơn", "Về kho trung chuyển", "Giao tận tay".
- Sai: "Mở đầu gây tò mò", "Hook", "Cao trào", "Kết luận", "Bối cảnh" — đó là vai trò trong kịch bản, người xem không quan tâm.
- 2 đến 4 từ, danh từ hoặc cụm động từ ngắn, viết thường có dấu.
- Người xem đọc nhãn này phải biết ngay đang xem công đoạn nào của câu chuyện.
- Narration tự nhiên, ngắn, tổng độ dài phù hợp thời lượng.
- Mỗi beat chỉ truyền đạt một ý.
- Không tự bịa số liệu, mốc thời gian, vị trí dẫn đầu hoặc claim chưa có trong context.
- Nếu context chưa đủ dữ kiện, dùng cách diễn đạt trung tính và đánh dấu [CẦN NGUỒN] trong narration.
- Visual phải phù hợp flat 2D editorial paper-collage và giữ continuity giữa các beat.
- Overlay tối đa 7 từ, có thể để trống.

PHÂN BỔ REFERENCE (refPlan)
Mỗi beat phải có refPlan gồm useUploads, searchQuery, newElements.
- useUploads là mảng SỐ THỨ TỰ trong danh sách reference ở trên.
- Chỉ đưa một reference vào beat khi chủ thể đó THỰC SỰ xuất hiện trong khung hình của beat đó. Beat nói về hạ tầng, cơ chế, quy trình hay số liệu thì để useUploads rỗng.
- TUYỆT ĐỐI không đưa reference có role=style vào useUploads. Hệ thống tự ghim style vào mọi beat.
- searchQuery là cụm từ TIẾNG ANH mô tả CẢNH VẬT hoặc VẬT THỂ cần tìm ảnh tham chiếu bố cục (ví dụ "warehouse conveyor belt parcels sorting"). Không mô tả style, không nhắc paper collage. Để rỗng nếu beat trừu tượng hoặc đã đủ reference.${
      searchEnabled ? "" : "\n- Tính năng tìm ảnh đang TẮT, luôn để searchQuery rỗng."
    }
- Dựa vào phần "AI sees" để hiểu ảnh thật, không suy luận từ filename.
- Khi searchQuery liên quan tới chủ thể đã nhìn thấy, tái sử dụng các "exact keywords" phù hợp và thêm bối cảnh của beat. Không thay bằng từ đồng nghĩa chung chung.
- newElements liệt kê bằng TIẾNG VIỆT những element phải tự dựng mới vì không có reference nào.
- Ràng buộc cứng: useUploads.length + (searchQuery khác rỗng ? 1 : 0) <= 4.

Chỉ trả JSON hợp lệ theo dạng {"beats":[{"job":"","narration":"","visual":"","transition":"","overlay":"","refPlan":{"useUploads":[],"searchQuery":"","newElements":[]}}]}.`;
    const aiResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Bạn là biên kịch factual explainer. Chỉ dùng dữ kiện người dùng cung cấp, không suy diễn claim.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const payload = await checkedJson(aiResponse, "DeepSeek");
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new HttpError(502, "DeepSeek không trả nội dung kịch bản.");
    const parsed = JSON.parse(String(content).replace(/^```json\s*|\s*```$/g, ""));
    if (!Array.isArray(parsed.beats) || parsed.beats.length !== beatCount) {
      throw new HttpError(502, `DeepSeek không trả đúng ${beatCount} beat.`);
    }
    response.json({ beats: parsed.beats, model });
  } catch (error) {
    next(error);
  }
});

async function uploadCoachioImage(
  dataUrl: string,
  apiKey: string,
  signal: AbortSignal,
) {
  const { mimeType, data } = dataUrlParts(dataUrl);
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from(data, "base64")], { type: mimeType }),
    `reference.${extension}`,
  );
  const uploadResponse = await fetchWithRetry(
    `${coachioBaseUrl}/upload/image`,
    {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: form,
      signal,
    },
  );
  const uploaded = await checkedJson(uploadResponse, "Coachio upload");
  if (!uploaded.url) throw new HttpError(502, "Coachio không trả URL ảnh upload.");
  return uploaded.url as string;
}

function coachioResults(payload: any): string[] {
  const candidates = [
    payload?.result_urls,
    payload?.output_urls,
    payload?.result?.output_urls,
    payload?.result?.result_urls,
  ];
  return candidates.find(Array.isArray) || [];
}

async function generateWithCoachio(
  prompt: string,
  aspectRatio: string,
  resolution: string,
  referenceImages: string[],
  signal: AbortSignal,
) {
  const apiKey = requireEnv("COACHIO_API_KEY");
  const uploadedUrls = await Promise.all(
    referenceImages
      .slice(0, 5)
      .map((image) => uploadCoachioImage(image, apiKey, signal)),
  );
  const body: Record<string, unknown> = {
    task_type: "image",
    prompt,
    ai_model_config: {
      model_identifier: "gpt_image_2",
      generation_mode: "default",
      aspect_ratio: aspectRatio,
      resolution,
    },
  };
  if (uploadedUrls.length) body.media_inputs = { images_url: uploadedUrls };
  const submitted = await checkedJson(
    await fetchWithRetry(
      `${coachioBaseUrl}/task/submit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
        signal,
      },
    ),
    "Coachio",
  );
  if (!submitted.task_id) throw new HttpError(502, "Coachio không trả task_id.");

  const startedAt = Date.now();
  let delay = 2500;
  while (Date.now() - startedAt < 5 * 60_000) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const status = await checkedJson(
      await fetchWithRetry(
        `${coachioBaseUrl}/task/status/${submitted.task_id}`,
        {
          headers: { "X-API-Key": apiKey },
          signal,
        },
      ),
      "Coachio",
    );
    if (status.status === "completed") {
      const urls = coachioResults(status);
      if (!urls.length) throw new HttpError(502, "Coachio hoàn tất nhưng không trả ảnh.");
      return { imageUrl: urls[0], taskId: submitted.task_id as string };
    }
    if (status.status === "failed") {
      throw new HttpError(502, `Coachio: ${status.message || "tạo ảnh thất bại"}`);
    }
    delay = Math.min(Math.round(delay * 1.35), 10_000);
  }
  throw new HttpError(504, "Coachio quá thời gian chờ 5 phút.");
}

async function generateWithGemini(
  prompt: string,
  aspectRatio: string,
  resolution: string,
  referenceImages: string[],
  model: string,
) {
  const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  const parts: any[] = [{ text: prompt }];
  for (const reference of referenceImages.slice(0, 5)) {
    const { mimeType, data } = dataUrlParts(reference);
    parts.push({ inlineData: { mimeType, data } });
  }
  const result = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: {
        aspectRatio,
        imageSize: resolution.toUpperCase(),
      },
    },
  });
  const imagePart = result.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData?.data,
  );
  if (!imagePart?.inlineData?.data) {
    throw new HttpError(502, "Gemini không trả dữ liệu ảnh.");
  }
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const extension = mimeType.includes("jpeg") ? "jpg" : "png";
  const fileName = `${crypto.randomUUID()}.${extension}`;
  fs.writeFileSync(
    path.join(generatedDir, fileName),
    Buffer.from(imagePart.inlineData.data, "base64"),
  );
  return `/generated/${fileName}`;
}

interface RawSlot {
  kind?: string;
  dataUrl?: string;
  url?: string;
}

/**
 * Đổi slot thành data URL, GIỮ NGUYÊN THỨ TỰ mảng — block REFERENCE ORDER trong
 * prompt đánh số theo đúng thứ tự này, lệch một vị trí là model gán nhầm luật
 * lock cho ảnh.
 */
async function resolveSlots(slots: RawSlot[]) {
  const resolved: string[] = [];
  for (const slot of slots.slice(0, 5)) {
    if (slot?.kind === "upload") {
      const dataUrl = String(slot.dataUrl || "");
      if (dataUrl.startsWith("data:")) resolved.push(dataUrl);
      continue;
    }
    const url = String(slot?.url || "");
    if (!url) continue;

    if (url.startsWith("/generated/refs/")) {
      const fileName = path.basename(url);
      const filePath = path.join(refsDir, fileName);
      // path.basename đã chặn traversal, kiểm tra lần nữa cho chắc.
      if (!filePath.startsWith(refsDir) || !fs.existsSync(filePath)) continue;
      const extension = path.extname(fileName).slice(1) || "jpg";
      const mimeType = extension === "png" ? "image/png" : `image/${extension}`;
      resolved.push(
        `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`,
      );
      continue;
    }

    // Cache miss: tải thẳng từ remote, vẫn qua guard SSRF.
    if (!isSafeImageUrl(url)) continue;
    try {
      const remote = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!remote.ok) continue;
      const contentType = remote.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) continue;
      const buffer = Buffer.from(await remote.arrayBuffer());
      if (buffer.byteLength > MAX_CACHED_IMAGE_BYTES) continue;
      resolved.push(`data:${contentType};base64,${buffer.toString("base64")}`);
    } catch {
      // Ảnh chết không được làm hỏng cả lượt generate; bỏ qua slot này.
    }
  }
  return resolved;
}

app.post("/api/image/generate", async (request, response, next) => {
  const controller = new AbortController();
  request.on("aborted", () => controller.abort());
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  try {
    const {
      prompt,
      aspectRatio = "9:16",
      resolution = "1k",
      provider = "coachio",
      fallbackToGemini = true,
      geminiModel = "gemini-3.1-flash-image",
      slots = [],
    } = request.body || {};
    if (!String(prompt || "").trim()) throw new HttpError(400, "Prompt không được để trống.");
    if (!["1k", "2k", "4k"].includes(resolution)) {
      throw new HttpError(400, "Resolution không hợp lệ.");
    }
    const referenceImages = await resolveSlots(
      Array.isArray(slots) ? slots : [],
    );

    if (provider === "gemini") {
      const imageUrl = await generateWithGemini(
        prompt,
        aspectRatio,
        resolution,
        referenceImages,
        geminiModel,
      );
      response.json({ provider: "gemini", imageUrl, fallbackUsed: false });
      return;
    }

    try {
      const result = await generateWithCoachio(
        prompt,
        aspectRatio,
        resolution,
        referenceImages,
        controller.signal,
      );
      response.json({
        provider: "coachio",
        imageUrl: result.imageUrl,
        taskId: result.taskId,
        fallbackUsed: false,
      });
    } catch (coachioError) {
      if (!fallbackToGemini || controller.signal.aborted) throw coachioError;
      const imageUrl = await generateWithGemini(
        prompt,
        aspectRatio,
        resolution,
        referenceImages,
        geminiModel,
      );
      response.json({
        provider: "gemini",
        imageUrl,
        fallbackUsed: true,
      });
    }
  } catch (error) {
    next(error);
  }
});

/** Đọc ảnh keyframe: /generated/... nằm trên đĩa, còn lại là URL nhà cung cấp. */
async function readKeyframe(url: string) {
  if (url.startsWith("/generated/")) {
    const filePath = path.resolve(generatedDir, `.${url.slice("/generated".length)}`);
    if (!filePath.startsWith(generatedDir)) {
      throw new HttpError(400, "Đường dẫn ảnh không hợp lệ.");
    }
    if (!fs.existsSync(filePath)) throw new HttpError(404, `Không tìm thấy ${url}.`);
    return fs.readFileSync(filePath);
  }
  if (!isSafeImageUrl(url)) {
    throw new HttpError(400, "URL ảnh không hợp lệ hoặc trỏ vào mạng nội bộ.");
  }
  const remote = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!remote.ok) throw new HttpError(502, `Không tải được ảnh (${remote.status}).`);
  return Buffer.from(await remote.arrayBuffer());
}

app.post("/api/export/package", async (request, response, next) => {
  try {
    const entries = Array.isArray(request.body?.entries) ? request.body.entries : [];
    const prompts = Array.isArray(request.body?.prompts) ? request.body.prompts : [];
    const fileName = String(request.body?.fileName || "vox-storyboard.zip");

    if (!entries.length) throw new HttpError(400, "Chưa có keyframe nào để xuất.");
    // Extension ghép ảnh với prompt theo chỉ số; lệch số lượng là lệch toàn bộ cặp.
    if (entries.length !== prompts.length) {
      throw new HttpError(
        400,
        `Số ảnh (${entries.length}) khác số prompt (${prompts.length}).`,
      );
    }

    const files: ZipEntry[] = [];
    for (const entry of entries) {
      const name = String(entry?.name || "");
      // Chặn traversal: tên do client gửi nhưng chỉ được là một tên file phẳng.
      if (!/^B\d{2,}\.(png|jpe?g|webp)$/.test(name)) {
        throw new HttpError(400, `Tên file không hợp lệ: ${name}`);
      }
      files.push({ name, data: await readKeyframe(String(entry?.url || "")) });
    }
    files.push({
      name: "prompts.txt",
      data: Buffer.from(buildPromptsFile(prompts.map(String)), "utf8"),
    });

    const archive = createZip(files);
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Length", String(archive.length));
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/[^\w.-]/g, "")}"`,
    );
    response.setHeader("Cache-Control", "no-store");
    response.send(archive);
  } catch (error) {
    next(error);
  }
});

const execFileAsync = promisify(execFile);

/**
 * ffmpeg đi kèm gói ffmpeg-static, KHÔNG dùng bản trên máy.
 *
 * Bản Homebrew trên macOS được biên dịch thiếu libass và libfreetype nên không
 * burn nổi phụ đề. Bản của ffmpeg-static có đủ, và cùng một binary sẽ chạy trên
 * Railway — tránh cảnh chạy được ở máy này mà hỏng ở máy khác.
 */
const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = "ffprobe";
const overlayDir = path.resolve(currentDir, "./overlay");
const HYPERFRAMES = process.env.HYPERFRAMES_VERSION || "hyperframes@0.6.94";

/**
 * Render lớp phủ (cover, HUD, caption) bằng HyperFrames ra MOV có alpha.
 *
 * ASS không tái tạo được thiết kế CSS: thanh tiến độ vỡ thành gạch đứt, tiêu đề
 * bị cắt vì không xuống dòng, không có gradient. HyperFrames chạy chính CSS của
 * preview qua Chromium nên bản render giống hệt thứ user đã duyệt.
 *
 * Chỉ overlay đi qua Chromium; phần ghép clip và trộn tiếng vẫn là ffmpeg, nên
 * không phải đẩy cả video 1080x1920 qua trình duyệt từng frame.
 */
async function renderOverlay(jobDir: string, variables: Record<string, unknown>) {
  const workDir = path.join(jobDir, "overlay");
  fs.cpSync(overlayDir, workDir, { recursive: true });

  // data-duration trong HTML là thứ HyperFrames dùng để quyết định độ dài
  // composition — biến durationSec KHÔNG ghi đè được nó. Để nguyên con số mẫu
  // 10 giây thì overlay chỉ dài 10 giây, ffmpeg giữ frame cuối cho phần còn
  // lại, và caption chết đứng giữa video. Phải ghi lại attribute theo độ dài
  // thật của lần render này.
  const entry = path.join(workDir, "index.html");
  const durationSec = Math.max(1, Number(variables.durationSec) || 10);
  fs.writeFileSync(
    entry,
    fs
      .readFileSync(entry, "utf8")
      .replace(/data-duration="[^"]*"/, `data-duration="${durationSec.toFixed(3)}"`),
    "utf8",
  );
  const varsFile = path.join(workDir, "variables.json");
  fs.writeFileSync(varsFile, JSON.stringify(variables), "utf8");
  const output = path.join(jobDir, "overlay.webm");

  await execFileAsync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "-y", HYPERFRAMES, "render", workDir,
      "--output", output,
      // WebM/VP9 giữ kênh alpha và nhẹ hơn ProRes 4444 khoảng một bậc: overlay
      // 10 giây ra 455MB dạng MOV, đủ để một bản 30 giây làm đầy đĩa.
      "--format", "webm",
      "--fps", "30",
      "--quality", "draft",
      // Truyền qua FILE chứ không phải --variables: JSON có dấu tiếng Việt đi
      // qua shell hay bị mangle, nhất là trên Windows.
      "--variables-file", varsFile,
      "--quiet",
    ],
    { maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60_000 },
  );
  if (!fs.existsSync(output)) throw new Error("HyperFrames không tạo được overlay.");
  return output;
}

/**
 * Dò xem build ffmpeg có filter này không.
 *
 * Hai cái bẫy đã dính phải:
 * 1. `ffmpeg -h filter=X` trả mã 0 kể cả với filter KHÔNG được biên dịch vào.
 * 2. Chạy thử filter rồi coi "thất bại là thiếu filter" cũng sai: nếu dò
 *    subtitles bằng một file .ass không tồn tại thì libass có đủ vẫn báo lỗi
 *    mở file, và ta kết luận nhầm là thiếu.
 *
 * Nên phải chạy thử VÀ đọc stderr: chỉ "No such filter" mới là thiếu thật.
 */
const filterCache = new Map<string, boolean>();
async function hasFilter(name: string, args = "") {
  const cached = filterCache.get(name);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    await execFileAsync(FFMPEG, [
      "-v", "error",
      "-f", "lavfi", "-i", "color=c=black:s=32x32:d=1",
      "-vf", args ? `${name}=${args}` : name,
      "-frames:v", "1", "-f", "null", "-",
    ]);
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr || "");
    ok = !/No such filter|Unknown filter/i.test(stderr);
  }
  filterCache.set(name, ok);
  return ok;
}

const FRAME_SIZES: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
};

app.post("/api/render/video", async (request, response, next) => {
  try {
    const beats = Array.isArray(request.body?.beats) ? request.body.beats : [];
    const phrases = Array.isArray(request.body?.phrases) ? request.body.phrases : [];
    const audioUrl = String(request.body?.audioUrl || "").trim();
    const aspectRatio = String(request.body?.aspectRatio || "9:16");
    const burnCaptions = request.body?.burnCaptions !== false;
    // Tốc độ chỉ áp MỘT LẦN ở đây. Timeline giữ nguyên thời gian gốc ở mọi nơi
    // khác, nên đổi tốc độ không phải đo lại giọng đọc.
    const speed = Math.min(Math.max(Number(request.body?.speed) || 1, 0.5), 4);
    const cover = request.body?.cover || {};
    const [width, height] = FRAME_SIZES[aspectRatio] || FRAME_SIZES["9:16"];

    const plan = buildConcatPlan(beats, (url) =>
      path.resolve(generatedDir, `./${url.replace("/generated/", "")}`),
    );
    if (!plan.length) throw new HttpError(400, "Chưa có đoạn video nào để ghép.");
    for (const step of plan) {
      if (!step.file.startsWith(generatedDir) || !fs.existsSync(step.file)) {
        throw new HttpError(404, `Không tìm thấy clip của beat B${step.beatIndex}.`);
      }
    }

    let audioPath = "";
    if (audioUrl.startsWith("/generated/audio/")) {
      const candidate = path.resolve(audioDir, `./${path.basename(audioUrl)}`);
      if (candidate.startsWith(audioDir) && fs.existsSync(candidate)) {
        audioPath = candidate;
      }
    }

    // Mỗi lần render một thư mục riêng, và chạy ffmpeg với cwd đặt tại đó. Nhờ
    // vậy bộ lọc subtitles chỉ cần tên file tương đối — đường dẫn tuyệt đối có
    // dấu cách và dấu hai chấm sẽ phá cú pháp filter_complex.
    const jobId = crypto.randomUUID();
    const jobDir = path.join(rendersDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const scaledPhrases = scalePhrases(phrases, speed);
    const scaledChapters = plan.map((step, index) => ({
      index: step.beatIndex,
      label: String(beats.find((b: any) => b.index === step.beatIndex)?.job || ""),
      overlay: String(
        beats.find((b: any) => b.index === step.beatIndex)?.overlay || "",
      ),
      start:
        plan.slice(0, index).reduce((t, s2) => t + s2.duration + s2.padSeconds, 0) / speed,
      end:
        plan.slice(0, index + 1).reduce((t, s2) => t + s2.duration + s2.padSeconds, 0) /
        speed,
    }));

    // Luôn ghi file phụ đề, kể cả khi không burn được: nó dùng được ngay trong
    // trình dựng phim, và preview trong app vẫn hiển thị karaoke bằng DOM.
    const wantCaptions = burnCaptions && phrases.length > 0;
    if (wantCaptions) {
      fs.writeFileSync(
        path.join(jobDir, "caption.ass"),
        buildAssFile(scaledPhrases, width, height, undefined, {
          coverEyebrow: String(cover.eyebrow || ""),
          coverTitle: String(cover.title || ""),
          coverSeconds: (Number(cover.seconds) || 0) / speed,
          chapters: scaledChapters,
        }),
        "utf8",
      );
    }
    // Build ffmpeg của Homebrew hiện không kèm libass; burn phụ đề sẽ ném
    // "No such filter". Dò trước rồi xuống thang, chứ không để render chết
    // sau khi đã đốt vài phút encode.
    const canBurn = wantCaptions && (await hasFilter("subtitles", "f=nonexistent.ass"));
    const useOverlay = wantCaptions && request.body?.useOverlay !== false;
    const useCaptions = wantCaptions && canBurn;

    // Audio dài hơn tổng clip thì đuôi giọng đọc bị -shortest cắt mất. Kéo dài
    // hình bằng khung cuối cho bằng audio thay vì cắt tiếng.
    let audioDuration = 0;
    if (audioPath) {
      try {
        const { stdout } = await execFileAsync(FFPROBE, [
          "-v", "error",
          "-show_entries", "format=duration",
          "-of", "csv=p=0",
          audioPath,
        ]);
        audioDuration = Number(String(stdout).trim()) || 0;
      } catch {
        audioDuration = 0;
      }
    }
    const videoTotal = planTotalDuration(plan);
    const tailHold = audioDuration > videoTotal ? audioDuration - videoTotal : 0;
    // Độ dài cuối cùng sau khi tăng tốc.
    const finalDuration = (audioDuration > 0 ? audioDuration : videoTotal) / speed;

    // HyperFrames trước, ASS làm đường lui. Overlay dựng bằng chính CSS của
    // preview nên bản render khớp thứ user đã duyệt; ASS chỉ gần đúng.
    let overlayFile = "";
    let overlayNote = "";
    if (useOverlay) {
      try {
        overlayFile = await renderOverlay(jobDir, {
          durationSec: finalDuration,
          coverEyebrow: String(cover.eyebrow || ""),
          coverTitle: String(cover.title || ""),
          coverSeconds: (Number(cover.seconds) || 0) / speed,
          chapters: scaledChapters,
          phrases: scaledPhrases,
        });
      } catch (error) {
        overlayNote = `Không dựng được lớp phủ bằng HyperFrames (${
          error instanceof Error ? error.message.split("\n")[0] : "lỗi"
        }); đã quay về phụ đề ASS.`;
      }
    }

    const args: string[] = ["-y"];
    plan.forEach((step) => args.push("-i", step.file));
    if (audioPath) args.push("-i", audioPath);
    if (overlayFile) {
      // BẮT BUỘC ép libvpx-vp9. Decoder vp9 mặc định của ffmpeg trả yuv420p,
      // tức là VỨT kênh alpha đi, và overlay biến thành tấm nền đen đặc phủ kín
      // video. Chỉ libvpx-vp9 mới cho ra yuva420p.
      args.push("-c:v", "libvpx-vp9", "-i", overlayFile);
    }

    const filters = plan.map((step, index) => {
      const pad =
        step.padSeconds > 0
          ? `,tpad=stop_mode=clone:stop_duration=${step.padSeconds}`
          : "";
      return (
        `[${index}:v]trim=start=${step.trimStart}:duration=${step.duration},` +
        `setpts=PTS-STARTPTS${pad},` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v${index}]`
      );
    });
    const concatInputs = plan.map((_, index) => `[v${index}]`).join("");
    filters.push(
      `${concatInputs}concat=n=${plan.length}:v=1:a=0` +
        (tailHold > 0
          ? `,tpad=stop_mode=clone:stop_duration=${tailHold.toFixed(3)}`
          : "") +
        `[vcat]`,
    );
    // setpts trước subtitles: phụ đề đã được chia tốc độ khi sinh ASS, nên nó
    // phải dán lên luồng ĐÃ tăng tốc, không phải luồng gốc.
    const speedVideo = speed !== 1 ? `setpts=PTS/${speed}` : "null";
    filters.push(`[vcat]${speedVideo}[vspeed]`);
    if (overlayFile) {
      // Overlay đã render ở tốc độ cuối nên KHÔNG setpts nó lần nữa.
      const overlayIndex = plan.length + (audioPath ? 1 : 0);
      filters.push(`[vspeed][${overlayIndex}:v]overlay=0:0:format=auto[vout]`);
    } else {
      filters.push(
        useCaptions ? `[vspeed]subtitles=f=caption.ass[vout]` : `[vspeed]null[vout]`,
      );
    }
    const atempo = buildAtempoChain(speed);
    if (audioPath && atempo.length) {
      filters.push(`[${plan.length}:a]${atempo.join(",")}[aout]`);
    }

    args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
    if (audioPath) {
      args.push(
        "-map",
        atempo.length ? "[aout]" : `${plan.length}:a`,
        "-c:a", "aac", "-b:a", "192k",
      );
    }
    args.push(
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      // Audio là đồng hồ chủ. Cắt đúng độ dài audio chứ KHÔNG dùng -shortest:
      // -shortest cắt theo luồng ngắn nhất, mà nếu hình ngắn hơn thì nó cắt cụt
      // luôn phần tiếng còn lại — đúng lỗi mất 1,1 giây cuối.
      ...(finalDuration > 0 ? ["-t", finalDuration.toFixed(3)] : []),
      "output.mp4",
    );

    await execFileAsync(FFMPEG, args, {
      cwd: jobDir,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10 * 60_000,
    });

    const outPath = path.join(jobDir, "output.mp4");
    if (!fs.existsSync(outPath)) throw new HttpError(500, "ffmpeg không tạo được file.");
    response.json({
      url: `/generated/renders/${jobId}/output.mp4`,
      durationSeconds: finalDuration,
      speed,
      width,
      height,
      clips: plan.length,
      captions: Boolean(overlayFile) || useCaptions,
      overlay: Boolean(overlayFile),
      // Đường dẫn phụ đề rời để nạp vào trình dựng phim khi không burn được.
      captionFile: wantCaptions ? `/generated/renders/${jobId}/caption.ass` : "",
      captionNote:
        overlayNote ||
        (wantCaptions && !overlayFile && !canBurn
          ? "ffmpeg trên máy này thiếu libass nên chưa burn được phụ đề. Video đã render xong, phụ đề nằm ở file .ass đi kèm. Cài bản ffmpeg có libass để burn thẳng."
          : ""),
    });
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      const stderr = String((error as { stderr?: string }).stderr || "");
      // Đuôi stderr của ffmpeg là chỗ ghi lý do thật; phần đầu chỉ là banner.
      next(new HttpError(500, `ffmpeg: ${stderr.trim().split("\n").slice(-3).join(" ")}`));
      return;
    }
    next(error);
  }
});

const REPLICATE_BASE = "https://api.replicate.com/v1";

function replicateHeaders() {
  return { Authorization: `Bearer ${requireEnv("REPLICATE_API_TOKEN")}` };
}

/**
 * Đưa keyframe lên Files API của Replicate.
 *
 * Không dùng data URI: Replicate khuyến cáo data URI chỉ dưới 1MB, còn keyframe
 * của dự án là PNG khoảng 3-4MB. Files API nhận tới 100MB.
 */
async function uploadKeyframe(bytes: Buffer, fileName: string) {
  const form = new FormData();
  form.append("content", new Blob([bytes], { type: "image/png" }), fileName);
  form.append("filename", fileName);
  form.append("type", "image/png");
  const uploaded = await checkedJson(
    await fetchWithRetry(`${REPLICATE_BASE}/files`, {
      method: "POST",
      headers: replicateHeaders(),
      body: form,
    }),
    "Replicate upload",
  );
  const url = uploaded?.urls?.get || uploaded?.urls?.download;
  if (!url) throw new HttpError(502, "Replicate không trả URL ảnh đã upload.");
  return String(url);
}

/** Lấy version mới nhất theo slug để không chôn một version chết vào code. */
async function latestModelVersion(slug: string) {
  const [owner, name] = slug.split("/");
  if (!owner || !name) throw new HttpError(400, `Model không hợp lệ: ${slug}`);
  const model = await checkedJson(
    await fetchWithRetry(`${REPLICATE_BASE}/models/${owner}/${name}`, {
      headers: replicateHeaders(),
    }),
    "Replicate",
  );
  const version = model?.latest_version?.id;
  if (!version) throw new HttpError(502, `Không đọc được version của ${slug}.`);
  return String(version);
}

app.post("/api/video/generate", async (request, response, next) => {
  const controller = new AbortController();
  let cancelUrl = "";

  /**
   * Client bấm Dừng thì phải huỷ thật ở phía Replicate. Bỏ mặc prediction chạy
   * tiếp nghĩa là vẫn bị tính tiền cho video không ai dùng.
   */
  const abandon = () => {
    controller.abort();
    if (!cancelUrl) return;
    void fetch(cancelUrl, { method: "POST", headers: replicateHeaders() }).catch(
      () => {},
    );
  };
  request.on("aborted", abandon);
  response.on("close", () => {
    if (!response.writableEnded) abandon();
  });

  try {
    const prompt = String(request.body?.prompt || "").trim();
    const imageUrl = String(request.body?.imageUrl || "").trim();
    const frames = Number(request.body?.frames) || 81;
    const slug = String(
      request.body?.model || process.env.REPLICATE_VIDEO_MODEL || "wan-video/wan-2.2-i2v-fast",
    );
    const settings: VideoSettings = {
      ...VIDEO_PRESETS.draft,
      ...(request.body?.settings || {}),
    };
    if (!prompt) throw new HttpError(400, "Motion prompt không được để trống.");
    if (!imageUrl) throw new HttpError(400, "Beat chưa có keyframe.");

    const bytes = await readKeyframe(imageUrl);
    const hostedImage = await uploadKeyframe(bytes, "keyframe.png");
    const version = await latestModelVersion(slug);

    const created = normalizePrediction(
      await checkedJson(
        await fetchWithRetry(`${REPLICATE_BASE}/predictions`, {
          method: "POST",
          headers: { ...replicateHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            version,
            input: buildPredictionInput(prompt, hostedImage, frames, settings),
          }),
          signal: controller.signal,
        }),
        "Replicate",
      ),
    );
    if (!created.id) throw new HttpError(502, "Replicate không trả prediction id.");
    cancelUrl = created.cancelUrl;

    let prediction = created;
    const startedAt = Date.now();
    let delay = 3000;
    while (!isTerminal(prediction.status)) {
      if (Date.now() - startedAt > 10 * 60_000) {
        abandon();
        throw new HttpError(504, "Replicate quá thời gian chờ 10 phút.");
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      prediction = normalizePrediction(
        await checkedJson(
          await fetchWithRetry(prediction.getUrl || `${REPLICATE_BASE}/predictions/${created.id}`, {
            headers: replicateHeaders(),
            signal: controller.signal,
          }),
          "Replicate",
        ),
      );
      delay = Math.min(Math.round(delay * 1.3), 12_000);
    }

    if (prediction.status === "canceled") {
      throw new HttpError(499, "Prediction đã bị huỷ.");
    }
    if (prediction.status === "failed" || !prediction.output) {
      throw new HttpError(502, `Replicate: ${prediction.error || "tạo video thất bại"}`);
    }

    // Replicate xoá file output sau 1 giờ, nên phải tải ngay. Bản local là thứ
    // bước ráp video cuối sẽ dùng.
    const remote = await fetch(prediction.output, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!remote.ok) {
      throw new HttpError(502, `Không tải được video (${remote.status}).`);
    }
    const fileName = `${crypto.randomUUID()}.mp4`;
    fs.writeFileSync(
      path.join(videosDir, fileName),
      Buffer.from(await remote.arrayBuffer()),
    );

    response.json({
      url: `/generated/videos/${fileName}`,
      remoteUrl: prediction.output,
      predictionId: prediction.id,
      frames,
      fps: settings.fps,
      durationSeconds: frames / settings.fps,
      resolution: settings.resolution,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/voice/transcribe", async (request, response, next) => {
  try {
    const apiKey = requireEnv("GROQ_API_KEY");
    const audioUrl = String(request.body?.audioUrl || "").trim();
    const model = String(request.body?.model || process.env.GROQ_MODEL || "whisper-large-v3");
    if (!audioUrl.startsWith("/generated/audio/")) {
      throw new HttpError(400, "Chưa có file voice trên máy chủ.");
    }
    const filePath = path.resolve(audioDir, `./${path.basename(audioUrl)}`);
    if (!filePath.startsWith(audioDir) || !fs.existsSync(filePath)) {
      throw new HttpError(404, "Không tìm thấy file voice.");
    }

    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(filePath)]), "voice.mp3");
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    const language = String(request.body?.language || "");
    // Chỉ định ngôn ngữ giúp Whisper không đoán nhầm sang tiếng gần giống.
    if (language.toLowerCase().includes("việt")) form.append("language", "vi");

    const payload = await checkedJson(
      await fetchWithRetry("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      }),
      "Groq",
    );
    const result = normalizeTranscription(payload);
    if (!result.words.length) {
      throw new HttpError(502, "Groq không trả được timestamp theo từng từ.");
    }
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/voice/generate", async (request, response, next) => {
  try {
    const apiKey = requireEnv("ELEVENLABS_API_KEY");
    const voiceId = String(
      request.body?.voiceId || process.env.ELEVENLABS_VOICE_ID || "",
    ).trim();
    const text = String(request.body?.text || "").trim();
    const model = String(
      request.body?.model || process.env.ELEVENLABS_MODEL || "eleven_v3",
    );
    if (!voiceId) throw new HttpError(400, "Chưa nhập ElevenLabs Voice ID.");
    if (!text) throw new HttpError(400, "Voice script không được để trống.");
    const audioResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      },
    );
    if (!audioResponse.ok) {
      const body = await audioResponse.json().catch(() => ({}));
      throw new HttpError(
        audioResponse.status,
        `ElevenLabs: ${body?.detail?.message || body?.detail || audioResponse.statusText}`,
      );
    }
    // Lưu ra đĩa thay vì stream về blob: object URL phía client chết theo phiên
    // trang nên F5 là mất voice, phải tạo lại và trả tiền ElevenLabs lần nữa.
    const fileName = `${crypto.randomUUID()}.mp3`;
    fs.writeFileSync(
      path.join(audioDir, fileName),
      Buffer.from(await audioResponse.arrayBuffer()),
    );
    response.json({ url: `/generated/audio/${fileName}`, model });
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Máy chủ gặp lỗi không xác định.";
    if (!response.headersSent) response.status(status).json({ message });
  },
);

if (process.env.NODE_ENV === "production") {
  const distDir = path.resolve(currentDir, "../dist");
  app.use(express.static(distDir));
  app.get("/{*splat}", (_request, response) =>
    response.sendFile(path.join(distDir, "index.html")),
  );
}

app.listen(port, () => {
  console.log(`VOX API listening on http://127.0.0.1:${port}`);
});
