import { describe, expect, it } from "@rstest/core";
import {
  choosePreviewMime,
  effectiveMime,
  fitWithin,
  type ImageEnv,
  isHeic,
  isImageCandidate,
  jpegHasExif,
  planOriginal,
  prepareUpload,
  renameForMime,
} from "./pipeline";

// A JPEG header: SOI, an APP0 (JFIF) segment, optionally an APP1 Exif segment,
// then start of scan.
function jpegBytes({ exif }: { exif: boolean }): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  parts.push(0xff, 0xe0, 0x00, 0x10, ...Array.from("JFIF\0", (c) => c.charCodeAt(0)));
  parts.push(...new Array(16 - 2 - 5).fill(0));
  if (exif) {
    const payload = [...Array.from("Exif", (c) => c.charCodeAt(0)), 0, 0, 0x4d, 0x4d, 0, 0x2a];
    const len = payload.length + 2;
    parts.push(0xff, 0xe1, len >> 8, len & 0xff, ...payload);
  }
  parts.push(0xff, 0xda, 0x00, 0x02, 0x11, 0x22);
  return new Uint8Array(parts);
}

type FakeImage = { width: number; height: number; alpha?: boolean };

/** Decodes per file name; "encodes" to a blob whose size scales with pixels. */
function fakeEnv(
  images: Record<string, FakeImage | null>,
  opts: { webp?: boolean; bytesPerPixel?: number; refuse?: string[] } = {},
): ImageEnv & { renders: { width: number; height: number; mime: string; quality?: number }[] } {
  const renders: { width: number; height: number; mime: string; quality?: number }[] = [];
  return {
    renders,
    async decode(blob) {
      const img = images[(blob as File).name];
      if (!img) return null;
      return {
        width: img.width,
        height: img.height,
        source: { alpha: !!img.alpha } as unknown as CanvasImageSource,
        close() {},
      };
    },
    async render(_source, width, height, mime, quality) {
      if (opts.refuse?.includes(mime)) return null;
      if (mime === "image/webp" && !opts.webp) return null;
      renders.push({ width, height, mime, quality });
      const size = Math.max(1, Math.round(width * height * (opts.bytesPerPixel ?? 0.1)));
      return new Blob([new Uint8Array(size)], { type: mime });
    },
    hasAlpha(source) {
      return (source as unknown as { alpha: boolean }).alpha;
    },
    async webpEncodable() {
      return !!opts.webp;
    },
  };
}

const file = (bytes: Uint8Array | string, name: string, type: string) =>
  new File([bytes as BlobPart], name, { type });

describe("pure rules", () => {
  it("fits into a max edge without upscaling, keeping the aspect ratio", () => {
    expect(fitWithin(800, 600, 4096)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitWithin(8192, 4096, 4096)).toEqual({ width: 4096, height: 2048, scaled: true });
    expect(fitWithin(3000, 6000, 1280)).toEqual({ width: 640, height: 1280, scaled: true });
  });

  it("finds an EXIF block in a JPEG, and nothing in one without it or in junk", () => {
    expect(jpegHasExif(jpegBytes({ exif: true }))).toBe(true);
    expect(jpegHasExif(jpegBytes({ exif: false }))).toBe(false);
    expect(jpegHasExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(jpegHasExif(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });

  it("guesses a missing type from the extension and spots HEIC", () => {
    expect(effectiveMime("", "IMG_0001.HEIC")).toBe("image/heic");
    expect(effectiveMime("", "notes.unknown")).toBe("application/octet-stream");
    expect(effectiveMime("Image/PNG", "x")).toBe("image/png");
    expect(isHeic("image/heif", "a")).toBe(true);
    expect(isHeic("", "photo.heic")).toBe(true);
    expect(isImageCandidate("image/svg+xml", "logo.svg")).toBe(false);
    expect(isImageCandidate("application/pdf", "a.pdf")).toBe(false);
  });

  it("keeps originals byte-exact unless scaled, EXIF-carrying or HEIC", () => {
    const base = { width: 1200, height: 800, hasExif: false, alpha: false, webpEncodable: true };
    expect(planOriginal({ ...base, mime: "image/png", heic: false })).toEqual({ reencode: false });
    expect(planOriginal({ ...base, mime: "image/jpeg", heic: false })).toEqual({ reencode: false });
    expect(planOriginal({ ...base, mime: "image/jpeg", heic: false, hasExif: true })).toEqual({
      reencode: true,
      mime: "image/jpeg",
      quality: 0.92,
      width: 1200,
      height: 800,
    });
    expect(planOriginal({ ...base, mime: "image/heic", heic: true })).toMatchObject({
      reencode: true,
      mime: "image/jpeg",
      quality: 0.9,
    });
    // >4096 px: PNG stays PNG, a GIF keeps its animation.
    expect(
      planOriginal({ ...base, mime: "image/png", heic: false, width: 9000, height: 3000 }),
    ).toMatchObject({ reencode: true, mime: "image/png", width: 4096, height: 1365 });
    expect(
      planOriginal({ ...base, mime: "image/gif", heic: false, width: 9000, height: 3000 }),
    ).toEqual({ reencode: false });
    // WebP only stays WebP where it can be written; else alpha decides.
    expect(
      planOriginal({
        ...base,
        mime: "image/webp",
        heic: false,
        width: 5000,
        height: 5000,
        webpEncodable: false,
        alpha: true,
      }),
    ).toMatchObject({ mime: "image/png" });
  });

  it("previews as WebP where encodable, PNG with alpha, else JPEG", () => {
    expect(choosePreviewMime({ webpEncodable: true, alpha: true })).toBe("image/webp");
    expect(choosePreviewMime({ webpEncodable: false, alpha: true })).toBe("image/png");
    expect(choosePreviewMime({ webpEncodable: false, alpha: false })).toBe("image/jpeg");
  });

  it("renames a converted file", () => {
    expect(renameForMime("IMG_0001.HEIC", "image/jpeg")).toBe("IMG_0001.jpg");
    expect(renameForMime("shot", "image/png")).toBe("shot.png");
    expect(renameForMime("a.pdf", "application/pdf")).toBe("a.pdf");
  });
});

describe("prepareUpload", () => {
  it("passes non-images through untouched, with no preview", async () => {
    const f = file("hello", "notes.pdf", "application/pdf");
    const out = await prepareUpload(f, { env: fakeEnv({}) });
    expect(out.original).toBe(f);
    expect(out).toMatchObject({ fileName: "notes.pdf", mime: "application/pdf", preview: null });
  });

  it("keeps a screenshot pixel-exact and makes a PNG preview when it has alpha", async () => {
    const f = file("png-bytes", "shot.png", "image/png");
    const env = fakeEnv({ "shot.png": { width: 2880, height: 1800, alpha: true } });
    const out = await prepareUpload(f, { env });
    expect(out.original).toBe(f);
    expect(out.previewMime).toBe("image/png");
    expect(env.renders).toEqual([{ width: 1280, height: 800, mime: "image/png", quality: 0.8 }]);
    expect(out).toMatchObject({ width: 2880, height: 1800 });
  });

  it("re-encodes a JPEG carrying EXIF (location and camera data gone, orientation applied)", async () => {
    const f = file(jpegBytes({ exif: true }), "photo.jpg", "image/jpeg");
    const env = fakeEnv({ "photo.jpg": { width: 3024, height: 4032 } });
    const out = await prepareUpload(f, { env });
    expect(out.original).not.toBe(f);
    expect(out.mime).toBe("image/jpeg");
    expect(env.renders[0]).toEqual({
      width: 3024,
      height: 4032,
      mime: "image/jpeg",
      quality: 0.92,
    });
    expect(out.previewMime).toBe("image/jpeg");
  });

  it("leaves a JPEG without EXIF alone", async () => {
    const f = file(jpegBytes({ exif: false }), "plain.jpg", "image/jpeg");
    const out = await prepareUpload(f, {
      env: fakeEnv({ "plain.jpg": { width: 800, height: 600 } }),
    });
    expect(out.original).toBe(f);
  });

  it("turns HEIC into JPEG where the browser decodes it", async () => {
    const f = file("heic", "IMG_1.HEIC", "image/heic");
    const out = await prepareUpload(f, {
      env: fakeEnv({ "IMG_1.HEIC": { width: 4032, height: 3024 } }, { webp: true }),
    });
    expect(out).toMatchObject({
      fileName: "IMG_1.jpg",
      mime: "image/jpeg",
      previewMime: "image/webp",
    });
  });

  it("keeps HEIC as a plain file (no preview) where the browser can't decode it", async () => {
    const f = file("heic", "IMG_2.heic", "");
    const out = await prepareUpload(f, { env: fakeEnv({ "IMG_2.heic": null }) });
    expect(out.original).toBe(f);
    expect(out).toMatchObject({
      mime: "image/heic",
      preview: null,
      previewMime: null,
      width: null,
    });
  });

  it("scales an image longer than 4096 px", async () => {
    const f = file("png", "huge.png", "image/png");
    const env = fakeEnv({ "huge.png": { width: 10000, height: 5000 } });
    const out = await prepareUpload(f, { env });
    expect(out).toMatchObject({ width: 4096, height: 2048, mime: "image/png" });
  });

  it("scales an image over the per-file limit down instead of refusing it", async () => {
    const f = file(new Uint8Array(12_000_000), "big.png", "image/png");
    // A 12 MB screenshot (4000×3000); the limit is 2 MB.
    const env = fakeEnv({ "big.png": { width: 4000, height: 3000 } }, { bytesPerPixel: 1 });
    const out = await prepareUpload(f, { env, perFileBytes: 2_000_000 });
    expect(out.original.size).toBeLessThanOrEqual(2_000_000);
    expect(out.mime).toBe("image/jpeg");
    expect(out.fileName).toBe("big.jpg");
  });

  it("drops the preview, not the file, when the preview can't be encoded", async () => {
    const f = file("png", "x.png", "image/png");
    const env = fakeEnv({ "x.png": { width: 100, height: 100 } }, { refuse: ["image/jpeg"] });
    const out = await prepareUpload(f, { env });
    expect(out).toMatchObject({ original: f, preview: null, previewMime: null });
  });
});
