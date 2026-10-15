// Chat timeline — pure list maths (specs/chat.md §Conversation).
//
// Messages are kept oldest→newest. Realtime, optimistic sends and paging all
// funnel through `upsertMessage` / `mergeMessages`, so ordering + dedupe live in
// one tested place. `buildTimeline` turns the list into render rows: day
// dividers, the "New" marker at the read mark, and author grouping.

import type { ChatChannel, ChatKey, ChatMessage, ChatPerson } from "./model";
import { compareKeys, keyOf } from "./store/keys";

/** Consecutive messages by one author within this window collapse together. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Insert or replace one message. An optimistic row (matched by clientId) is
 * replaced by its confirmed twin; an older realtime echo never overwrites a
 * newer local state of the same row unless it carries edits/reactions.
 */
export function upsertMessage(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const idx = list.findIndex(
    (m) => m.id === msg.id || (msg.clientId !== null && m.clientId === msg.clientId),
  );
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = { ...msg, pending: false, failed: false };
    // createdAt can move when the server stamps an optimistic row — re-sort.
    return next.sort(compareMessages);
  }
  // Fast path: appending the newest message.
  const last = list[list.length - 1];
  if (!last || compareMessages(last, msg) <= 0) return [...list, msg];
  return [...list, msg].sort(compareMessages);
}

/** Merge a page (any order) into the list, deduping by id. */
export function mergeMessages(list: ChatMessage[], page: ChatMessage[]): ChatMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of page) {
    const existing = byId.get(m.id);
    // Keep a local optimistic flag off a confirmed row.
    byId.set(m.id, existing ? { ...existing, ...m, pending: false, failed: false } : m);
  }
  return [...byId.values()].sort(compareMessages);
}

export type TimelineRow =
  | { kind: "day"; key: string; date: string }
  | { kind: "new"; key: string }
  | { kind: "message"; key: string; message: ChatMessage; grouped: boolean };

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Render rows. `lastReadAt` places the "New" marker before the first message
 * from someone else after the read mark (never before your own).
 */
export function buildTimeline(
  messages: ChatMessage[],
  opts: { lastReadAt?: string | null; selfId?: string | null } = {},
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let prev: ChatMessage | null = null;
  let newPlaced = false;
  for (const m of messages) {
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    if (newDay) rows.push({ kind: "day", key: `day:${dayKey(m.createdAt)}`, date: m.createdAt });

    let markNew = false;
    if (
      !newPlaced &&
      opts.lastReadAt &&
      m.createdAt > opts.lastReadAt &&
      m.authorId !== opts.selfId &&
      !m.pending
    ) {
      rows.push({ kind: "new", key: "new" });
      newPlaced = true;
      markNew = true;
    }

    const grouped =
      !!prev &&
      !newDay &&
      !markNew &&
      !prev.deletedAt &&
      !m.deletedAt &&
      prev.authorId === m.authorId &&
      // Two different apps both have authorId null — never merge them.
      prev.authorKind === m.authorKind &&
      prev.authorLabel === m.authorLabel &&
      prev.replyCount === 0 &&
      Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;

    rows.push({ kind: "message", key: m.clientId ?? m.id, message: m, grouped });
    prev = m;
  }
  return rows;
}

// ── Chat v2's stream (CV-7a) ────────────────────────────────────────────────
//
// `buildStream` turns a store window (`ChatWindow.rows`, oldest first) into the
// rows `MessageStream` draws: centred day separators, the "New" pill at the
// read mark, message rows that know whether they start a new person (24/20/16
// px above) or continue one (6 px), event lines, and "Deleted message" for a
// deleted message that still has replies. Keys are ids, so a row keeps its
// measured height across renders (the measurement cache).

export type StreamItem =
  | { type: "day"; key: string; at: string }
  | { type: "new"; key: "new" }
  | { type: "message"; key: string; message: ChatMessage; first: boolean }
  | { type: "deleted"; key: string; message: ChatMessage; first: boolean }
  | { type: "event"; key: string; message: ChatMessage };

/** The local calendar day of a stamp, `YYYY-MM-DD` (separators and their keys). */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sameAuthor(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.authorId === b.authorId && a.authorKind === b.authorKind && a.authorLabel === b.authorLabel
  );
}


/**
 * The stream's rows.
 * - `hasOlder`: the window's oldest row is the one past the edge (the store
 *   loads 51 and the stream draws 50): it sets the first drawn row's grouping
 *   and separator but isn't drawn.
 * - `newAfter`: the read mark when the conversation opened (it never moves
 *   while open). The pill sits before the first message after it from someone
 *   else; your own messages and unsent sends never count.
 * - `hidden`: ids deleted on this screen and still inside their Undo time.
 */
export function buildStream(
  rows: readonly ChatMessage[],
  opts: {
    hasOlder?: boolean;
    newAfter?: ChatKey | null;
    selfId?: string | null;
    hidden?: ReadonlySet<string>;
  } = {},
): StreamItem[] {
  const out: StreamItem[] = [];
  const seen = new Set<string>();
  let prev: ChatMessage | null = null;
  let newPlaced = !opts.newAfter;
  const start = opts.hasOlder && rows.length > 0 ? 1 : 0;
  if (start === 1) prev = rows[0] ?? null;
  if (prev) seen.add(prev.id);

  for (let i = start; i < rows.length; i += 1) {
    const m = rows[i]!;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (opts.hidden?.has(m.id)) continue;
    // A deleted message without replies leaves no trace.
    if (m.deletedAt && m.replyCount === 0 && m.kind !== "event") continue;

    const day = localDay(m.createdAt);
    const newDay = !prev || localDay(prev.createdAt) !== day;
    if (newDay) out.push({ type: "day", key: `d:${day}`, at: m.createdAt });

    let afterPill = false;
    if (
      !newPlaced &&
      opts.newAfter &&
      m.kind !== "event" &&
      !m.sendState &&
      m.authorId !== (opts.selfId ?? undefined) &&
      compareKeys(opts.newAfter, keyOf(m)) < 0
    ) {
      out.push({ type: "new", key: "new" });
      newPlaced = true;
      afterPill = true;
    }

    if (m.kind === "event") {
      out.push({ type: "event", key: m.id, message: m });
      prev = m;
      continue;
    }

    const first =
      !prev ||
      newDay ||
      afterPill ||
      prev.kind === "event" ||
      !!prev.deletedAt ||
      !!m.deletedAt ||
      !sameAuthor(prev, m) ||
      Date.parse(m.createdAt) - Date.parse(prev.createdAt) >= GROUP_WINDOW_MS;

    out.push(
      m.deletedAt
        ? { type: "deleted", key: m.id, message: m, first: true }
        : { type: "message", key: m.id, message: m, first },
    );
    prev = m;
  }
  return out;
}

/**
 * The read mark's candidate: the newest server message at or above `index`
 * (the last row on screen). Unsent sends and event lines never count; null
 * when nothing on screen is a message.
 */
export function lastSeenMessage(items: readonly StreamItem[], index: number): ChatMessage | null {
  for (let i = Math.min(index, items.length - 1); i >= 0; i -= 1) {
    const it = items[i]!;
    if (it.type !== "message" && it.type !== "deleted") continue;
    if (it.message.sendState) continue;
    return it.message;
  }
  return null;
}

/** How many messages from others arrived after `afterId` (the floating "N new ↓" chip). */
export function countNewSince(
  rows: readonly ChatMessage[],
  afterId: string | null,
  selfId: string | null,
): number {
  if (!afterId) return 0;
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const m = rows[i]!;
    if (m.id === afterId) return n;
    if (m.kind === "event" || m.sendState || m.deletedAt || m.authorId === selfId) continue;
    n += 1;
  }
  return 0;
}

// Emoji-only messages draw large ("jumbo", CH29): one paragraph of at most
// this many emoji and nothing else but spaces.
export const JUMBO_MAX = 8;
const EMOJI_RUN = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|️|‍|\s)+$/u;
const EMOJI_ONE =
  /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*/gu;

/** True when a plain text is only emoji (1…JUMBO_MAX of them). */
export function isEmojiOnlyText(text: string, customEmoji = 0): boolean {
  const t = text.trim();
  if (!t) return customEmoji > 0 && customEmoji <= JUMBO_MAX;
  if (/[0-9#*]/.test(t) || !EMOJI_RUN.test(t)) return false;
  const n = (t.match(EMOJI_ONE)?.length ?? 0) + customEmoji;
  return n > 0 && n <= JUMBO_MAX;
}

// ── Reactions ────────────────────────────────────────────────────────────────

/** Optimistic toggle — mirrors chat_op_react. */
export function toggleReaction(
  reactions: Record<string, string[]>,
  emoji: string,
  userId: string,
): Record<string, string[]> {
  const list = reactions[emoji] ?? [];
  const next = { ...reactions };
  if (list.includes(userId)) {
    const rest = list.filter((u) => u !== userId);
    if (rest.length === 0) delete next[emoji];
    else next[emoji] = rest;
  } else {
    next[emoji] = [...list, userId];
  }
  return next;
}

// ── Channels / sidebar ───────────────────────────────────────────────────────

/** Same normalization as public.chat_normalize_channel_name — keep in lockstep. */
export function normalizeChannelName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Everyone in a DM except me (a DM with only me is "notes to self"). */
export function dmOtherIds(channel: ChatChannel, selfId: string): string[] {
  return (channel.dmKey ?? "").split(",").filter((id) => id && id !== selfId);
}

export function channelTitle(
  channel: ChatChannel,
  selfId: string,
  personOf: (id: string) => ChatPerson | undefined,
): string {
  if (channel.kind === "channel") return channel.name ?? "channel";
  const others = dmOtherIds(channel, selfId);
  if (others.length === 0) return `${personOf(selfId)?.name ?? "You"} (you)`;
  return others.map((id) => personOf(id)?.name ?? "Former member").join(", ");
}

export type SidebarEntry = {
  channel: ChatChannel;
  unread: number;
  mentions: number;
  starred: boolean;
  muted: boolean;
  isMember: boolean;
};

export type SidebarSections = {
  starred: SidebarEntry[];
  channels: SidebarEntry[];
  dms: SidebarEntry[];
};

/**
 * Sidebar order: Starred (by name), Channels I'm in (alphabetical, Slack-like),
 * Direct messages (most recent first — people think of DMs by recency).
 * Archived channels and public channels I haven't joined stay out of the rail
 * (they're in "Browse channels").
 */
export function buildSidebar(
  entries: SidebarEntry[],
  titleOf: (c: ChatChannel) => string,
): SidebarSections {
  const live = entries.filter((e) => !e.channel.archivedAt && e.isMember);
  const byName = (a: SidebarEntry, b: SidebarEntry) =>
    titleOf(a.channel).localeCompare(titleOf(b.channel));
  const byRecent = (a: SidebarEntry, b: SidebarEntry) =>
    (b.channel.lastMessageAt ?? b.channel.createdAt).localeCompare(
      a.channel.lastMessageAt ?? a.channel.createdAt,
    );
  return {
    starred: live.filter((e) => e.starred).sort(byName),
    channels: live.filter((e) => !e.starred && e.channel.kind === "channel").sort(byName),
    dms: live.filter((e) => !e.starred && e.channel.kind === "dm").sort(byRecent),
  };
}

/**
 * The nav badge: DMs count every unread, channels only count mentions unless
 * the user set them to "all" (quiet bar). Muted channels never count.
 */
export function badgeCount(
  entries: SidebarEntry[],
  levelOf: (channelId: string) => string,
): number {
  let n = 0;
  for (const e of entries) {
    if (e.muted || e.channel.archivedAt) continue;
    if (e.channel.kind === "dm" || levelOf(e.channel.id) === "all") n += e.unread;
    else n += e.mentions;
  }
  return n;
}
