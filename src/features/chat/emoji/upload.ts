// Getting a picked file ready to be a custom emoji (CV-20, spec §6): the
// browser reads its first bytes for the real type (PNG, JPEG, GIF or WebP;
// never SVG, and the name's extension must say the same), decodes it, scales a
// still image down to 128 px as a PNG, refuses an animated one over 128 px or
// 256 KB (it's stored as it is), draws the still frame shown until you hover,
// and names both by the image's SHA-256. The server checks it all again.

import {
  CUSTOM_EMOJI_EXT,
  CUSTOM_EMOJI_MAX_BYTES,
  CUSTOM_EMOJI_MAX_PX,
  type CustomEmojiMime,
} from "@contracts/vocabularies";

/** What a picked file is, read from its bytes. */
export type SniffedType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** A still image is scaled down, so it may start larger than an emoji. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export class EmojiFileError extends Error {}

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.subarray(at, at + len));

/** The type the bytes say, or null for anything else (SVG and HTML included). */
export function sniffImageType(b: Uint8Array): SniffedType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

const EXTENSIONS: Record<SniffedType, readonly string[]> = {
  "image/png": ["png", "apng"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
};

/** The file's name and declared type agree with what its bytes are. */
export function typeAgrees(sniffed: SniffedType, fileName: string, declared: string): boolean {
  const ext = fileName.includes(".") ? (fileName.split(".").pop() ?? "").toLowerCase() : "";
  if (!EXTENSIONS[sniffed].includes(ext)) return false;
  const d = declared.toLowerCase();
  // Some systems give no type, or the APNG one, for an animated PNG.
  if (d === "" || d === sniffed) return true;
  return sniffed === "image/png" && d === "image/apng";
}

/** More than one frame: a GIF with two images, an animated WebP or an APNG. */
export function isAnimatedImage(b: Uint8Array, type: SniffedType): boolean {
  if (type === "image/png") {
    // acTL before the first IDAT.
    let at = 8;
    while (at + 8 <= b.length) {
      const len = ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
      const kind = ascii(b, at + 4, 4);
      if (kind === "acTL") return true;
      if (kind === "IDAT") return false;
      at += 12 + len;
    }
    return false;
  }
  if (type === "image/webp") {
    // VP8X's animation flag, or an ANIM chunk.
    if (ascii(b, 12, 4) === "VP8X" && b.length > 20 && (b[20]! & 0x02) !== 0) return true;
    for (let at = 12; at + 8 <= b.length; ) {
      const kind = ascii(b, at, 4);
      if (kind === "ANIM" || kind === "ANMF") return true;
      const len = (b[at + 4]! | (b[at + 5]! << 8) | (b[at + 6]! << 16) | (b[at + 7]! << 24)) >>> 0;
      at += 8 + len + (len % 2);
    }
    return false;
  }
  if (type === "image/gif") return gifFrames(b) > 1;
  return false;
}

/** How many images a GIF holds (stops counting at two). */
function gifFrames(b: Uint8Array): number {
  if (b.length < 13) return 0;
  let at = 13;
  const flags = b[10]!;
  if (flags & 0x80) at += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;
  const skipBlocks = () => {
    while (at < b.length) {
      const size = b[at]!;
      at += 1;
      if (size === 0) return;
      at += size;
    }
  };
  while (at < b.length) {
    const tag = b[at]!;
    if (tag === 0x3b) break; // trailer
    if (tag === 0x21) {
      at += 2; // extension introducer + label
      skipBlocks();
    } else if (tag === 0x2c) {
      frames += 1;
      if (frames > 1) return frames;
      const local = b[at + 9]!;
      at += 10;
      if (local & 0x80) at += 3 * (1 << ((local & 0x07) + 1));
      at += 1; // LZW minimum code size
      skipBlocks();
    } else {
      break;
    }
  }
  return frames;
}

/** Fit within `max` a side, never larger than it was. */
export function fitWithin(
  w: number,
  h: number,
  max = CUSTOM_EMOJI_MAX_PX,
): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export type PreparedEmoji = {
  image: Blob;
  mime: CustomEmojiMime;
  width: number;
  height: number;
  bytes: number;
  animated: boolean;
  /** The still frame (PNG), shown until you hover. */
  poster: Blob;
  sha256: string;
};

/** `<workspace>/<sha256>.<ext>` and `<workspace>/<sha256>.poster.png`. */
export function emojiPaths(
  workspaceId: string,
  e: Pick<PreparedEmoji, "sha256" | "mime">,
): { path: string; posterPath: string } {
  return {
    path: `${workspaceId}/${e.sha256}.${CUSTOM_EMOJI_EXT[e.mime]}`,
    posterPath: `${workspaceId}/${e.sha256}.poster.png`,
  };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function drawPng(source: ImageBitmap, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new EmojiFileError("This browser can't read images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new EmojiFileError("Couldn't read that image."))),
      "image/png",
    ),
  );
}

const KB = Math.round(CUSTOM_EMOJI_MAX_BYTES / 1024);

/** Read, check and prepare a picked file; throws EmojiFileError in words. */
export async function prepareEmojiFile(file: File): Promise<PreparedEmoji> {
  if (file.size > MAX_SOURCE_BYTES) throw new EmojiFileError("That file is too large to use.");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const type = sniffImageType(bytes);
  if (!type) throw new EmojiFileError("Use a PNG, GIF, WebP or JPEG image.");
  if (!typeAgrees(type, file.name, file.type)) {
    throw new EmojiFileError("The file's name doesn't match what it is. Rename it and try again.");
  }
  const animated = isAnimatedImage(bytes, type);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type }));
  } catch {
    throw new EmojiFileError("Couldn't read that image.");
  }
  try {
    if (animated) {
      if (bitmap.width > CUSTOM_EMOJI_MAX_PX || bitmap.height > CUSTOM_EMOJI_MAX_PX) {
        throw new EmojiFileError(
          `An animated emoji is at most ${CUSTOM_EMOJI_MAX_PX} × ${CUSTOM_EMOJI_MAX_PX} pixels.`,
        );
      }
      if (file.size > CUSTOM_EMOJI_MAX_BYTES) {
        throw new EmojiFileError(`An animated emoji is at most ${KB} KB.`);
      }
      // A JPEG never animates, so an animated file is one we store as it is.
      const mime = type as CustomEmojiMime;
      const poster = await drawPng(bitmap, bitmap.width, bitmap.height);
      return {
        image: new Blob([buffer], { type: mime }),
        mime,
        width: bitmap.width,
        height: bitmap.height,
        bytes: file.size,
        animated: true,
        poster,
        sha256: await sha256Hex(buffer),
      };
    }
    const { w, h } = fitWithin(bitmap.width, bitmap.height);
    const image = await drawPng(bitmap, w, h);
    if (image.size > CUSTOM_EMOJI_MAX_BYTES) {
      throw new EmojiFileError(`That image is over ${KB} KB even at ${CUSTOM_EMOJI_MAX_PX} px.`);
    }
    const imageBytes = await image.arrayBuffer();
    return {
      image,
      mime: "image/png",
      width: w,
      height: h,
      bytes: image.size,
      animated: false,
      // A still image is its own still frame.
      poster: image,
      sha256: await sha256Hex(imageBytes),
    };
  } finally {
    bitmap.close();
  }
}
