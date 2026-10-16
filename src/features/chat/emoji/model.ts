// Custom workspace emoji (CV-20; spec §6, CH16b): the rows the app reads and
// the rules it shows before the server decides. A name is `:name:` in text
// and reactions, resolved when drawn; a removed one reads as its text. Pure.

import {
  CUSTOM_EMOJI_MAX_BYTES,
  CUSTOM_EMOJI_MAX_PX,
  CUSTOM_EMOJI_PER_WORKSPACE,
  type CustomEmojiMime,
  customEmojiNameOf,
  isCustomEmojiName,
  isReactionKey,
  normalizeCustomEmojiMime,
} from "@contracts/vocabularies";

export type CustomEmoji = {
  id: string;
  workspaceId: string;
  name: string;
  /** Object paths in the private `chat-emoji` bucket. */
  storagePath: string;
  posterPath: string;
  mime: CustomEmojiMime;
  width: number;
  height: number;
  bytes: number;
  animated: boolean;
  /** Who added it (null after their account was deleted). */
  createdBy: string | null;
  createdAt: string;
  deletedAt: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A `chat_custom_emoji` row, or null when it isn't one this build can draw. */
export function mapCustomEmoji(row: unknown): CustomEmoji | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  const workspaceId = str(r.workspace_id);
  const name = str(r.name);
  const storagePath = str(r.storage_path);
  const posterPath = str(r.poster_path);
  const mime = normalizeCustomEmojiMime(r.mime);
  const width = num(r.width);
  const height = num(r.height);
  const createdAt = str(r.created_at);
  if (
    !id ||
    !workspaceId ||
    !isCustomEmojiName(name) ||
    !storagePath ||
    !posterPath ||
    !mime ||
    width === null ||
    height === null ||
    !createdAt
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    name,
    storagePath,
    posterPath,
    mime,
    width,
    height,
    bytes: num(r.bytes) ?? 0,
    animated: r.animated === true,
    createdBy: str(r.created_by),
    createdAt,
    deletedAt: str(r.deleted_at),
  };
}

/** The live ones, newest first (the picker's and Settings' order). */
export function liveEmoji(rows: Iterable<CustomEmoji>): CustomEmoji[] {
  return [...rows]
    .filter((e) => !e.deletedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Merge one changed row into the list (an add, a removal, an erasure's null). */
export function mergeEmoji(rows: readonly CustomEmoji[], row: CustomEmoji): CustomEmoji[] {
  const at = rows.findIndex((e) => e.id === row.id);
  if (at < 0) return [...rows, row];
  const next = rows.slice();
  next[at] = row;
  return next;
}

export const emojiKey = (name: string) => `:${name}:`;

/** The live emoji a reaction key or `:name:` names here, or null (draw it as text). */
export function resolveCustomKey(
  key: string,
  byName: ReadonlyMap<string, CustomEmoji>,
): CustomEmoji | null {
  const name = customEmojiNameOf(key);
  return name ? (byName.get(name) ?? null) : null;
}

/**
 * Whether a quick-row key works here (resolveQuickRow's `usable`): a standard
 * emoji always, a `:name:` only while this workspace has it live.
 */
export function quickRowUsable(byName: ReadonlyMap<string, CustomEmoji>): (key: string) => boolean {
  return (key) => {
    if (!isReactionKey(key)) return false;
    const name = customEmojiNameOf(key);
    return name === null || byName.has(name);
  };
}

/** The `:` menu's custom matches: a name that starts with the query, then one containing it. */
export function matchCustomEmoji(
  list: readonly CustomEmoji[],
  query: string,
  limit = 8,
): CustomEmoji[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const starts = list.filter((e) => e.name.startsWith(q));
  const contains = list.filter((e) => !e.name.startsWith(q) && e.name.includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** A name as typed, tidied the way the server reads it (lowercase, no colons or spaces). */
export function tidyEmojiName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^:+|:+$/g, "")
    .replace(/\s+/g, "_");
}

/**
 * What's wrong with a name, in words, or null. `taken` are the live names
 * here; `reserved` says whether a standard emoji uses it as a shortcode.
 */
export function emojiNameProblem(
  name: string,
  taken: ReadonlySet<string>,
  reserved: (name: string) => boolean,
): string | null {
  if (!name) return "Give it a name.";
  if (!isCustomEmojiName(name)) {
    return "Use 2 to 32 lowercase letters, digits, - or _, with at least one letter.";
  }
  if (reserved(name)) return `:${name}: is a standard emoji. Pick another name.`;
  if (taken.has(name)) return `There's already an emoji called :${name}:.`;
  return null;
}

/** Whether the workspace can take one more. */
export function emojiRoomLeft(liveCount: number): boolean {
  return liveCount < CUSTOM_EMOJI_PER_WORKSPACE;
}

export const EMOJI_LIMITS = {
  bytes: CUSTOM_EMOJI_MAX_BYTES,
  px: CUSTOM_EMOJI_MAX_PX,
  perWorkspace: CUSTOM_EMOJI_PER_WORKSPACE,
} as const;

/** "Added by Mike Chen · Oct 9" (you: "Added by you"; an erased account: no name). */
export function addedByLine(
  e: Pick<CustomEmoji, "createdBy" | "createdAt">,
  selfId: string | null,
  nameOf: (userId: string) => string | null,
  formatDay: (iso: string) => string,
): string {
  const who = !e.createdBy
    ? null
    : e.createdBy === selfId
      ? "you"
      : (nameOf(e.createdBy) ?? "a former member");
  const day = formatDay(e.createdAt);
  return who ? `Added by ${who} · ${day}` : `Added ${day}`;
}
