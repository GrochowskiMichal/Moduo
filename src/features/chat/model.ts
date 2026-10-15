// Chat module — domain model (specs/chat.md, specs/chat-v2.md).
//
// Rows come from three tables (chat_channels / chat_members / chat_messages,
// migration 20261006150000_chat_module, v2 columns from CV-1). Closed
// vocabularies live in @contracts/vocabularies; this file shapes rows for the
// UI and names the transport the chat store (`store/store.ts`) reads through.

import type {
  ChatChannelKind,
  ChatMessageKind,
  ChatNotifyLevel,
  ContentAuthorKind,
} from "@contracts/vocabularies";

export type { ChatChannelKind, ChatMessageKind, ChatNotifyLevel, ContentAuthorKind };

export type ChatChannel = {
  id: string;
  workspaceId: string;
  kind: ChatChannelKind;
  /** Channel name without the `#` (null for DMs). */
  name: string | null;
  topic: string;
  isPrivate: boolean;
  /** Sorted, comma-joined member ids — DMs only. */
  dmKey: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  lastMessageAt: string | null;
  /** General: everyone in the workspace is put in it (v2). */
  isDefault?: boolean;
};

/** The current user's own state in a channel (or another member's row). */
export type ChatMember = {
  channelId: string;
  userId: string;
  workspaceId: string;
  notifyLevel: ChatNotifyLevel;
  starred: boolean;
  lastReadAt: string;
  /** The read mark: the last message that was on screen (v2; null before conversion). */
  lastReadId: string | null;
  joinedAt: string;
};

export type ChatReactions = Record<string, string[]>;

/** Where an unconfirmed send of yours is (the store's outbox, CH64). */
export type ChatSendState = "sending" | "waiting" | "failed";

export type ChatMessage = {
  id: string;
  workspaceId: string;
  channelId: string;
  /** The chain's root (v2: a reply posts in the stream and joins its root's chain). */
  parentId: string | null;
  /** The message this one answers (v2), when it's a reply. */
  replyToId: string | null;
  /** "event": a quiet line the server writes (a move); never drawn as a message. */
  kind: ChatMessageKind;
  event: Record<string, unknown> | null;
  /** 1: v1 markup, 2: the v2 stored form. */
  formatVersion: number;
  authorId: string | null;
  /** "api_key" = posted by an app/agent over MCP (authorId is null). */
  authorKind: ContentAuthorKind;
  /** The app's name at post time, for api_key authors. */
  authorLabel: string | null;
  body: string;
  mentionedUserIds: string[];
  mentionedTeamIds: string[];
  mentionsEveryone: boolean;
  reactions: ChatReactions;
  replyCount: number;
  lastReplyAt: string | null;
  replyUserIds: string[];
  pinnedAt: string | null;
  pinnedBy: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  /** v1 only; the store never reads it (it equals `id` until CV-23). */
  clientId: string | null;
  createdAt: string;
  /** The server's stamp of the row's last change (the delta cursor and the live merge). */
  updatedAt: string;
  /** Client-only (the store): an unconfirmed send of yours. */
  sendState?: ChatSendState;
  /** Client-only: why the server refused it ("Not sent · Retry"). */
  sendError?: string;
  /** Client-only, v1's screens: an optimistic send that hasn't been confirmed yet. */
  pending?: boolean;
  /** Client-only, v1's screens: an optimistic send the server refused — offer retry. */
  failed?: boolean;
};

/** Per conversation (`chat_unread_counts`): `unread` makes it bold, `addressed` is the number. */
export type ChatUnread = {
  channelId: string;
  unread: number;
  mentions: number;
  addressed: number;
  catchup: number;
};

/** A workspace person as chat renders them. */
export type ChatPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  /** No longer in the workspace (`chat_people.former`): their messages stay. */
  former?: boolean;
};

/** A position in a conversation's stream: pages key on (created_at, id). */
export type ChatKey = { at: string; id: string };

/** What the server said when it didn't answer with data. Never thrown. */
export type ChatError = { code: string | null; message: string };

/** A store read or write: its data, or the error (supabase-js reports on `error`). */
export type ChatResult<T> = { data: T; error: null } | { data: null; error: ChatError };

/** One row of `chat_sync_ids` (CV-2b): what the access check reads. */
export type ChatSyncRow = {
  kind: "conversation" | "member" | "moved_away" | "checked";
  id: string | null;
  conversationId: string | null;
  checkedAt: string;
};

/** How a body is written: v1's screens still send v1 markup (the server converts it). */
export type ChatBodyFormat = "v1" | "v2";

export type ChatRuntime = {
  // ── The store's transport (CV-3): every call checks `error`, none throws ──
  /** One page of a conversation's stream, oldest first. `before`: strictly older
   *  than the key (newest first on the wire); `after`: strictly newer. */
  page(args: {
    channelId: string;
    before?: ChatKey | null;
    after?: ChatKey | null;
    limit: number;
  }): Promise<ChatResult<ChatMessage[]>>;
  /** A chain: its root and every reply, oldest first. */
  chain(rootId: string): Promise<ChatResult<ChatMessage[]>>;
  message(id: string): Promise<ChatResult<ChatMessage | null>>;
  /** Rows changed since `since` (server stamps, soft deletes included), in
   *  (updated_at, id) order; `after` continues a page. */
  delta(args: {
    workspaceId: string;
    since: string;
    after?: { updatedAt: string; id: string } | null;
    limit: number;
    /** Only these conversations (omitted: the whole workspace). */
    channelIds?: readonly string[];
  }): Promise<ChatResult<ChatMessage[]>>;
  /** The access check: what this person may read now (CV-2b). */
  syncIds(workspaceId: string, since: string | null): Promise<ChatResult<ChatSyncRow[]>>;
  people(workspaceId: string): Promise<ChatResult<ChatPerson[]>>;
  counts(workspaceId: string): Promise<ChatResult<ChatUnread[]>>;
  /** Send under a client-minted id: a resend returns the stored row. */
  send(args: {
    id: string;
    channelId: string;
    body: string;
    replyToId: string | null;
    format: ChatBodyFormat;
  }): Promise<ChatResult<ChatMessage>>;
  edit(args: {
    id: string;
    body: string;
    format: ChatBodyFormat;
  }): Promise<ChatResult<ChatMessage>>;
  remove(id: string): Promise<ChatResult<ChatMessage>>;
  react(args: { id: string; key: string; on: boolean }): Promise<ChatResult<ChatMessage>>;
  pin(args: { id: string; pinned: boolean }): Promise<ChatResult<ChatMessage>>;
  markRead(args: { channelId: string; messageId: string }): Promise<ChatResult<null>>;
  markUnread(args: { channelId: string; messageId: string }): Promise<ChatResult<null>>;
  /** "I'm typing" (or stopped): the server broadcasts it under the session's id. Best effort. */
  typing(args: { channelId: string; parentId: string | null; stop: boolean }): Promise<void>;

  // ── Conversation reads and ops (throw on failure; v1's surfaces and the store's actions) ──
  /** Whether this workspace's plan includes chat (owner's tier ≥ Duo). */
  isEnabled(workspaceId: string): Promise<boolean>;
  /** Idempotent: makes sure General exists. */
  bootstrap(workspaceId: string): Promise<void>;
  listChannels(workspaceId: string): Promise<ChatChannel[]>;
  /** The current user's memberships in this workspace (left ones excluded). */
  listMyMemberships(workspaceId: string, userId: string): Promise<ChatMember[]>;
  listChannelMembers(channelId: string): Promise<ChatMember[]>;
  unreadCounts(workspaceId: string): Promise<ChatUnread[]>;
  listPinned(channelId: string): Promise<ChatMessage[]>;
  /** Full-text-ish search across messages the user can read (v1; search is its own block). */
  search(args: { workspaceId: string; query: string; limit?: number }): Promise<ChatMessage[]>;

  createChannel(args: {
    workspaceId: string;
    name: string;
    topic?: string;
    isPrivate?: boolean;
    memberIds?: string[];
  }): Promise<ChatChannel>;
  openDm(args: { workspaceId: string; userIds: string[] }): Promise<ChatChannel>;
  updateChannel(args: { channelId: string; name?: string; topic?: string }): Promise<ChatChannel>;
  archiveChannel(args: { channelId: string; archived: boolean }): Promise<ChatChannel>;
  join(channelId: string): Promise<ChatMember>;
  leave(channelId: string): Promise<void>;
  addMembers(args: { channelId: string; userIds: string[] }): Promise<number>;
  removeMember(args: { channelId: string; userId: string }): Promise<void>;
  setPrefs(args: {
    channelId: string;
    notifyLevel?: ChatNotifyLevel;
    starred?: boolean;
  }): Promise<ChatMember>;

  // ── Your chat settings, one row per person for every workspace (CV-6a's
  //    user_chat_prefs / user_op_set_chat_prefs; throw on failure) ──
  myPrefs(): Promise<UserChatPrefs>;
  /** Changes only what the patch names; answers the whole set. */
  setMyPrefs(patch: Partial<UserChatPrefs>): Promise<UserChatPrefs>;
};

/** Your chat settings. `reactionRow` null = Moduo's six (CH16a). */
export type UserChatPrefs = {
  reactionRow: string[] | null;
  showOnline: boolean;
  showFocusTask: boolean;
  noticeShowText: boolean;
  emailWhenAway: boolean;
};
