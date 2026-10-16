// Catch up's view model (specs/chat-v2.md §9, round 5 frame 1): one list of
// what's addressed to you, grouped by conversation (newest group first) or,
// as a Display option, newest first. Each row is one item; a chain and an
// Every-message line are one item each, naming their newest message, so a key
// on it acts on that message. Pure: the view (`catchup-view.tsx`) draws it.

import type { ChatCatchupItem, ChatChannel, ChatMember, ChatPerson, ChatUnread } from "../model";
import { conversationTitle } from "../shell/sidebar-model";

export type CatchupOrder = "grouped" | "newest";

export const CATCHUP_ORDERS: readonly CatchupOrder[] = ["grouped", "newest"];

/** Quiet lines: listed, never counted, never a ping. */
export const QUIET_REASONS = new Set(["added", "removed", "level_reset"]);

export type CatchupRow = {
  item: ChatCatchupItem;
  /** Who the line is about (the author, or who added / removed you). */
  who: string | null;
  /** "mentioned you", "replied in a chain you're in"… */
  why: string;
  /** A quiet line: no author, just a sentence. */
  quiet: boolean;
};

export type CatchupGroup = {
  channelId: string;
  title: string;
  kind: ChatChannel["kind"];
  rows: CatchupRow[];
};

/** Why an item is here, as its line says it (frame 1's "mentioned you"). */
export function catchupWhy(item: ChatCatchupItem, conversation: string, newCount: number): string {
  switch (item.reason) {
    case "dm":
      return "direct message";
    case "mention":
      return "mentioned you";
    case "team_mention":
      return "mentioned your team";
    case "everyone":
      return "mentioned everyone";
    case "reply":
      return "replied in a chain you're in";
    case "announcement":
      return "posted an announcement";
    case "every_message":
      return newCount > 0 ? `${conversation} · ${newCount} new` : `${conversation} · new messages`;
    case "reminder":
      return "you asked to be reminded";
    case "added":
      return `added you to ${conversation}`;
    case "removed":
      return `removed you from ${conversation}`;
    case "level_reset":
      return `Chat's defaults changed: ${conversation} now notifies you for mentions and replies.`;
  }
}

export function buildCatchup(input: {
  items: readonly ChatCatchupItem[];
  channels: Readonly<Record<string, ChatChannel>>;
  unread: Readonly<Record<string, ChatUnread>>;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  /** The message's author, when the item names one we hold. */
  authorOf: (item: ChatCatchupItem) => string | null;
  order: CatchupOrder;
}): CatchupGroup[] {
  const { items, channels, unread, selfId, personOf, authorOf, order } = input;
  const titleOf = (id: string) => {
    const c = channels[id];
    return c ? conversationTitle(c, selfId, personOf) : "A conversation";
  };
  const rowOf = (item: ChatCatchupItem): CatchupRow => {
    const quiet = QUIET_REASONS.has(item.reason);
    const line = item.reason === "every_message";
    const who = quiet
      ? item.actorId
        ? (personOf(item.actorId)?.name ?? "Someone")
        : null
      : line
        ? null
        : authorOf(item);
    return {
      item,
      who,
      why: catchupWhy(item, titleOf(item.channelId), unread[item.channelId]?.unread ?? 0),
      quiet,
    };
  };
  const sorted = [...items].sort((a, b) =>
    a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1,
  );
  if (order === "newest") {
    return sorted.length
      ? [{ channelId: "", title: "", kind: "channel", rows: sorted.map(rowOf) }]
      : [];
  }
  const groups = new Map<string, CatchupGroup>();
  for (const item of sorted) {
    let g = groups.get(item.channelId);
    if (!g) {
      g = {
        channelId: item.channelId,
        title: titleOf(item.channelId),
        kind: channels[item.channelId]?.kind ?? "channel",
        rows: [],
      };
      groups.set(item.channelId, g);
    }
    g.rows.push(rowOf(item));
  }
  // Groups in the order of their newest item (the map keeps insertion order).
  return [...groups.values()];
}

/** The rows in the order the list draws them (↑↓ walk this). */
export function flatRows(groups: readonly CatchupGroup[]): CatchupRow[] {
  return groups.flatMap((g) => g.rows);
}

/** After a row leaves, the one to select: the next, else the previous. */
export function nextSelection(
  rows: readonly CatchupRow[],
  leaving: readonly string[],
  current: string | null,
): string | null {
  const gone = new Set(leaving);
  const i = rows.findIndex((r) => r.item.id === current);
  if (i < 0) return rows.find((r) => !gone.has(r.item.id))?.item.id ?? null;
  for (let j = i; j < rows.length; j += 1) {
    const r = rows[j];
    if (r && !gone.has(r.item.id)) return r.item.id;
  }
  for (let j = i - 1; j >= 0; j -= 1) {
    const r = rows[j];
    if (r && !gone.has(r.item.id)) return r.item.id;
  }
  return null;
}

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/**
 * The zero state's second line (§9): conversations with something new that
 * wasn't asked of you ("Three channels have messages you weren't asked about;
 * they'll keep.").
 */
export function quietChannelsLine(
  unread: Readonly<Record<string, ChatUnread>>,
  mine: Readonly<Record<string, ChatMember>>,
): string {
  const n = Object.values(unread).filter((u) => u.unread > 0 && u.catchup === 0 && mine[u.channelId])
    .length;
  if (n === 0) return "Nothing is waiting for you.";
  const count = WORDS[n] ?? String(n);
  return n === 1
    ? `Nothing is waiting for you. ${count} channel has messages you weren't asked about; it'll keep.`
    : `Nothing is waiting for you. ${count} channels have messages you weren't asked about; they'll keep.`;
}
