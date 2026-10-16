// Chat's two reference kinds (chat-v2 §8 "References", #5; CV-10): a message
// (`chat_message`) and a conversation (`chat_channel`).
//
// - A message: chip "author · first words", card author · conversation · time
//   and two lines; "Deleted message" once it's deleted. It reads through
//   `chat_message_refs`, which answers only for messages the reader can read:
//   every other id is private ("Private item", no title in the DOM).
// - A conversation: chip glyph · name, card name · people · last message. It
//   reads the reader's conversations (`chat_channels` under its policy): one
//   the reader can't read doesn't come back, so it's private too.
//
// A message's conversation is remembered here so a full open lands on it.

import { formatDate } from "../../../lib/time-format";
import type { ChatChannel, ChatMessageRef, ChatRuntime } from "../../chat/model";
import type { ResolveContext, Resolver } from "./resolvers";
import type {
  ReferenceFacts,
  ReferenceLevel,
  ReferenceMeta,
  ReferencePerson,
  ReferenceResolution,
} from "./types";

/** What the chat resolvers read (the app hands `runtime.chat`). */
export type ChatReferenceApi = Pick<ChatRuntime, "messageRefs" | "listChannels" | "memberCounts">;

/** The chip's first words: whitespace collapsed, at most 48 characters. */
export function firstWords(text: string | null, max = 48): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** A conversation's name as people read it: "#acme", or the people in a direct message. */
export function conversationName(
  channel: Pick<ChatChannel, "kind" | "name" | "dmKey">,
  personOf: ResolveContext["personOf"],
  me: string | null,
): string {
  if (channel.kind === "channel") return `#${channel.name ?? ""}`;
  const ids = (channel.dmKey ?? "").split(",").filter(Boolean);
  const others = ids.filter((id) => id !== me);
  const names = (others.length ? others : ids)
    .map((id) => personOf(id)?.name)
    .filter((n): n is string => !!n);
  return names.length ? names.join(", ") : "Direct message";
}

// ── where a message lives (for a full open) ─────────────────────────────────

const messageHome = new Map<string, { channelId: string; parentId: string | null }>();

/** The conversation (and chain) a message read here belongs to, if known. */
export function messageConversation(
  id: string,
): { channelId: string; parentId: string | null } | null {
  return messageHome.get(id) ?? null;
}

/** Remember where a message lives (the stream knows; a resolve learns it). */
export function rememberMessageConversation(
  id: string,
  channelId: string,
  parentId: string | null,
): void {
  messageHome.set(id, { channelId, parentId });
}

// ── message ─────────────────────────────────────────────────────────────────

function authorOf(row: ChatMessageRef, personOf: ResolveContext["personOf"]): ReferencePerson {
  if (row.authorKind === "agent" || (!row.authorId && row.authorLabel)) {
    return { name: row.authorLabel?.trim() || "Agent", id: null, avatarUrl: null };
  }
  const person = row.authorId ? personOf(row.authorId) : null;
  return person ?? { name: "Someone", id: row.authorId, avatarUrl: null };
}

export function messageFacts(
  row: ChatMessageRef,
  ctx: Pick<ResolveContext, "personOf" | "now">,
  level: ReferenceLevel,
  where: string,
): ReferenceFacts {
  const author = authorOf(row, ctx.personOf);
  const words = firstWords(row.excerpt);
  const facts: ReferenceFacts = {
    kind: "message",
    title: words ? `${author.name} · ${words}` : author.name,
    lead: { kind: "person", person: author },
    fact: null,
    card: null,
  };
  if (level === "chip") return facts;
  facts.card = {
    overline: {
      person: author,
      text: `${author.name} · ${where}`,
      trailing: formatDate(row.createdAt, ctx.now()),
    },
    excerpt: row.excerpt?.trim() || null,
    meta: [],
  };
  return facts;
}

/** Messages, per id: ready, deleted, or private (didn't answer). */
export function resolveMessagesWith(
  api: Pick<ChatReferenceApi, "messageRefs">,
  me: string | null,
): Resolver {
  return async (ctx, ids, level) => {
    const rows = await api.messageRefs(ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out = new Map<string, ReferenceResolution>();
    for (const id of ids) {
      const row = byId.get(id);
      if (!row || row.workspaceId !== ctx.workspaceId) {
        out.set(id, { status: "private" });
        continue;
      }
      rememberMessageConversation(row.id, row.channelId, row.parentId);
      if (row.deleted) {
        out.set(id, { status: "deleted" });
        continue;
      }
      const where = conversationName(
        { kind: row.channelKind, name: row.channelName, dmKey: null },
        ctx.personOf,
        me,
      );
      out.set(id, { status: "ready", facts: messageFacts(row, ctx, level, where) });
    }
    return out;
  };
}

// ── conversation ─────────────────────────────────────────────────────────────

export function conversationFacts(
  channel: ChatChannel,
  ctx: Pick<ResolveContext, "personOf" | "now">,
  level: ReferenceLevel,
  me: string | null,
  people: number | null,
): ReferenceFacts {
  const glyph =
    channel.kind === "dm" ? "chat_dm" : channel.isPrivate ? "chat_private" : "chat_channel";
  const name = conversationName(channel, ctx.personOf, me);
  const facts: ReferenceFacts = {
    kind: "conversation",
    title: channel.kind === "channel" ? (channel.name ?? "") : name,
    lead: { kind: "icon", type: glyph },
    fact: null,
    card: null,
  };
  if (level === "chip") return facts;
  const meta: ReferenceMeta[] = [];
  if (people !== null) {
    meta.push({
      key: "people",
      text: people === 1 ? "1 person" : `${people} people`,
      icon: "contact",
    });
  }
  if (channel.lastMessageAt) {
    meta.push({
      key: "last",
      text: `Last message ${formatDate(channel.lastMessageAt, ctx.now())}`,
      icon: "chat_message",
    });
  }
  facts.card = { excerpt: channel.topic?.trim() || null, meta };
  return facts;
}

export function resolveConversationsWith(api: ChatReferenceApi, me: string | null): Resolver {
  return async (ctx, ids, level) => {
    const all = await api.listChannels(ctx.workspaceId);
    const wanted = new Set(ids);
    const mine = all.filter((c) => wanted.has(c.id) && c.workspaceId === ctx.workspaceId);
    const counts =
      level === "card" && mine.length
        ? await api.memberCounts(mine.map((c) => c.id)).catch(() => ({}))
        : {};
    const byId = new Map(mine.map((c) => [c.id, c]));
    const out = new Map<string, ReferenceResolution>();
    for (const id of ids) {
      const channel = byId.get(id);
      if (!channel) out.set(id, { status: "private" });
      else {
        const n = (counts as Record<string, number>)[id];
        out.set(id, {
          status: "ready",
          facts: conversationFacts(channel, ctx, level, me, typeof n === "number" ? n : null),
        });
      }
    }
    return out;
  };
}

/** The resolvers for a context: private for everything when chat isn't there. */
export const resolveChatMessages: Resolver = async (ctx, ids, level, type) => {
  if (!ctx.chat) return new Map(ids.map((id) => [id, { status: "private" } as const]));
  return resolveMessagesWith(ctx.chat, ctx.userId ?? null)(ctx, ids, level, type);
};

export const resolveChatConversations: Resolver = async (ctx, ids, level, type) => {
  if (!ctx.chat) return new Map(ids.map((id) => [id, { status: "private" } as const]));
  return resolveConversationsWith(ctx.chat, ctx.userId ?? null)(ctx, ids, level, type);
};
