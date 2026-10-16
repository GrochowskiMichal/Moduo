// Chat module — domain model (specs/chat.md, specs/chat-v2.md).
//
// Rows come from three tables (chat_channels / chat_members / chat_messages,
// migration 20261006150000_chat_module, v2 columns from CV-1). Closed
// vocabularies live in @contracts/vocabularies; this file shapes rows for the
// UI and names the transport the chat store (`store/store.ts`) reads through.

import type {
  ChatCatchupReason,
  ChatChannelKind,
  ChatLinkTarget,
  ChatMessageKind,
  ChatNotifyLevel,
  ContentAuthorKind,
  RelationKind,
} from "@contracts/vocabularies";

export type {
  ChatCatchupReason,
  ChatChannelKind,
  ChatLinkTarget,
  ChatMessageKind,
  ChatNotifyLevel,
  ContentAuthorKind,
};

/** A channel's link (CV-13): a project (`bucket`), a client or a team. */
export type ChatLink = { type: ChatLinkTarget; id: string };

/** What "Start a conversation for X" takes: a project or a client, never a team. */
export type ChatStartableTarget = Exclude<ChatLinkTarget, "team">;

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
  /** An announcement channel: only its managers post (CH23a). */
  managersOnly?: boolean;
  /** What the channel links to (CV-13), null when nothing. */
  link?: ChatLink | null;
  /** When its people or managers last changed (CV-15): People and managers are re-read on it. */
  rosterAt?: string | null;
};

/** A channel in Recently deleted (CV-15): restorable until `purgeAt`. */
export type ChatDeletedChannel = {
  id: string;
  name: string;
  isPrivate: boolean;
  deletedAt: string;
  deletedBy: string | null;
  purgeAt: string;
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
  /** The server's stamp when the conversation's readers changed (deleted, restored; CV-15). */
  accessAt?: string | null;
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
  /** A chain's root, wrapped up (CV-12): its replies leave the stream (a drawing rule). */
  wrappedAt: string | null;
  wrappedBy: string | null;
  /** The reply that settled it (always a reply of this chain). */
  settledId: string | null;
  /** The last reopen ("Reopened by Mike"); cleared by the next Wrap up. */
  reopenedAt: string | null;
  reopenedBy: string | null;
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

/**
 * One open Catch up item (`chat_catchup_open`, CV-11): showing now, in a
 * conversation you can still read. A grouped item (a chain, an Every-message
 * line) names its newest message; a conversation reminder that found no
 * message has none.
 */
export type ChatCatchupItem = {
  id: string;
  channelId: string;
  messageId: string | null;
  chainRootId: string | null;
  reason: ChatCatchupReason;
  actorId: string | null;
  createdAt: string;
  /** Set when it was put off (Later / Remind me). */
  laterUntil: string | null;
  /** When it came back from Later (it sorts on top from then). */
  returnedAt: string | null;
  /** The list's order: its newest message, or when it came back. */
  at: string;
  /** The conversation's name as stored with the item (a "removed you" line's private channel you can no longer read). */
  channelName?: string | null;
};

/** A workspace person as chat renders them. */
export type ChatPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  /** Their role is read-only (a custom read-only role): chat is view-only for them. */
  readOnly?: boolean;
  /** No longer in the workspace (`chat_people.former`): their messages stay. */
  former?: boolean;
};

/**
 * The ops a conversation's history lists (Details, AC15.5): every change to
 * the conversation and its messages. Not the bell rows (`chat.mention`,
 * `chat.reply`, `chat.announcement`: who was told, not what changed) and not
 * reactions (a wall, not a history).
 */
export const CHAT_HISTORY_OPS = [
  "chat.channel_create",
  "chat.channel_rename",
  "chat.channel_topic",
  "chat.channel_archive",
  "chat.channel_unarchive",
  "chat.join",
  "chat.leave",
  "chat.member_add",
  "chat.member_remove",
  "chat.channel_link",
  "chat.manager_add",
  "chat.manager_remove",
  "chat.announcement_switch",
  "chat.channel_private",
  "chat.channel_delete",
  "chat.channel_restore",
  "chat.pin",
  "chat.message_edit",
  "chat.message_delete",
  "chat.message_restore",
  "chat.wrap_up",
  "chat.reopen",
] as const;

/** One line of a conversation's history (a `module_activity` row). */
export type ChatHistoryEntry = {
  id: string;
  op: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

/** A position in a conversation's stream: pages key on (created_at, id). */
export type ChatKey = { at: string; id: string };

/** What the server said when it didn't answer with data. Never thrown. */
export type ChatError = { code: string | null; message: string };

/** A store read or write: its data, or the error (supabase-js reports on `error`). */
export type ChatResult<T> = { data: T; error: null } | { data: null; error: ChatError };

/** One hit of `chat_search` (CV-19): a message you can read now, newest first. */
export type ChatSearchHit = {
  messageId: string;
  channelId: string;
  channelKind: ChatChannelKind;
  /** The channel's name; null for a direct message (name it from its people). */
  channelName: string | null;
  /** The chain's root when the hit is a reply in a chain. */
  parentId: string | null;
  replyToId: string | null;
  authorId: string | null;
  /** An app's post names the app (`author_kind` "api_key"). */
  authorLabel: string | null;
  createdAt: string;
  /** Plain text; matches sit between U+E000 and U+E001 (`splitSnippet`). */
  snippet: string;
};

/** What Chat's Search asks for: the words, and the FilterBar's from · in · has a file · date. */
export type ChatSearchQuery = {
  workspaceId: string;
  query: string;
  channelId?: string | null;
  fromId?: string | null;
  /** Only messages at or after this instant (the date filter). */
  after?: string | null;
  hasFile?: boolean;
  /** The last hit of the previous page: the next page is strictly older. */
  before?: { createdAt: string; messageId: string } | null;
  /** At most 50 (the server caps it). */
  limit?: number;
};

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
  /** Server search over the messages you can read now (CV-19: ⌘K, Chat's Search, find in a conversation). */
  search(args: ChatSearchQuery): Promise<ChatResult<ChatSearchHit[]>>;
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
  /** Wrap up a chain (CV-12): `settledId` is the reply that settled it. */
  wrapUp(args: {
    rootId: string;
    settledId: string;
    markDecision?: boolean;
  }): Promise<ChatResult<ChatMessage>>;
  /** Reopen a wrapped chain (the wrapper within 10 s: the toast's Undo). */
  reopen(rootId: string): Promise<ChatResult<ChatMessage>>;
  /** "Reply to…": the message joins the chain of an earlier message. */
  attachToChain(args: { messageId: string; replyToId: string }): Promise<ChatResult<ChatMessage>>;
  /** Several messages by id (what you can read of them). */
  messages(ids: readonly string[]): Promise<ChatResult<ChatMessage[]>>;
  /** Catch up's open items in this workspace (CV-11). */
  catchupOpen(workspaceId: string): Promise<ChatResult<ChatCatchupItem[]>>;
  /** Done: your items close (and their bell rows). Up to 1,000 ids. */
  catchupDone(ids: readonly string[]): Promise<ChatResult<number>>;
  /** Undo Done. */
  catchupReopen(ids: readonly string[]): Promise<ChatResult<number>>;
  /**
   * Later / Remind me on a message, `/remind` on a conversation, or Later on
   * Catch up items by id (one of the three); `at` null clears.
   */
  remind(args: {
    messageId?: string | null;
    channelId?: string | null;
    itemIds?: readonly string[] | null;
    at: string | null;
  }): Promise<ChatResult<number>>;
  /** You read the chain on the right: its Catch up items close. */
  chainRead(rootId: string): Promise<ChatResult<null>>;
  /** A conversation's reply chains (roots with replies), newest activity first. */
  chains(channelId: string): Promise<ChatResult<ChatMessage[]>>;
  /** Whether you follow a chain (no mute row = following). */
  chainFollowing(rootId: string): Promise<boolean>;
  followChain(rootId: string, following: boolean): Promise<ChatResult<null>>;
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
  /** A conversation's quiet history (Details, AC15.5): its logged changes, newest first. */
  history(args: {
    workspaceId: string;
    channelId: string;
    limit?: number;
  }): Promise<ChatHistoryEntry[]>;
  /** How many people are in each of these conversations (Browse channels). */
  memberCounts(channelIds: readonly string[]): Promise<Record<string, number>>;

  createChannel(args: {
    workspaceId: string;
    name: string;
    topic?: string;
    isPrivate?: boolean;
    memberIds?: string[];
    /** Only managers post (CH23a); the creator is the first manager. */
    announcement?: boolean;
    /** The optional link (CV-13): needs edit rights on the item. */
    link?: ChatLink | null;
  }): Promise<ChatChannel>;
  /** "Start a conversation for X" (CH56): named after X, public or private by who sees X. */
  startConversation(args: {
    workspaceId: string;
    type: ChatStartableTarget;
    id: string;
  }): Promise<ChatChannel>;
  /** Links the channel to one item, or unlinks it (null). */
  linkChannel(args: { channelId: string; link: ChatLink | null }): Promise<ChatChannel>;
  /** Whether capture from the channel files into its linked project for you (else the Inbox). */
  linkFilesHere(channelId: string): Promise<boolean>;
  openDm(args: { workspaceId: string; userIds: string[] }): Promise<ChatChannel>;
  updateChannel(args: { channelId: string; name?: string; topic?: string }): Promise<ChatChannel>;
  archiveChannel(args: { channelId: string; archived: boolean }): Promise<ChatChannel>;
  join(channelId: string): Promise<ChatMember>;
  leave(channelId: string): Promise<void>;
  addMembers(args: { channelId: string; userIds: string[] }): Promise<number>;
  removeMember(args: { channelId: string; userId: string }): Promise<void>;
  /** Make someone in the channel a manager, or not (the last manager stays). */
  setManager(args: { channelId: string; userId: string; on: boolean }): Promise<void>;
  /** The announcement switch: only managers post (CH23a). */
  setAnnouncement(args: { channelId: string; on: boolean }): Promise<ChatChannel>;
  /** Public → private, one way (CH59). */
  makePrivate(channelId: string): Promise<ChatChannel>;
  /** To Recently deleted for 30 days (CH62). */
  deleteChannel(channelId: string): Promise<void>;
  restoreChannel(channelId: string): Promise<ChatChannel>;
  /** The deleted channels you may restore, newest first. */
  recentlyDeleted(workspaceId: string): Promise<ChatDeletedChannel[]>;
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

  // ── References (CV-10; throw on failure) ──
  /** Makes a message linkable (no label), only for someone who can read it. */
  registerMessage(messageId: string): Promise<{ type: "chat_message"; id: string }>;
  /** Chips and cards for the messages you can read; the rest don't answer. */
  messageRefs(ids: readonly string[]): Promise<ChatMessageRef[]>;
  /** The "Mentioned in" lines you can read for an item you can open. */
  conversationsForItem(type: string, id: string): Promise<ChatItemConversation[]>;
  /** The tasks, notes and events made from these messages ("Became a task"). */
  madeFrom(messageIds: readonly string[]): Promise<ChatMadeFrom[]>;
};

/** A message as a reference (chat_message_refs): no words when it's deleted. */
export type ChatMessageRef = {
  id: string;
  workspaceId: string;
  channelId: string;
  channelKind: ChatChannelKind;
  /** Null for a direct message. */
  channelName: string | null;
  channelPrivate: boolean;
  parentId: string | null;
  authorId: string | null;
  authorKind: string | null;
  authorLabel: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  excerpt: string | null;
};

/** One line of an item's conversations (chat_conversations_for_item): a
 *  "Mentioned in" line, or a conversation linked to it (CV-13). */
export type ChatItemConversation = {
  channelId: string;
  workspaceId: string;
  channelKind: ChatChannelKind;
  channelName: string | null;
  channelPrivate: boolean;
  relation: Extract<RelationKind, "mentions" | "conversation-of">;
  since: string;
  /** Your unread messages in a linked conversation (0 when you aren't in it). */
  unread: number;
  archived: boolean;
};

/** An item made from a message (a `spawned-from` link to it). */
export type ChatMadeFrom = { messageId: string; type: string; id: string; createdAt: string };

/** Your chat settings. `reactionRow` null = Moduo's six (CH16a). */
export type UserChatPrefs = {
  reactionRow: string[] | null;
  showOnline: boolean;
  showFocusTask: boolean;
  noticeShowText: boolean;
  emailWhenAway: boolean;
};
