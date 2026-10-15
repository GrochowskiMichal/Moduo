// The left panel's model (spec §2, prototype frame 1): Catch up (with its
// count) · hairline · Pinned (only when something is pinned) · Channels
// (alphabetical) · Direct messages (most recent first) · "+ New conversation".
// Unread is weight; a number shows only for what is addressed to you (a direct
// message's unread, your mentions and replies in a channel, every message in a
// channel set to "Every message"); a conversation on "Nothing" still turns
// bold and never counts. Archived channels aren't rows: they open from the
// panel's ⋯.

import type { ChatChannel, ChatMember, ChatPerson, ChatUnread } from "../model";
import { catchupCount } from "./chat-tab";

export type ChatRow = {
  channel: ChatChannel;
  /** The conversation's name as the row shows it (no `#`). */
  title: string;
  /** Something new: the label turns bold. */
  unread: boolean;
  /** What is addressed to you (0 = no number). */
  count: number;
  /** "Nothing": bold when new, never a number. */
  muted: boolean;
  /** For a direct message: the other people (presence, the person card). */
  people: string[];
};

export type ChatSidebarModel = {
  catchup: number;
  pinned: ChatRow[];
  channels: ChatRow[];
  dms: ChatRow[];
  /** Archived channels you can read, newest archive first (the panel's ⋯). */
  archived: ChatRow[];
};

export function dmPeople(channel: ChatChannel, selfId: string): string[] {
  return (channel.dmKey ?? "").split(",").filter((id) => id && id !== selfId);
}

/** A conversation's name: a channel's as typed, a direct message's people. */
export function conversationTitle(
  channel: ChatChannel,
  selfId: string,
  personOf: (id: string) => ChatPerson | undefined,
): string {
  if (channel.kind === "channel") return channel.name ?? "Channel";
  const others = dmPeople(channel, selfId);
  if (others.length === 0) return personOf(selfId)?.name ?? "You";
  return others.map((id) => personOf(id)?.name ?? "Former member").join(", ");
}

const byTitle = (a: ChatRow, b: ChatRow) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
  a.channel.id.localeCompare(b.channel.id);

const byRecent = (a: ChatRow, b: ChatRow) => {
  const at = (r: ChatRow) => r.channel.lastMessageAt ?? r.channel.createdAt;
  return at(b).localeCompare(at(a)) || byTitle(a, b);
};

export function buildChatSidebar(input: {
  channels: Record<string, ChatChannel>;
  mine: Record<string, ChatMember>;
  unread: Record<string, ChatUnread>;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
}): ChatSidebarModel {
  const { channels, mine, unread, selfId, personOf } = input;
  const pinned: ChatRow[] = [];
  const list: ChatRow[] = [];
  const dms: ChatRow[] = [];
  const archived: ChatRow[] = [];
  for (const channel of Object.values(channels)) {
    const member = mine[channel.id];
    const counts = unread[channel.id];
    const muted = member?.notifyLevel === "none";
    const row: ChatRow = {
      channel,
      title: conversationTitle(channel, selfId, personOf),
      unread: !!member && (counts?.unread ?? 0) > 0,
      count: member && !muted ? (counts?.addressed ?? 0) : 0,
      muted,
      people: channel.kind === "dm" ? dmPeople(channel, selfId) : [],
    };
    if (channel.archivedAt) {
      if (channel.kind === "channel") archived.push(row);
      continue;
    }
    // Your conversations only; public channels you're not in are in Browse channels.
    if (!member) continue;
    if (member.starred) pinned.push(row);
    else if (channel.kind === "channel") list.push(row);
    else dms.push(row);
  }
  archived.sort(
    (a, b) =>
      (b.channel.archivedAt ?? "").localeCompare(a.channel.archivedAt ?? "") || byTitle(a, b),
  );
  return {
    catchup: catchupCount({ mine, unread }),
    pinned: pinned.sort(byTitle),
    channels: list.sort(byTitle),
    dms: dms.sort(byRecent),
    archived,
  };
}

/** Every row in the panel's order (⌥↑ / ⌥↓ step through it). */
export function sidebarOrder(model: ChatSidebarModel, collapsed: ReadonlySet<string>): ChatRow[] {
  return [
    ...(collapsed.has("pinned") ? [] : model.pinned),
    ...(collapsed.has("channels") ? [] : model.channels),
    ...(collapsed.has("dms") ? [] : model.dms),
  ];
}
