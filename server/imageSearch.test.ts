import { describe, expect, it } from "vitest";
import {
  isSafeImageUrl,
  normalizePexels,
  normalizeSerper,
  pexelsOrientation,
} from "./imageSearch";

const pexelsPayload = {
  photos: [
    {
      id: 3184292,
      width: 4000,
      height: 6000,
      url: "https://www.pexels.com/photo/warehouse-3184292/",
      photographer: "Nguyen A",
      src: {
        large2x: "https://images.pexels.com/photos/3184292/large2x.jpeg",
        medium: "https://images.pexels.com/photos/3184292/medium.jpeg",
      },
      alt: "Warehouse conveyor",
    },
  ],
};

const serperPayload = {
  images: [
    {
      title: "Parcel sorting hub",
      imageUrl: "https://example.com/hub.jpg",
      thumbnailUrl: "https://example.com/hub-thumb.jpg",
      link: "https://example.com/article",
      source: "Example News",
    },
  ],
};

describe("normalizePexels", () => {
  it("trả đúng shape SearchedImage", () => {
    const [image] = normalizePexels(pexelsPayload);
    expect(image.source).toBe("pexels");
    expect(image.fullUrl).toBe(
      "https://images.pexels.com/photos/3184292/large2x.jpeg",
    );
    expect(image.thumbUrl).toBe(
      "https://images.pexels.com/photos/3184292/medium.jpeg",
    );
    expect(image.sourcePage).toBe(
      "https://www.pexels.com/photo/warehouse-3184292/",
    );
    expect(image.attribution).toContain("Nguyen A");
    expect(image.attribution).toContain("Pexels");
    expect(image.cachedUrl).toBe("");
    expect(image.id).toBeTruthy();
  });

  it("payload rỗng hoặc sai hình trả mảng rỗng", () => {
    expect(normalizePexels({})).toEqual([]);
    expect(normalizePexels(null)).toEqual([]);
    expect(normalizePexels({ photos: "nope" })).toEqual([]);
  });

  it("bỏ ảnh thiếu URL", () => {
    expect(normalizePexels({ photos: [{ id: 1, src: {} }] })).toEqual([]);
  });
});

describe("normalizeSerper", () => {
  it("trả đúng shape SearchedImage", () => {
    const [image] = normalizeSerper(serperPayload);
    expect(image.source).toBe("serper");
    expect(image.fullUrl).toBe("https://example.com/hub.jpg");
    expect(image.thumbUrl).toBe("https://example.com/hub-thumb.jpg");
    expect(image.sourcePage).toBe("https://example.com/article");
    expect(image.attribution).toContain("Example News");
  });

  it("thiếu thumbnail thì dùng ảnh gốc", () => {
    const [image] = normalizeSerper({
      images: [{ imageUrl: "https://example.com/a.jpg" }],
    });
    expect(image.thumbUrl).toBe("https://example.com/a.jpg");
  });

  it("payload rỗng trả mảng rỗng", () => {
    expect(normalizeSerper({})).toEqual([]);
    expect(normalizeSerper(undefined)).toEqual([]);
  });
});

describe("pexelsOrientation", () => {
  it("suy từ tỷ lệ dự án", () => {
    expect(pexelsOrientation("9:16")).toBe("portrait");
    expect(pexelsOrientation("1:1")).toBe("square");
    expect(pexelsOrientation("16:9")).toBe("landscape");
    expect(pexelsOrientation("gì đó")).toBe("portrait");
  });
});

describe("isSafeImageUrl", () => {
  it("chấp nhận https công khai", () => {
    expect(isSafeImageUrl("https://images.pexels.com/a.jpg")).toBe(true);
  });

  it("chặn scheme không phải https", () => {
    expect(isSafeImageUrl("http://example.com/a.jpg")).toBe(false);
    expect(isSafeImageUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isSafeImageUrl("ftp://example.com/a.jpg")).toBe(false);
  });

  it("chặn host nội bộ", () => {
    expect(isSafeImageUrl("https://localhost/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://127.0.0.1/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://10.0.0.5/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://192.168.1.9/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://172.16.4.2/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(isSafeImageUrl("https://[::1]/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://box.local/a.jpg")).toBe(false);
  });

  it("chặn chuỗi không phải URL", () => {
    expect(isSafeImageUrl("")).toBe(false);
    expect(isSafeImageUrl("không phải url")).toBe(false);
  });
});
