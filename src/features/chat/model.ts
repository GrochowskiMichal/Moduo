// Chat module — domain model (specs/chat.md).
//
// Rows come from three tables (chat_channels / chat_members / chat_messages,
// migration 20261006150000_chat_module). Closed vocabularies live in
// @contracts/vocabularies; this file only shapes rows for the UI.

import type { ChatChannelKind, ChatNotifyLevel } from "@contracts/vocabularies";

export type { ChatChannelKind, ChatNotifyLevel };

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
};

/** The current user's own state in a channel (or another member's row). */
export type ChatMember = {
  channelId: string;
  userId: string;
  workspaceId: string;
  notifyLevel: ChatNotifyLevel;
  starred: boolean;
  lastReadAt: string;
  joinedAt: string;
};

export type ChatReactions = Record<string, string[]>;

export type ChatMessage = {
  id: string;
  workspaceId: string;
  channelId: string;
  parentId: string | null;
  authorId: string | null;
  /** "api_key" = posted by an app/agent over MCP (authorId is null). */
  authorKind: "user" | "api_key";
  /** The app's name at post time, for api_key authors. */
  authorLabel: string | null;
  body: string;
  mentionedUserIds: string[];
  reactions: ChatReactions;
  replyCount: number;
  lastReplyAt: string | null;
  replyUserIds: string[];
  pinnedAt: string | null;
  pinnedBy: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  clientId: string | null;
  createdAt: string;
  /** Client-only: an optimistic send that hasn't been confirmed yet. */
  pending?: boolean;
  /** Client-only: an optimistic send the server rejected — offer retry. */
  failed?: boolean;
};

export type ChatUnread = { channelId: string; unread: number; mentions: number };

/** A workspace person as chat renders them. */
export type ChatPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string | null;
};

/** The arguments `runtime.chat.send` takes. */
export type ChatSendArgs = {
  channelId: string;
  body: string;
  parentId?: string | null;
  mentionedUserIds?: string[];
  notifyChannel?: boolean;
  clientId?: string;
  /** Plain-text rendering for the notification card (tokens resolved to names). */
  excerpt?: string;
};

export type ChatRuntime = {
  /** Whether this workspace's plan includes chat (owner's tier ≥ Duo). */
  isEnabled(workspaceId: string): Promise<boolean>;
  /** Idempotent: makes sure #general exists. */
  bootstrap(workspaceId: string): Promise<void>;
  listChannels(workspaceId: string): Promise<ChatChannel[]>;
  /** The current user's memberships in this workspace. */
  listMyMemberships(workspaceId: string, userId: string): Promise<ChatMember[]>;
  listChannelMembers(channelId: string): Promise<ChatMember[]>;
  unreadCounts(workspaceId: string): Promise<ChatUnread[]>;
  /** Newest-first page of top-level messages, strictly older than `before`. */
  listMessages(args: {
    channelId: string;
    before?: string | null;
    limit?: number;
  }): Promise<ChatMessage[]>;
  /** A thread's replies, oldest first. */
  listReplies(parentId: string): Promise<ChatMessage[]>;
  getMessage(messageId: string): Promise<ChatMessage | null>;
  listPinned(channelId: string): Promise<ChatMessage[]>;
  /** Full-text-ish search across messages the user can read. */
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

  send(args: ChatSendArgs): Promise<ChatMessage>;
  edit(args: {
    messageId: string;
    body: string;
    mentionedUserIds?: string[];
  }): Promise<ChatMessage>;
  remove(messageId: string): Promise<ChatMessage>;
  react(args: { messageId: string; emoji: string }): Promise<ChatMessage>;
  pin(args: { messageId: string; pinned: boolean }): Promise<ChatMessage>;
  markRead(args: { channelId: string; at?: string }): Promise<void>;
  markUnread(args: { channelId: string; before: string }): Promise<void>;
  setPrefs(args: {
    channelId: string;
    notifyLevel?: ChatNotifyLevel;
    starred?: boolean;
  }): Promise<ChatMember>;
};
