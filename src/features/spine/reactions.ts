// The six comment reactions (Tasks v3 REPLAN 88): fixed, in this order, and
// never a notification. The words are the stored vocabulary
// (COMMENT_REACTIONS in @contracts); the glyphs and spoken names live here.
// Pure.

import { COMMENT_REACTIONS, type CommentReaction } from "@contracts/vocabularies";

import type { CommentReactionMark } from "@/lib/runtime.types";

export const REACTION_GLYPHS: Record<CommentReaction, string> = {
  thumbs_up: "👍",
  check: "✅",
  eyes: "👀",
  pray: "🙏",
  heart: "❤️",
  smile: "😄",
};

/** What a screen reader says for each (the glyph alone reads inconsistently). */
export const REACTION_NAMES: Record<CommentReaction, string> = {
  thumbs_up: "Thumbs up",
  check: "Done",
  eyes: "Looking",
  pray: "Thanks",
  heart: "Love",
  smile: "Smile",
};

export type ReactionGroup = {
  reaction: CommentReaction;
  count: number;
  /** I reacted with it. */
  mine: boolean;
  /** Who, for the hover: "You" first, then names in the order they reacted. */
  people: string[];
};

/** A comment's reactions, one group per reaction used, in the fixed order. */
export function groupReactions(
  marks: readonly CommentReactionMark[],
  currentUserId: string | null,
  nameOf: (userId: string) => string | null,
): ReactionGroup[] {
  const groups: ReactionGroup[] = [];
  for (const reaction of COMMENT_REACTIONS) {
    const who = marks.filter((m) => m.reaction === reaction);
    if (who.length === 0) continue;
    const mine = who.some((m) => m.userId === currentUserId);
    const others = who
      .filter((m) => m.userId !== currentUserId)
      .map((m) => nameOf(m.userId) ?? "Former member");
    groups.push({ reaction, count: who.length, mine, people: mine ? ["You", ...others] : others });
  }
  return groups;
}

/** "You, Mike and Anna" for the hover. */
export function reactedBy(people: readonly string[]): string {
  if (people.length <= 1) return people[0] ?? "";
  return `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
}
