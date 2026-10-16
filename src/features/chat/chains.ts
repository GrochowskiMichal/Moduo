// Reply chains on the client (CV-12, spec §5, §12): who may wrap up and
// "Reply to…" (a mirror of the ops' rules, only to offer the buttons: the
// server decides every write), the Reply chains view's two groups and their
// "N new", and the one-line excerpt the chain rows and dialogs draw.

import { messageTree, toBodyText } from "./markup-v2";
import type { ChatChannel, ChatMessage } from "./model";

export type ChainRights = {
  /** You may post here (not a viewer, the plan isn't paused, the channel isn't archived). */
  canPost: boolean;
  paused: boolean;
  /** A manager of this channel or an admin ("Manage any channel"). */
  canManage: boolean;
  selfId: string;
};

/** Wrap up and reopen: the root's author, managers and admins; in a DM anyone who can post. */
export function mayWrap(
  root: Pick<ChatMessage, "authorId" | "authorKind">,
  channel: Pick<ChatChannel, "kind" | "archivedAt">,
  r: ChainRights,
): boolean {
  if (!r.canPost || r.paused || channel.archivedAt) return false;
  if (channel.kind === "dm" || r.canManage) return true;
  return root.authorKind === "user" && root.authorId === r.selfId;
}

/** "Reply to…": your own message, or anyone's for managers and admins. */
export function mayAttach(
  m: Pick<ChatMessage, "authorId" | "authorKind" | "replyCount" | "kind" | "deletedAt">,
  channel: Pick<ChatChannel, "archivedAt">,
  r: ChainRights,
): boolean {
  if (!r.canPost || r.paused || channel.archivedAt) return false;
  // A message with replies of its own stays a root (the op refuses it).
  if (m.kind !== "message" || m.deletedAt || m.replyCount > 0) return false;
  return r.canManage || (m.authorKind === "user" && m.authorId === r.selfId);
}

/** One line of a message's words. */
export function excerptOf(m: ChatMessage, max = 140): string {
  if (m.deletedAt) return "Deleted message";
  const text = toBodyText(messageTree(m.id, m.updatedAt, m.body))
    .replace(/\s+/g, " ")
    .trim();
  return (text || "Message").slice(0, max);
}

export type ChainEntry = {
  root: ChatMessage;
  /** Replies from others after your read mark (0: none to say). */
  fresh: number;
};

/**
 * The Reply chains view (frame 4 "list"): open chains, newest activity first,
 * then the wrapped ones. "N new" counts the held replies of that chain by
 * others after your read mark; when none is held but the chain's last reply
 * is newer than the mark and someone else wrote it, it says "1 new".
 */
export function chainGroups(
  roots: readonly ChatMessage[],
  opts: {
    selfId: string;
    /** Your read mark in this conversation (null: you aren't in it). */
    lastReadAt: string | null;
    /** Replies the store holds, by root. */
    repliesOf: (rootId: string) => readonly ChatMessage[];
  },
): { open: ChainEntry[]; wrapped: ChainEntry[] } {
  const byActivity = (a: ChatMessage, b: ChatMessage) =>
    (b.lastReplyAt ?? b.createdAt).localeCompare(a.lastReplyAt ?? a.createdAt) ||
    (b.id < a.id ? -1 : 1);
  const entry = (root: ChatMessage): ChainEntry => {
    const mark = opts.lastReadAt;
    if (!mark) return { root, fresh: 0 };
    let fresh = 0;
    for (const r of opts.repliesOf(root.id)) {
      if (r.deletedAt || r.authorId === opts.selfId || r.sendState) continue;
      if (r.createdAt > mark) fresh += 1;
    }
    if (
      fresh === 0 &&
      root.lastReplyAt &&
      root.lastReplyAt > mark &&
      root.replyUserIds[0] &&
      root.replyUserIds[0] !== opts.selfId
    ) {
      fresh = 1;
    }
    return { root, fresh };
  };
  const live = roots.filter((r) => !r.deletedAt && r.replyCount > 0 && !r.parentId);
  return {
    open: live
      .filter((r) => !r.wrappedAt)
      .sort(byActivity)
      .map(entry),
    wrapped: live
      .filter((r) => !!r.wrappedAt)
      .sort(byActivity)
      .map((root) => ({ root, fresh: 0 })),
  };
}

/**
 * What the Reply chains read depends on: the window's roots' reply counts and
 * wrap states (a plain new message doesn't change it).
 */
export function chainsStamp(rows: readonly ChatMessage[] | undefined): string {
  if (!rows) return "";
  let out = "";
  for (const m of rows) {
    if (m.parentId) {
      out += `r${m.id}${m.deletedAt ? "x" : ""};`;
      continue;
    }
    if (m.replyCount > 0 || m.wrappedAt || m.reopenedAt) {
      out += `${m.id}:${m.replyCount}:${m.wrappedAt ?? ""}:${m.reopenedAt ?? ""}:${m.deletedAt ? "x" : ""};`;
    }
  }
  return out;
}
/** How many earlier messages "Reply to…" lists. */
const REPLY_TO_MAX = 30;

/**
 * What "Reply to…" offers for `message`: earlier messages of the held window
 * (never later ones), open chains first, then newest first; nothing deleted,
 * unsent, an event line or the message itself.
 */
export function replyToChoices(message: ChatMessage, rows: readonly ChatMessage[]): ChatMessage[] {
  const earlier = rows.filter(
    (m) =>
      m.id !== message.id &&
      m.kind === "message" &&
      !m.deletedAt &&
      !m.sendState &&
      (m.createdAt < message.createdAt || (m.createdAt === message.createdAt && m.id < message.id)),
  );
  earlier.reverse();
  const chains = earlier.filter((m) => !m.parentId && m.replyCount > 0 && !m.wrappedAt);
  const rest = earlier.filter((m) => !chains.includes(m));
  return [...chains, ...rest].slice(0, REPLY_TO_MAX);
}
