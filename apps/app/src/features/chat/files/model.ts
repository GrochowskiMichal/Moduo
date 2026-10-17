// Files in chat (CV-9, spec §7): what a message's file looks like in the
// stream, and how many a message takes. Pure: the composer, the stream and the
// Files view share it.

import { CHAT_FILES_PER_MESSAGE } from "@contracts/attachments";
import type { ChatFile } from "../model";

/** The media box in the feed, in CSS px (mirrors --feed-media-max-w/h, 360 × 240). */
export const FEED_MEDIA = { w: 360, h: 240 } as const;

export { CHAT_FILES_PER_MESSAGE };

/** How a file shows in a message: a picture draws inline, a PDF is a document card, the rest is a chip. */
export type FileShape = "image" | "pdf" | "chip";

/**
 * The only pictures drawn inline, by their stored type and the name's ending
 * together (a type the name contradicts is a chip). Never SVG, HTML, XML or
 * scripts: they are only ever downloaded. Pictures are drawn with <img> only.
 */
const INLINE_IMAGES: Readonly<Record<string, readonly string[]>> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
};

function extensionOf(name: string): string {
  return /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase() ?? "";
}

export function fileShape(file: Pick<ChatFile, "mime" | "fileName">): FileShape {
  const mime = file.mime.trim().toLowerCase();
  const ext = extensionOf(file.fileName);
  if (INLINE_IMAGES[mime]?.includes(ext)) return "image";
  if (mime === "application/pdf" && ext === "pdf") return "pdf";
  return "chip";
}

/**
 * A picture's stored size fit inside the media box (never enlarged), so its
 * row's height is known before it loads. Unknown size: the whole box.
 */
export function fitMedia(
  width: number | null,
  height: number | null,
  box: { w: number; h: number } = FEED_MEDIA,
): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0) return { width: box.w, height: box.h };
  const scale = Math.min(1, box.w / width, box.h / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Adding files to a message that already holds `current`: how many fit and
 * how many are refused (before any upload, spec §Edge cases: "the eleventh is
 * refused before upload").
 */
export function takeFiles(
  current: number,
  adding: number,
  cap: number = CHAT_FILES_PER_MESSAGE,
): { take: number; refused: number } {
  const room = Math.max(0, cap - Math.max(0, current));
  const take = Math.min(room, Math.max(0, adding));
  return { take, refused: Math.max(0, adding) - take };
}

/** The line shown when files were refused for the cap. */
export function capNotice(refused: number, cap: number = CHAT_FILES_PER_MESSAGE): string | null {
  if (refused <= 0) return null;
  return refused === 1
    ? `A message holds up to ${cap} files: 1 wasn't added`
    : `A message holds up to ${cap} files: ${refused} weren't added`;
}

/**
 * Whether any of a composer's files would go with the send: a file that
 * stopped never does, so a message of only stopped files has nothing to send.
 */
export function hasSendableFiles(
  files: readonly { state: "uploading" | "ready" | "failed" }[] | null | undefined,
): boolean {
  return !!files?.some((f) => f.state !== "failed");
}
