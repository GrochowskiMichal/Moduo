// Prepares a file for upload (specs/attachments.md decision 7, AT2-3):
//   - originals stay byte-exact, except an image longer than 4096 px (scaled),
//     a JPEG carrying EXIF (re-encoded with its orientation applied, so the
//     location/camera data is gone) and HEIC where the browser can decode it
//     (→ JPEG, so everyone can open it);
//   - an image over the plan's per-file limit is scaled down instead of refused;
//   - decodable images get a small preview (1280 px) for thumbnails: WebP where
//     the browser really encodes WebP, else PNG when the image has alpha, else
//     JPEG q0.8.
// HEIC the browser can't decode (Chrome/Firefox/Edge on the web) keeps its
// original and no preview: decided by attempting the decode, never by user agent.
//
// The rules are pure functions (tested); `ImageEnv` is the browser seam
// (createImageBitmap / <img> / canvas), faked in tests.

import type { AttachmentPreviewMime } from "@contracts/vocabularies";

export const ORIGINAL_MAX_EDGE = 4096;
export const PREVIEW_MAX_EDGE = 1280;
const JPEG_ORIGINAL_QUALITY = 0.92;
const HEIC_QUALITY = 0.9;
const PREVIEW_QUALITY = 0.8;
const SHRINK_QUALITY = 0.85;
/** Scale steps tried (of the prepared size) when an image is over the limit. */
const SHRINK_STEPS = [0.8, 0.64, 0.5, 0.4, 0.3, 0.2, 0.12];

export type PreparedUpload = {
  original: Blob;
  fileName: string;
  mime: string;
  preview: Blob | null;
  previewMime: AttachmentPreviewMime | null;
  width: number | null;
  height: number | null;
};

export type ImageHandle = {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
};

export type ImageEnv = {
  /** Decode with EXIF orientation applied; null when the browser can't. */
  decode(blob: Blob): Promise<ImageHandle | null>;
  /** Draw at width×height and encode; null when this browser can't produce `mime`. */
  render(
    source: CanvasImageSource,
    width: number,
    height: number,
    mime: string,
    quality?: number,
  ): Promise<Blob | null>;
  hasAlpha(source: CanvasImageSource, width: number, height: number): boolean;
  webpEncodable(): Promise<boolean>;
};

// ── pure rules ────────────────────────────────────────────────────────────────

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  mov: "video/quicktime",
  mp4: "video/mp4",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
};

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/** The file's type, or one guessed from its extension (Finder/HEIC drops can
 *  arrive with an empty `type`). */
export function effectiveMime(type: string, name: string): string {
  const t = type.trim().toLowerCase();
  if (t) return t;
  return EXT_MIME[extOf(name)] ?? "application/octet-stream";
}

export function isHeic(mime: string, name: string): boolean {
  return /^image\/hei[cf](-sequence)?$/.test(mime) || /^(heic|heif)$/.test(extOf(name));
}

const RASTER = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
]);

/** Worth trying to decode for a preview. SVG is left a file: it's a document. */
export function isImageCandidate(mime: string, name: string): boolean {
  return RASTER.has(mime) || isHeic(mime, name);
}

/** Scale into a max edge, keeping the aspect ratio (never up). */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height, scaled: false };
  const k = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
    scaled: true,
  };
}

/**
 * Does this JPEG carry an EXIF block (APP1 "Exif\0\0")? Walks the markers up to
 * the start of scan; anything malformed answers false.
 */
export function jpegHasExif(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return false;
    const marker = bytes[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return false; // start of scan / end
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return false;
    if (
      marker === 0xe1 &&
      i + 10 <= bytes.length &&
      bytes[i + 4] === 0x45 && // E
      bytes[i + 5] === 0x78 && // x
      bytes[i + 6] === 0x69 && // i
      bytes[i + 7] === 0x66 && // f
      bytes[i + 8] === 0 &&
      bytes[i + 9] === 0
    ) {
      return true;
    }
    i += 2 + len;
  }
  return false;
}

export type OriginalPlan =
  | { reencode: false }
  | { reencode: true; mime: string; quality: number | undefined; width: number; height: number };

/** What happens to the original (decision 7). */
export function planOriginal(input: {
  mime: string;
  heic: boolean;
  width: number;
  height: number;
  hasExif: boolean;
  alpha: boolean;
  webpEncodable: boolean;
}): OriginalPlan {
  const fit = fitWithin(input.width, input.height, ORIGINAL_MAX_EDGE);
  const at = (mime: string, quality?: number): OriginalPlan => ({
    reencode: true,
    mime,
    quality,
    width: fit.width,
    height: fit.height,
  });
  if (input.heic) return at("image/jpeg", HEIC_QUALITY);
  // Animation would be lost; a GIF is kept as it is (its preview is frame 1).
  if (input.mime === "image/gif") return { reencode: false };
  if (input.mime === "image/jpeg") {
    return input.hasExif || fit.scaled
      ? at("image/jpeg", JPEG_ORIGINAL_QUALITY)
      : { reencode: false };
  }
  if (!fit.scaled) return { reencode: false };
  if (input.mime === "image/png") return at("image/png");
  if (input.mime === "image/webp" && input.webpEncodable)
    return at("image/webp", JPEG_ORIGINAL_QUALITY);
  return input.alpha ? at("image/png") : at("image/jpeg", JPEG_ORIGINAL_QUALITY);
}

/** Preview format: WebP only where it's really encodable, PNG to keep alpha
 *  (no black/white matte), else JPEG. */
export function choosePreviewMime(input: {
  webpEncodable: boolean;
  alpha: boolean;
}): AttachmentPreviewMime {
  if (input.webpEncodable) return "image/webp";
  return input.alpha ? "image/png" : "image/jpeg";
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** photo.HEIC → photo.jpg once it has become a JPEG. */
export function renameForMime(fileName: string, mime: string): string {
  const ext = MIME_EXT[mime];
  if (!ext) return fileName;
  const base = fileName.replace(/\.[A-Za-z0-9]{1,10}$/, "");
  return `${base || "image"}.${ext}`;
}

const ALPHA_CAPABLE = new Set(["image/png", "image/webp", "image/gif", "image/avif"]);

// ── the pipeline ──────────────────────────────────────────────────────────────

function passthrough(file: File, mime: string): PreparedUpload {
  return {
    original: file,
    fileName: file.name || "file",
    mime,
    preview: null,
    previewMime: null,
    width: null,
    height: null,
  };
}

export async function prepareUpload(
  file: File,
  opts: { perFileBytes?: number | null; env?: ImageEnv } = {},
): Promise<PreparedUpload> {
  const name = file.name || "file";
  const mime = effectiveMime(file.type, name);
  if (!isImageCandidate(mime, name)) return passthrough(file, mime);
  const env = opts.env ?? browserImageEnv();
  const heic = isHeic(mime, name);

  const img = await env.decode(file).catch(() => null);
  if (!img) return passthrough(file, mime);
  try {
    const hasExif =
      mime === "image/jpeg"
        ? jpegHasExif(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()))
        : false;
    const alpha = ALPHA_CAPABLE.has(mime) && env.hasAlpha(img.source, img.width, img.height);
    const webp = await env.webpEncodable();

    let original: Blob = file;
    let outMime = mime;
    let outName = name;
    let width = img.width;
    let height = img.height;

    const plan = planOriginal({ mime, heic, width, height, hasExif, alpha, webpEncodable: webp });
    if (plan.reencode) {
      const blob = await env.render(img.source, plan.width, plan.height, plan.mime, plan.quality);
      if (blob) {
        original = blob;
        outMime = plan.mime;
        outName = renameForMime(name, plan.mime);
        width = plan.width;
        height = plan.height;
      } else if (heic) {
        // Decoded but can't be written as JPEG: keep the HEIC as a plain file.
        return passthrough(file, mime);
      }
    }

    // Over the plan's per-file limit: scale down rather than refuse.
    const limit = opts.perFileBytes ?? null;
    if (limit != null && original.size > limit) {
      const shrinkMime = alpha ? (webp ? "image/webp" : "image/png") : "image/jpeg";
      for (const step of SHRINK_STEPS) {
        const w = Math.max(1, Math.round(width * step));
        const h = Math.max(1, Math.round(height * step));
        const blob = await env.render(img.source, w, h, shrinkMime, SHRINK_QUALITY);
        if (!blob) break;
        if (blob.size <= limit) {
          original = blob;
          outMime = shrinkMime;
          outName = renameForMime(name, shrinkMime);
          width = w;
          height = h;
          break;
        }
      }
    }

    const previewMime = choosePreviewMime({ webpEncodable: webp, alpha });
    const pv = fitWithin(img.width, img.height, PREVIEW_MAX_EDGE);
    const preview = await env
      .render(img.source, pv.width, pv.height, previewMime, PREVIEW_QUALITY)
      .catch(() => null);

    return {
      original,
      fileName: outName,
      mime: outMime,
      preview,
      previewMime: preview ? previewMime : null,
      width,
      height,
    };
  } finally {
    img.close();
  }
}

// ── the browser seam ─────────────────────────────────────────────────────────

let webpProbe: Promise<boolean> | null = null;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
}

async function decodeWithImg(blob: Blob): Promise<ImageHandle | null> {
  const url = URL.createObjectURL(blob);
  const release = () => URL.revokeObjectURL(url);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) {
      release();
      return null;
    }
    return { width: img.naturalWidth, height: img.naturalHeight, source: img, close: release };
  } catch {
    release();
    return null;
  }
}

export function browserImageEnv(): ImageEnv {
  return {
    async decode(blob) {
      if (typeof createImageBitmap === "function") {
        try {
          const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
          return { width: bmp.width, height: bmp.height, source: bmp, close: () => bmp.close() };
        } catch {
          // WebKit decodes HEIC through <img> only.
        }
      }
      return decodeWithImg(blob);
    },
    async render(source, width, height, mime, quality) {
      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      if (mime === "image/jpeg") {
        // JPEG has no alpha: paint white under it instead of black.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, width, height);
      const blob = await toBlob(canvas, mime, quality);
      // Safari/WKWebView silently answer PNG when asked for WebP.
      return blob && blob.type === mime ? blob : null;
    },
    hasAlpha(source, width, height) {
      const w = Math.min(width, 64);
      const h = Math.min(height, 64);
      const ctx = makeCanvas(w, h).getContext("2d", { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(source, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
      return false;
    },
    webpEncodable() {
      webpProbe ??= toBlob(makeCanvas(1, 1), "image/webp").then((b) => b?.type === "image/webp");
      return webpProbe;
    },
  };
}
