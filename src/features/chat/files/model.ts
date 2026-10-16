// Files in chat (CV-9, spec §7): what a message's file looks like in the
// stream, and how many a message takes. Pure: the composer, the stream and the
// Files view share it.

import { CHAT_FILES_PER_MESSAGE } from "@contracts/attachments";
import type { ChatFile } from "../model";

/** The media box in the feed, in CSS px (mirrors --feed-media-max-w/h, 360 × 240). */
export const FEED_MEDIA = { w: 360, h: 240 } as const;

export { CHAT_FILES_PER_MESSAGE };

/** How a file shows in a message: a picture or a PDF previews inline, the rest is a chip. */
export type FileShape = "image" | "pdf" | "chip";

export function fileShape(file: Pick<ChatFile, "mime" | "previewPath">): FileShape {
  if (file.mime === "application/pdf") return "pdf";
  // A picture with a preview, or a format the browser draws itself.
  if (file.previewPath) return "image";
  if (/^image\/(png|jpe?g|gif|webp|avif)$/.test(file.mime)) return "image";
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
