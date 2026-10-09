// Row → model mappers for the chat tables. Reads are lax: a malformed row is
// dropped (returns null), closed fields normalize to their quiet default — the
// same posture as @contracts' normalize* bridges. Never throws.

import {
  isChatChannelKind,
  normalizeChatNotifyLevel,
  normalizeContentAuthorKind,
} from "@contracts/vocabularies";
import type { ChatChannel, ChatMember, ChatMessage, ChatReactions, ChatUnread } from "./model";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function asRow(r: unknown): Row | null {
  return r && typeof r === "object" ? (r as Row) : null;
}

export function mapChannel(raw: unknown): ChatChannel | null {
  const r = asRow(raw);
  const id = str(r?.id);
  const workspaceId = str(r?.workspace_id);
  if (!r || !id || !workspaceId || !isChatChannelKind(r.kind)) return null;
  return {
    id,
    workspaceId,
    kind: r.kind,
    name: str(r.name),
    topic: str(r.topic) ?? "",
    isPrivate: r.is_private === true,
    dmKey: str(r.dm_key),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: str(r.updated_at) ?? str(r.created_at) ?? new Date(0).toISOString(),
    archivedAt: str(r.archived_at),
    lastMessageAt: str(r.last_message_at),
  };
}

export function mapMember(raw: unknown): ChatMember | null {
  const r = asRow(raw);
  const channelId = str(r?.channel_id);
  const userId = str(r?.user_id);
  if (!r || !channelId || !userId) return null;
  return {
    channelId,
    userId,
    workspaceId: str(r.workspace_id) ?? "",
    notifyLevel: normalizeChatNotifyLevel(r.notify_level),
    starred: r.starred === true,
    lastReadAt: str(r.last_read_at) ?? new Date(0).toISOString(),
    joinedAt: str(r.joined_at) ?? new Date(0).toISOString(),
  };
}

export function mapReactions(raw: unknown): ChatReactions {
  const out: ChatReactions = {};
  const r = asRow(raw);
  if (!r) return out;
  for (const [emoji, users] of Object.entries(r)) {
    const ids = strArr(users);
    if (ids.length > 0) out[emoji] = ids;
  }
  return out;
}

export function mapMessage(raw: unknown): ChatMessage | null {
  const r = asRow(raw);
  const id = str(r?.id);
  const channelId = str(r?.channel_id);
  if (!r || !id || !channelId) return null;
  return {
    id,
    workspaceId: str(r.workspace_id) ?? "",
    channelId,
    parentId: str(r.parent_id),
    authorId: str(r.author_id),
    authorKind: normalizeContentAuthorKind(r.author_kind),
    authorLabel: str(r.author_label),
    body: str(r.body) ?? "",
    mentionedUserIds: strArr(r.mentioned_user_ids),
    reactions: mapReactions(r.reactions),
    replyCount: num(r.reply_count),
    lastReplyAt: str(r.last_reply_at),
    replyUserIds: strArr(r.reply_user_ids),
    pinnedAt: str(r.pinned_at),
    pinnedBy: str(r.pinned_by),
    editedAt: str(r.edited_at),
    deletedAt: str(r.deleted_at),
    clientId: str(r.client_id),
    createdAt: str(r.created_at) ?? new Date(0).toISOString(),
  };
}

export function mapUnread(raw: unknown): ChatUnread | null {
  const r = asRow(raw);
  const channelId = str(r?.channel_id);
  if (!r || !channelId) return null;
  return { channelId, unread: num(r.unread), mentions: num(r.mentions) };
}

export function mapRows<T>(rows: unknown, mapper: (r: unknown) => T | null): T[] {
  if (!Array.isArray(rows)) return [];
  const out: T[] = [];
  for (const r of rows) {
    const m = mapper(r);
    if (m) out.push(m);
  }
  return out;
}
