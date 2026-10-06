/**
 * Chat runtime (specs/chat.md) — the Supabase-backed implementation shared by
 * web and desktop (runtime.tauri delegates here, like tasks/spine).
 *
 * Reads are direct SELECTs under RLS (`chat_can_read_channel`); every write is
 * a `chat_op_*` SECURITY DEFINER op that re-checks access and the Duo/Team plan
 * gate server-side. supabase-js reports failures on `error`, never by throwing
 * — every call checks it (gotchas §Supabase).
 */

import { mapChannel, mapMember, mapMessage, mapRows, mapUnread } from "../features/chat/mappers";
import type { ChatChannel, ChatMember, ChatMessage, ChatRuntime } from "../features/chat/model";
import { supabaseClient } from "./runtime.web";

const MESSAGE_COLUMNS =
  "id, workspace_id, channel_id, parent_id, author_id, author_kind, author_label, body, mentioned_user_ids, reactions, reply_count, last_reply_at, reply_user_ids, pinned_at, pinned_by, edited_at, deleted_at, client_id, created_at";

function single<T>(data: unknown, mapper: (r: unknown) => T | null, what: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  const mapped = mapper(row);
  if (!mapped) throw new Error(`The ${what} operation returned nothing.`);
  return mapped;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** Escape LIKE wildcards so a search for "50%" matches literally. */
function likeLiteral(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const webChatRuntime: ChatRuntime = {
  async isEnabled(workspaceId) {
    const { data, error } = await supabaseClient.rpc("chat_workspace_enabled", {
      p_workspace_id: workspaceId,
    });
    fail(error);
    return data === true;
  },

  async bootstrap(workspaceId) {
    const { error } = await supabaseClient.rpc("chat_op_bootstrap", {
      p_workspace_id: workspaceId,
    });
    fail(error);
  },

  async listChannels(workspaceId) {
    const { data, error } = await supabaseClient
      .from("chat_channels")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id");
    fail(error);
    return mapRows(data, mapChannel);
  },

  async listMyMemberships(workspaceId, userId) {
    const { data, error } = await supabaseClient
      .from("chat_members")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    fail(error);
    return mapRows(data, mapMember);
  },

  async listChannelMembers(channelId) {
    const { data, error } = await supabaseClient
      .from("chat_members")
      .select("*")
      .eq("channel_id", channelId)
      .order("joined_at", { ascending: true });
    fail(error);
    return mapRows(data, mapMember);
  },

  async unreadCounts(workspaceId) {
    const { data, error } = await supabaseClient.rpc("chat_unread_counts", {
      p_workspace_id: workspaceId,
    });
    fail(error);
    return mapRows(data, mapUnread);
  },

  async listMessages({ channelId, before, limit = 50 }) {
    let query = supabaseClient
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("channel_id", channelId)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query;
    fail(error);
    return mapRows(data, mapMessage);
  },

  async listReplies(parentId) {
    const { data, error } = await supabaseClient
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("parent_id", parentId)
      .order("created_at", { ascending: true })
      .order("id")
      .limit(1000);
    fail(error);
    return mapRows(data, mapMessage);
  },

  async getMessage(messageId) {
    const { data, error } = await supabaseClient
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("id", messageId)
      .maybeSingle();
    fail(error);
    return mapMessage(data);
  },

  async listPinned(channelId) {
    const { data, error } = await supabaseClient
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("channel_id", channelId)
      .not("pinned_at", "is", null)
      .is("deleted_at", null)
      .order("pinned_at", { ascending: false })
      .limit(100);
    fail(error);
    return mapRows(data, mapMessage);
  },

  async search({ workspaceId, query, limit = 40 }) {
    const q = query.trim();
    if (!q) return [];
    const { data, error } = await supabaseClient
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .ilike("body", `%${likeLiteral(q)}%`)
      .order("created_at", { ascending: false })
      .limit(limit);
    fail(error);
    return mapRows(data, mapMessage);
  },

  async createChannel({ workspaceId, name, topic, isPrivate, memberIds }) {
    const { data, error } = await supabaseClient.rpc("chat_op_create_channel", {
      p_workspace_id: workspaceId,
      p_name: name,
      p_topic: topic ?? "",
      p_is_private: isPrivate ?? false,
      p_member_ids: memberIds ?? [],
    });
    fail(error);
    return single<ChatChannel>(data, mapChannel, "create channel");
  },

  async openDm({ workspaceId, userIds }) {
    const { data, error } = await supabaseClient.rpc("chat_op_open_dm", {
      p_workspace_id: workspaceId,
      p_user_ids: userIds,
    });
    fail(error);
    return single<ChatChannel>(data, mapChannel, "open conversation");
  },

  async updateChannel({ channelId, name, topic }) {
    const { data, error } = await supabaseClient.rpc("chat_op_update_channel", {
      p_channel_id: channelId,
      p_name: name ?? null,
      p_topic: topic ?? null,
    });
    fail(error);
    return single<ChatChannel>(data, mapChannel, "update channel");
  },

  async archiveChannel({ channelId, archived }) {
    const { data, error } = await supabaseClient.rpc("chat_op_archive_channel", {
      p_channel_id: channelId,
      p_archived: archived,
    });
    fail(error);
    return single<ChatChannel>(data, mapChannel, "archive channel");
  },

  async join(channelId) {
    const { data, error } = await supabaseClient.rpc("chat_op_join", { p_channel_id: channelId });
    fail(error);
    return single<ChatMember>(data, mapMember, "join");
  },

  async leave(channelId) {
    const { error } = await supabaseClient.rpc("chat_op_leave", { p_channel_id: channelId });
    fail(error);
  },

  async addMembers({ channelId, userIds }) {
    const { data, error } = await supabaseClient.rpc("chat_op_add_members", {
      p_channel_id: channelId,
      p_user_ids: userIds,
    });
    fail(error);
    return typeof data === "number" ? data : 0;
  },

  async removeMember({ channelId, userId }) {
    const { error } = await supabaseClient.rpc("chat_op_remove_member", {
      p_channel_id: channelId,
      p_user_id: userId,
    });
    fail(error);
  },

  async send({ channelId, body, parentId, mentionedUserIds, notifyChannel, clientId, excerpt }) {
    const { data, error } = await supabaseClient.rpc("chat_op_send", {
      p_channel_id: channelId,
      p_body: body,
      p_parent_id: parentId ?? null,
      p_mentioned_user_ids: mentionedUserIds ?? [],
      p_notify_channel: notifyChannel ?? false,
      p_client_id: clientId ?? null,
      p_excerpt: excerpt ?? null,
    });
    fail(error);
    return single<ChatMessage>(data, mapMessage, "send");
  },

  async edit({ messageId, body, mentionedUserIds }) {
    const { data, error } = await supabaseClient.rpc("chat_op_edit", {
      p_message_id: messageId,
      p_body: body,
      p_mentioned_user_ids: mentionedUserIds ?? [],
    });
    fail(error);
    return single<ChatMessage>(data, mapMessage, "edit");
  },

  async remove(messageId) {
    const { data, error } = await supabaseClient.rpc("chat_op_delete", { p_message_id: messageId });
    fail(error);
    return single<ChatMessage>(data, mapMessage, "delete");
  },

  async react({ messageId, emoji }) {
    const { data, error } = await supabaseClient.rpc("chat_op_react", {
      p_message_id: messageId,
      p_emoji: emoji,
    });
    fail(error);
    return single<ChatMessage>(data, mapMessage, "react");
  },

  async pin({ messageId, pinned }) {
    const { data, error } = await supabaseClient.rpc("chat_op_pin", {
      p_message_id: messageId,
      p_pinned: pinned,
    });
    fail(error);
    return single<ChatMessage>(data, mapMessage, "pin");
  },

  async markRead({ channelId, at }) {
    const { error } = await supabaseClient.rpc("chat_op_mark_read", {
      p_channel_id: channelId,
      p_at: at ?? null,
    });
    fail(error);
  },

  async markUnread({ channelId, before }) {
    const { error } = await supabaseClient.rpc("chat_op_mark_unread", {
      p_channel_id: channelId,
      p_before: before,
    });
    fail(error);
  },

  async setPrefs({ channelId, notifyLevel, starred }) {
    const { data, error } = await supabaseClient.rpc("chat_op_set_prefs", {
      p_channel_id: channelId,
      p_notify_level: notifyLevel ?? null,
      p_starred: starred ?? null,
    });
    fail(error);
    return single<ChatMember>(data, mapMember, "update preferences");
  },
};
