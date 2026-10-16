// One custom emoji, drawn (CV-20, spec §6): an <img> of the workspace's own
// image, never an iframe or inline SVG; shown up to its size; an animated one
// shows its still frame and plays only while hovered, never with reduced
// motion. One that can't be drawn (removed, not in this workspace, its link
// not signed yet) reads as its `:name:`.

import { useState } from "react";

import { cn } from "@/lib/utils";

import type { CustomEmoji } from "./model";

const SIZES = {
  /** In a line of text. */
  inline: "size-5 align-text-bottom",
  /** An emoji-only message. */
  jumbo: "size-10 align-bottom",
  /** In a reaction chip or the quick row. */
  reaction: "size-4",
  /** A picker cell. */
  picker: "size-6",
  /** Settings' list. */
  row: "size-7",
} as const;

/** The app's motion setting over the OS's (tokens.css reads the same two). */
export function motionReduced(): boolean {
  if (typeof document === "undefined") return true;
  const pref = document.documentElement.getAttribute("data-motion");
  if (pref === "reduced") return true;
  if (pref === "full") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CustomEmojiGlyph({
  name,
  emoji,
  urlOf,
  size = "inline",
  className,
}: {
  /** The name as written (drawn as `:name:` when there's no image). */
  name: string;
  emoji: CustomEmoji | null | undefined;
  urlOf: (path: string) => string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  const [broken, setBroken] = useState(false);
  const poster = emoji ? urlOf(emoji.posterPath) : null;
  if (!emoji || !poster || broken) {
    return <span className={className}>{`:${name}:`}</span>;
  }
  const playing = emoji.animated && hover && !motionReduced();
  const src = playing ? (urlOf(emoji.storagePath) ?? poster) : poster;
  return (
    <img
      src={src}
      alt={`:${emoji.name}:`}
      title={`:${emoji.name}:`}
      draggable={false}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onMouseEnter={emoji.animated ? () => setHover(true) : undefined}
      onMouseLeave={emoji.animated ? () => setHover(false) : undefined}
      onError={() => setBroken(true)}
      data-custom-emoji={emoji.name}
      data-playing={playing ? "" : undefined}
      className={cn("inline-block object-contain", SIZES[size], className)}
    />
  );
}
