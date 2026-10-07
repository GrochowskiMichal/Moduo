// Chat timeline — pure list maths (specs/chat.md §Conversation).
//
// Messages are kept oldest→newest. Realtime, optimistic sends and paging all
// funnel through `upsertMessage` / `mergeMessages`, so ordering + dedupe live in
// one tested place. `buildTimeline` turns the list into render rows: day
// dividers, the "New" marker at the read mark, and author grouping.

import type { ChatChannel, ChatMessage, ChatPerson } from "./model";

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
