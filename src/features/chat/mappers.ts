// Row → model mappers for the chat tables. Reads are lax: a malformed row is
// dropped (returns null), closed fields normalize to their quiet default — the
// same posture as @contracts' normalize* bridges. Never throws.

import {
  isChatChannelKind,
  normalizeChatMessageKind,
  normalizeChatNotifyLevel,
  normalizeContentAuthorKind,
} from "@contracts/vocabularies";
import type {
  ChatChannel,
  ChatMember,
  ChatMessage,
  ChatPerson,
  ChatReactions,
  ChatSyncRow,
  ChatUnread,
  UserChatPrefs,
} from "./model";

type Row = Record<string, unknown>;

const EPOCH = new Date(0).toISOString();

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
    createdAt: str(r.created_at) ?? EPOCH,
    updatedAt: str(r.updated_at) ?? str(r.created_at) ?? EPOCH,
    archivedAt: str(r.archived_at),
    lastMessageAt: str(r.last_message_at),
    isDefault: r.is_default === true,
  };
}

/** A membership row stamped by leaving or a removal (CV-2b): no membership. */
export function memberLeft(raw: unknown): boolean {
  return Boolean(str(asRow(raw)?.left_at));
}

export function mapMember(raw: unknown): ChatMember | null {
  const r = asRow(raw);
  const channelId = str(r?.channel_id);
  const userId = str(r?.user_id);
  if (!r || !channelId || !userId) return null;
  // Leaving or a removal stamps the row (CV-2b) instead of deleting it: a
  // stamped row is no membership.
  if (memberLeft(r)) return null;
  return {
    channelId,
    userId,
    workspaceId: str(r.workspace_id) ?? "",
    notifyLevel: normalizeChatNotifyLevel(r.notify_level),
    starred: r.starred === true,
    lastReadAt: str(r.last_read_at) ?? EPOCH,
    lastReadId: str(r.last_read_id),
    joinedAt: str(r.joined_at) ?? EPOCH,
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
  const createdAt = str(r.created_at) ?? EPOCH;
  const event = asRow(r.event);
  return {
    id,
    workspaceId: str(r.workspace_id) ?? "",
    channelId,
    parentId: str(r.parent_id),
    replyToId: str(r.reply_to_id),
    kind: normalizeChatMessageKind(r.kind) ?? "message",
    event: event && !Array.isArray(event) ? event : null,
    formatVersion: num(r.format_version) || 1,
    authorId: str(r.author_id),
    authorKind: normalizeContentAuthorKind(r.author_kind),
    authorLabel: str(r.author_label),
    body: str(r.body) ?? "",
    mentionedUserIds: strArr(r.mentioned_user_ids),
    mentionedTeamIds: strArr(r.mentioned_team_ids),
    mentionsEveryone: r.mentions_everyone === true,
    reactions: mapReactions(r.reactions),
    replyCount: num(r.reply_count),
    lastReplyAt: str(r.last_reply_at),
    replyUserIds: strArr(r.reply_user_ids),
    pinnedAt: str(r.pinned_at),
    pinnedBy: str(r.pinned_by),
    editedAt: str(r.edited_at),
    deletedAt: str(r.deleted_at),
    clientId: str(r.client_id),
    createdAt,
    // A row read before CV-1's stamp (none on the server now) falls back to its time.
    updatedAt: str(r.updated_at) ?? createdAt,
  };
}

export function mapUnread(raw: unknown): ChatUnread | null {
  const r = asRow(raw);
  const channelId = str(r?.channel_id);
  if (!r || !channelId) return null;
  return {
    channelId,
    unread: num(r.unread),
    mentions: num(r.mentions),
    addressed: num(r.addressed),
    catchup: num(r.catchup),
  };
}

/** A `chat_people` row (CV-2b): everyone in a conversation you can read, plus you. */
export function mapPerson(raw: unknown): ChatPerson | null {
  const r = asRow(raw);
  const userId = str(r?.user_id);
  if (!r || !userId) return null;
  const name = (str(r.display_name) ?? "").trim();
  return {
    userId,
    name: name || "Member",
    avatarUrl: str(r.avatar_url),
    role: null,
    former: r.former === true,
  };
}

const SYNC_KINDS = new Set(["conversation", "member", "moved_away", "checked"]);

export function mapSyncRow(raw: unknown): ChatSyncRow | null {
  const r = asRow(raw);
  const kind = str(r?.kind);
  const checkedAt = str(r?.checked_at);
  if (!r || !kind || !SYNC_KINDS.has(kind) || !checkedAt) return null;
  return {
    kind: kind as ChatSyncRow["kind"],
    id: str(r.id),
    conversationId: str(r.conversation_id),
    checkedAt,
  };
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

/** `user_chat_prefs()` → your settings; a missing field reads as its default. */
export function mapUserChatPrefs(raw: unknown): UserChatPrefs {
  const r = asRow(raw) ?? {};
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    reactionRow: Array.isArray(r.reaction_row) ? strArr(r.reaction_row) : null,
    showOnline: flag(r.show_online, true),
    showFocusTask: flag(r.show_focus_task, false),
    noticeShowText: flag(r.notice_show_text, true),
    emailWhenAway: flag(r.email_when_away, true),
  };
}
