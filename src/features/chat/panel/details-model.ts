// The pure half of Chat's right panel and dialogs (CV-8b, spec §12): who is
// in a conversation and in what order, what Browse channels lists, and what
// New conversation may send. The screens draw these; the server decides.

import type { ChatChannel, ChatMember, ChatMessage, ChatPerson } from "../model";

/** A person in Details' People list. */
export type DetailsPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  self: boolean;
  online: boolean;
  /** Left the workspace: their name stays, quietly labelled. */
  former: boolean;
};

/** You first, then everyone else by name (frame 4). */
export function detailsPeople(
  members: readonly Pick<ChatMember, "userId">[],
  selfId: string,
  personOf: (id: string) => ChatPerson | undefined,
  online: (id: string) => boolean,
): DetailsPerson[] {
  const seen = new Set<string>();
  const out: DetailsPerson[] = [];
  for (const m of members) {
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    const p = personOf(m.userId);
    out.push({
      userId: m.userId,
      name: p?.name ?? "Former member",
      avatarUrl: p?.avatarUrl ?? null,
      self: m.userId === selfId,
      online: m.userId === selfId || online(m.userId),
      former: !p || p.former === true,
    });
  }
  return out.sort((a, b) => (a.self !== b.self ? (a.self ? -1 : 1) : a.name.localeCompare(b.name)));
}

/** One row of Browse channels (frame 3, browse). */
export type BrowseRow = {
  channel: ChatChannel;
  /** You're in it: "Open" instead of "Join". */
  joined: boolean;
};

/** Public channels: the ones you can join or open, then Archived (read only), each by name. */
export function browseChannels(
  channels: Readonly<Record<string, ChatChannel>>,
  mine: Readonly<Record<string, ChatMember>>,
): { open: BrowseRow[]; archived: BrowseRow[] } {
  const rows = Object.values(channels)
    .filter((c) => c.kind === "channel" && !c.isPrivate)
    .map((channel) => ({ channel, joined: !!mine[channel.id] }))
    .sort((a, b) => (a.channel.name ?? "").localeCompare(b.channel.name ?? ""));
  return {
    open: rows.filter((r) => !r.channel.archivedAt),
    archived: rows.filter((r) => !!r.channel.archivedAt),
  };
}

/** A channel's name, as typed: 1–80 characters (the server refuses a clash). */
export const CHANNEL_NAME_MAX = 80;
/** A direct message holds you and up to eight others (nine people). */
export const DM_MAX_OTHERS = 8;

export function channelNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the channel a name.";
  if (trimmed.length > CHANNEL_NAME_MAX) return `Keep the name to ${CHANNEL_NAME_MAX} characters.`;
  return null;
}

/** What "Open" does in the direct-message tab. */
export type DmIntent =
  | { kind: "empty" }
  | { kind: "self" }
  | { kind: "too-many" }
  | { kind: "open"; userIds: string[] };

export function dmIntent(picked: readonly string[], selfId: string): DmIntent {
  if (picked.length === 0) return { kind: "empty" };
  const others = [...new Set(picked.filter((id) => id !== selfId))];
  // Only yourself: no notes-to-self conversations (§1), a note instead.
  if (others.length === 0) return { kind: "self" };
  if (others.length > DM_MAX_OTHERS) return { kind: "too-many" };
  return { kind: "open", userIds: others };
}

/** People the picker offers for a query: not picked yet, not former, by name. */
export function pickable(
  people: readonly ChatPerson[],
  picked: readonly string[],
  query: string,
  limit = 6,
): ChatPerson[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(picked);
  return people
    .filter((p) => !p.former && !taken.has(p.userId))
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * When Details reads again: the window's pins, edits, deletes and event lines
 * (joins, leaves, moves). Never on a plain new message: every send stamps the
 * channel row, so its `updatedAt` would re-read on each one.
 */
export function detailsStamp(rows: readonly ChatMessage[] | undefined): string {
  if (!rows) return "";
  let out = "";
  for (const r of rows) {
    // A wrap-up or a reopen (CV-12) is a line in the history too.
    if (
      r.pinnedAt ||
      r.editedAt ||
      r.deletedAt ||
      r.wrappedAt ||
      r.reopenedAt ||
      r.kind === "event"
    ) {
      out += `${r.id}:${r.pinnedAt ?? ""}:${r.editedAt ?? ""}:${r.deletedAt ?? ""}:${r.wrappedAt ?? ""}:${r.reopenedAt ?? ""};`;
    }
  }
  return out;
}
