import type { SearchedImage } from "../src/types";

/**
 * Chuẩn hoá payload của hai nhà cung cấp ảnh về cùng một shape.
 *
 * Module này cố ý thuần: không đụng express, không đọc process.env, không gọi
 * mạng — để test được bằng payload cố định.
 */

function asRecordArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const list = (value as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object",
  );
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePexels(payload: unknown): SearchedImage[] {
  return asRecordArray(payload, "photos")
    .map((photo) => {
      const src = (photo.src || {}) as Record<string, unknown>;
      const fullUrl = text(src.large2x) || text(src.large) || text(src.original);
      if (!fullUrl) return null;
      const photographer = text(photo.photographer) || "Không rõ tác giả";
      return {
        id: `pexels-${text(String(photo.id ?? "")) || fullUrl}`,
        source: "pexels" as const,
        thumbUrl: text(src.medium) || text(src.small) || fullUrl,
        fullUrl,
        cachedUrl: "",
        attribution: `Ảnh: ${photographer} / Pexels`,
        sourcePage: text(photo.url),
      };
    })
    .filter((image): image is SearchedImage => image !== null);
}

export function normalizeSerper(payload: unknown): SearchedImage[] {
  return asRecordArray(payload, "images")
    .map((image, index) => {
      const fullUrl = text(image.imageUrl);
      if (!fullUrl) return null;
      const origin = text(image.source) || text(image.domain) || "web";
      return {
        id: `serper-${index}-${fullUrl}`,
        source: "serper" as const,
        thumbUrl: text(image.thumbnailUrl) || fullUrl,
        fullUrl,
        cachedUrl: "",
        attribution: `Nguồn: ${origin} (ảnh web, chưa rõ bản quyền)`,
        sourcePage: text(image.link),
      };
    })
    .filter((image): image is SearchedImage => image !== null);
}

export function pexelsOrientation(aspectRatio: string) {
  if (aspectRatio === "1:1") return "square" as const;
  if (aspectRatio === "16:9") return "landscape" as const;
  return "portrait" as const;
}

const privateHostPatterns = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

/**
 * Server fetch URL do bên thứ ba cung cấp (Serper trả ảnh từ domain bất kỳ),
 * nên đây là bề mặt SSRF thật. Chỉ cho https công khai.
 */
export function isSafeImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "::1" || host === "0.0.0.0") return false;
  return !privateHostPatterns.some((pattern) => pattern.test(host));
}
