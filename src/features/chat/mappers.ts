// Row → model mappers for the chat tables. Reads are lax: a malformed row is
// dropped (returns null), closed fields normalize to their quiet default — the
// same posture as @contracts' normalize* bridges. Never throws.

import {
  isChatChannelKind,
  normalizeChatCatchupReason,
  normalizeChatLinkTarget,
  normalizeChatMessageKind,
  normalizeChatNotifyLevel,
  normalizeContentAuthorKind,
} from "@contracts/vocabularies";
import type {
  ChatCatchupItem,
  ChatChannel,
  ChatConversationFound,
  ChatDeletedChannel,
  ChatFile,
  ChatHistoryEntry,
  ChatItemDecision,
  ChatMember,
  ChatMessage,
  ChatMoveAnswer,
  ChatPerson,
  ChatReactions,
  ChatSearchHit,
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
    managersOnly: r.managers_only === true,
    link: mapLink(r.linked_type, r.linked_id),
    rosterAt: str(r.roster_at),
  };
}

/** A Recently deleted row (`chat_recently_deleted`, CV-15). */
export function mapDeletedChannel(raw: unknown): ChatDeletedChannel | null {
  const r = asRow(raw);
  const id = str(r?.id);
  const deletedAt = str(r?.deleted_at);
  if (!r || !id || !deletedAt) return null;
  return {
    id,
    name: str(r.name) ?? "",
    isPrivate: r.is_private === true,
    deletedAt,
    deletedBy: str(r.deleted_by),
    purgeAt: str(r.purge_at) ?? deletedAt,
  };
}

/** A channel's link (CV-13): both halves or nothing. */
function mapLink(type: unknown, id: unknown): ChatChannel["link"] {
  const t = normalizeChatLinkTarget(type);
  const i = str(id);
  return t && i ? { type: t, id: i } : null;
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
    accessAt: str(r.access_at),
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
    fileCount: num(r.file_count),
    lastReplyAt: str(r.last_reply_at),
    replyUserIds: strArr(r.reply_user_ids),
    wrappedAt: str(r.wrapped_at),
    wrappedBy: str(r.wrapped_by),
    settledId: str(r.settled_id),
    reopenedAt: str(r.reopened_at),
    reopenedBy: str(r.reopened_by),
    pinnedAt: str(r.pinned_at),
    pinnedBy: str(r.pinned_by),
    decisionAt: str(r.decision_at),
    decisionBy: str(r.decision_by),
    editedAt: str(r.edited_at),
    deletedAt: str(r.deleted_at),
    clientId: str(r.client_id),
    createdAt,
    // A row read before CV-1's stamp (none on the server now) falls back to its time.
    updatedAt: str(r.updated_at) ?? createdAt,
  };
}

export function mapCatchupItem(raw: unknown): ChatCatchupItem | null {
  const r = asRow(raw);
  const id = str(r?.id);
  const channelId = str(r?.channel_id);
  const reason = normalizeChatCatchupReason(r?.reason);
  if (!r || !id || !channelId || !reason) return null;
  const createdAt = str(r.created_at) ?? EPOCH;
  return {
    id,
    channelId,
    messageId: str(r.message_id),
    chainRootId: str(r.chain_root_id),
    reason,
    actorId: str(r.actor_id),
    createdAt,
    laterUntil: str(r.later_until),
    returnedAt: str(r.returned_at),
    at: str(r.at) ?? createdAt,
    channelName: str(r.channel_name),
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

/** A decision shown on an item (`chat_decisions_for_item`, CV-14). */
export function mapItemDecision(raw: unknown): ChatItemDecision | null {
  const r = asRow(raw);
  const messageId = str(r?.message_id);
  const channelId = str(r?.channel_id);
  const workspaceId = str(r?.workspace_id);
  const decisionAt = str(r?.decision_at);
  if (!r || !messageId || !channelId || !workspaceId || !decisionAt) return null;
  return {
    messageId,
    parentId: str(r.parent_id),
    channelId,
    workspaceId,
    channelKind: r.channel_kind === "dm" ? "dm" : "channel",
    channelName: str(r.channel_name),
    withNames: strArr(r.with_names),
    decisionAt,
    excerpt: str(r.excerpt) ?? "",
    createdAt: str(r.created_at) ?? decisionAt,
  };
}

/** `chat_op_move_messages`'s answer (CV-16), or null when it isn't one. */
export function parseMoveAnswer(raw: unknown): ChatMoveAnswer | null {
  const r = asRow(raw);
  if (!r) return null;
  if (r.status === "confirm") {
    return typeof r.newly === "number" && r.newly >= 0
      ? { status: "confirm", newly: r.newly }
      : null;
  }
  if (r.status !== "moved" && r.status !== "undone") return null;
  const from = str(r.from);
  const to = str(r.to);
  if (!from || !to || !Array.isArray(r.ids)) return null;
  const ids = r.ids.filter((v): v is string => typeof v === "string");
  return { status: r.status, ids, from, to };
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

export function mapHistory(raw: unknown): ChatHistoryEntry | null {
  const r = asRow(raw);
  const id = str(r?.id);
  const op = str(r?.op);
  const createdAt = str(r?.created_at);
  if (!r || !id || !op || !createdAt) return null;
  return {
    id,
    op,
    actorType: str(r.actor_type) ?? "user",
    actorId: str(r.actor_id),
    actorLabel: str(r.actor_label),
    payload: asRow(r.payload) ?? {},
    createdAt,
  };
}

/** A `chat_find_conversations` row (CV-19). */
export function mapConversationFound(raw: unknown): ChatConversationFound | null {
  const r = asRow(raw);
  const channelId = str(r?.channel_id);
  if (!r || !channelId || !isChatChannelKind(r.kind)) return null;
  return {
    channelId,
    kind: r.kind,
    name: str(r.name),
    people: Array.isArray(r.people)
      ? r.people.filter((x): x is string => typeof x === "string")
      : [],
    archived: r.archived === true,
  };
}

/** A `chat_search` row (CV-19). */
export function mapSearchHit(raw: unknown): ChatSearchHit | null {
  const r = asRow(raw);
  const messageId = str(r?.message_id);
  const channelId = str(r?.channel_id);
  if (!r || !messageId || !channelId || !isChatChannelKind(r.channel_kind)) return null;
  return {
    messageId,
    channelId,
    channelKind: r.channel_kind,
    channelName: str(r.channel_name),
    parentId: str(r.parent_id),
    replyToId: str(r.reply_to_id),
    authorId: str(r.author_id),
    authorLabel: r.author_kind === "api_key" ? str(r.author_label) : null,
    createdAt: str(r.created_at) ?? EPOCH,
    snippet: str(r.snippet) ?? "",
  };
}

/** A row of `chat_files`, or of `attachments` read by message (CV-9), as a chat file. */
export function mapChatFile(raw: unknown): ChatFile | null {
  const r = asRow(raw);
  const id = str(r?.id);
  const messageId = str(r?.message_id) ?? str(r?.entity_id);
  const objectPath = str(r?.object_path);
  if (!r || !id || !messageId || !objectPath) return null;
  const dim = (v: unknown) => (num(v) > 0 ? num(v) : null);
  return {
    id,
    messageId,
    authorId: str(r.author_id) ?? str(r.uploader_id),
    fileName: str(r.file_name) ?? "file",
    mime: str(r.mime) ?? "application/octet-stream",
    sizeBytes: num(r.size_bytes),
    width: dim(r.width),
    height: dim(r.height),
    objectPath,
    previewPath: str(r.preview_path),
    previewMime: str(r.preview_mime),
    sentAt: str(r.sent_at) ?? str(r.created_at) ?? EPOCH,
  };
}
