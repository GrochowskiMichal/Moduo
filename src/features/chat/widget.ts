// Home "Conversations" widget — pure shaping (specs/chat.md §Widget).
// Conversations that need you first (DM unread, mentions, "every message"
// channels with unread), then the most recently active. Muted and archived
// conversations never surface; channels you haven't joined stay out.

import type { ChatChannel, ChatMember, ChatPerson, ChatUnread } from "./model";
import { channelTitle } from "./timeline";

export type ChatWidgetRow = {
  channelId: string;
  title: string;
  kind: ChatChannel["kind"];
  isPrivate: boolean;
  /** What counts for you here: DM unread, or channel mentions (or unread when set to all). */
  count: number;
  /** Unread at all (weight), even when count is 0. */
  unread: boolean;
  lastMessageAt: string | null;
};

export type ChatWidgetView = { rows: ChatWidgetRow[]; needsYou: number };

export function shapeChatWidget(input: {
  channels: ChatChannel[];
  mine: ChatMember[];
  unread: ChatUnread[];
  people: Record<string, ChatPerson>;
  selfId: string;
  limit: number;
}): ChatWidgetView {
  const memberOf = new Map(input.mine.map((m) => [m.channelId, m]));
  const unreadOf = new Map(input.unread.map((u) => [u.channelId, u]));
  const personOf = (id: string) => input.people[id];
  const rows: ChatWidgetRow[] = [];
  for (const c of input.channels) {
    const member = memberOf.get(c.id);
    if (!member || c.archivedAt || member.notifyLevel === "none") continue;
    const u = unreadOf.get(c.id);
    const count =
      c.kind === "dm" || member.notifyLevel === "all" ? (u?.unread ?? 0) : (u?.mentions ?? 0);
    rows.push({
      channelId: c.id,
      title: channelTitle(c, input.selfId, personOf),
      kind: c.kind,
      isPrivate: c.isPrivate,
      count,
      unread: (u?.unread ?? 0) > 0,
      lastMessageAt: c.lastMessageAt,
    });
  }
  rows.sort((a, b) => {
    if ((b.count > 0 ? 1 : 0) !== (a.count > 0 ? 1 : 0)) return b.count > 0 ? 1 : -1;
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
  });
  return {
    rows: rows.slice(0, Math.max(0, input.limit)),
    needsYou: rows.reduce((n, r) => n + r.count, 0),
  };
}
