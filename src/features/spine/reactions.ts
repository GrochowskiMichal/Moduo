// Reactions on messages and comments (CV-7c; spec §6, CH16a, CH49): any emoji
// is a key (REACTION_KEY in @contracts, one server check); your quick row is
// up to six of them (null = Moduo's six). Reactions never notify. Pure.

import {
  DEFAULT_QUICK_REACTIONS,
  isReactionKey,
  MAX_QUICK_REACTIONS,
  type ReactionKey,
} from "@contracts/vocabularies";

import type { CommentReactionMark } from "@/lib/runtime.types";

/** What a screen reader says for Moduo's six (the glyph alone reads
 *  inconsistently); any other emoji is read as itself. */
const DEFAULT_NAMES: Record<string, string> = {
  "👍": "Thumbs up",
  "✅": "Done",
  "👀": "Looking",
  "🙏": "Thanks",
  "❤️": "Love",
  "😄": "Smile",
};

export function reactionName(key: ReactionKey): string {
  return DEFAULT_NAMES[key] ?? key;
}

/**
 * Your quick row from what you saved: your keys in your order, a key this
 * build or workspace can't use skipped, then Moduo's six fill the row to six
 * (CH16a). `usable` is where CV-20 checks a `:custom:` is live here.
 */
export function resolveQuickRow(
  saved: readonly string[] | null | undefined,
  usable: (key: string) => boolean = isReactionKey,
): ReactionKey[] {
  const row: ReactionKey[] = [];
  for (const key of saved ?? []) {
    if (row.length >= MAX_QUICK_REACTIONS) break;
    if (usable(key) && !row.includes(key)) row.push(key);
  }
  for (const key of DEFAULT_QUICK_REACTIONS) {
    if (row.length >= MAX_QUICK_REACTIONS) break;
    if (!row.includes(key)) row.push(key);
  }
  return row;
}

export type ReactionGroup = {
  key: ReactionKey;
  count: number;
  /** I reacted with it. */
  mine: boolean;
  /** Who, for the hover: "You" first, then names in the order they reacted. */
  people: string[];
};

/** A comment's reactions, one group per key, in the order each was first used. */
export function groupReactions(
  marks: readonly CommentReactionMark[],
  currentUserId: string | null,
  nameOf: (userId: string) => string | null,
): ReactionGroup[] {
  const byKey = new Map<ReactionKey, string[]>();
  for (const m of marks) {
    const who = byKey.get(m.reaction);
    if (who) who.push(m.userId);
    else byKey.set(m.reaction, [m.userId]);
  }
  return [...byKey].map(([key, ids]) => groupOf(key, ids, currentUserId, nameOf));
}

/** A message's reactions (`{key: [user ids]}`), in the order the server keeps them. */
export function groupMessageReactions(
  reactions: Readonly<Record<string, readonly string[]>>,
  currentUserId: string | null,
  nameOf: (userId: string) => string | null,
): ReactionGroup[] {
  return Object.entries(reactions)
    .filter(([, ids]) => ids.length > 0)
    .map(([key, ids]) => groupOf(key, ids, currentUserId, nameOf));
}

function groupOf(
  key: ReactionKey,
  ids: readonly string[],
  currentUserId: string | null,
  nameOf: (userId: string) => string | null,
): ReactionGroup {
  const mine = !!currentUserId && ids.includes(currentUserId);
  const others = ids
    .filter((id) => id !== currentUserId)
    .map((id) => nameOf(id) ?? "Former member");
  return { key, count: ids.length, mine, people: mine ? ["You", ...others] : others };
}

/** "You, Mike and Anna" for the hover. */
export function reactedBy(people: readonly string[]): string {
  if (people.length <= 1) return people[0] ?? "";
  return `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
}
