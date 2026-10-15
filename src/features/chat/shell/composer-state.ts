// What sits where the composer goes (spec §1, §Edge cases, frame 7): the
// composer, or one line that says why there's nothing to type into. A line
// replaces the box; never a disabled box (AC1.8). The server decides every
// write; this only keeps the screen honest about what it will refuse.

import type { ChatChannel, ChatMember, ChatPerson } from "../model";
import { dmPeople } from "./sidebar-model";

export type ComposerLine =
  | { kind: "archived"; canUnarchive: boolean }
  | { kind: "paused"; owner: boolean; ownerName: string | null }
  | { kind: "viewer" }
  | { kind: "former"; names: string[] }
  | { kind: "announcement" }
  | { kind: "join" };

export function composerLine(input: {
  channel: ChatChannel;
  member: ChatMember | undefined;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  /** The workspace's plan doesn't include chat. */
  paused: boolean;
  /** You own the workspace (the paused line offers "Choose a plan"). */
  isOwner: boolean;
  ownerName: string | null;
  /** Your role may post in chat (a viewer may not). */
  canPost: boolean;
  /** You manage this channel (announcements, unarchive). */
  canManage: boolean;
}): ComposerLine | null {
  const { channel, member, paused, canPost, canManage } = input;
  if (channel.archivedAt) return { kind: "archived", canUnarchive: canManage && !paused };
  if (paused) return { kind: "paused", owner: input.isOwner, ownerName: input.ownerName };
  if (!canPost) return { kind: "viewer" };
  if (channel.kind === "dm") {
    const others = dmPeople(channel, input.selfId);
    // Everyone else left: their messages stay readable, there's no one to write to.
    if (others.length > 0 && others.every((id) => input.personOf(id)?.former !== false)) {
      return {
        kind: "former",
        names: others.map((id) => input.personOf(id)?.name ?? "Former member"),
      };
    }
  }
  if (!member) return { kind: "join" };
  if (channel.managersOnly && !canManage) return { kind: "announcement" };
  return null;
}

/** "Jana", "Jana and Tomek", "Jana, Tomek and Ola". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const COMPOSER_LINE_COPY = {
  archived: "This channel is archived.",
  archivedMore: "Everything stays readable and searchable.",
  paused: "Chat is paused: this workspace's plan doesn't include it.",
  pausedBackOn: (owner: string) => `${owner} can turn it back on.`,
  viewer: "You can read this conversation but not post in it",
  announcement: "Only managers post here",
  replyPrivately: "Reply privately",
  former: (names: readonly string[]) => `${joinNames(names)} left the workspace`,
  join: "You're not in this channel",
  offline: "You're offline · reading from this device",
} as const;
