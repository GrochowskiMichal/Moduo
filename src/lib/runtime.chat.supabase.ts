/**
 * Chat runtime (specs/chat.md, specs/chat-v2.md) — the Supabase-backed
 * implementation, given a client (`runtime.chat.web.ts` hands it the app's;
 * the local-stack probe hands it a signed-in test client). Shared by web and
 * desktop (runtime.tauri delegates to the web runtime, like tasks/spine).
 *
 * Two halves (CV-3, round-3 §1.2):
 *  - **The store's transport**: keyset pages on `(created_at, id)`, delta reads
 *    on the server's `updated_at`, the access check, and the message ops under
 *    client-minted ids. Each returns `{ data, error }` with the server's code
 *    (`42501`, `P0002`, `22023` mean it said no; no code and a fetch failure
 *    mean the network): none throws.
 *  - **Conversation reads and ops** that v1's surfaces still call: they throw
 *    on `error`, as before.
 *
 * Reads are direct SELECTs under RLS (`chat_can_read_channel`); every write is
 * a `chat_op_*` SECURITY DEFINER op that re-checks access and the plan gate
 * server-side. supabase-js reports failures on `error`, never by throwing —
 * every call checks it (gotchas §Supabase). Message reads name their columns
 * (`CHAT_MESSAGE_COLUMNS`): `search_tsv` and `body_text` stay off the wire.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_MESSAGE_COLUMNS } from "../features/chat/columns";
import {
  mapChannel,
  mapMember,
  mapMessage,
  mapPerson,
  mapRows,
  mapSyncRow,
  mapUnread,
  mapUserChatPrefs,
} from "../features/chat/mappers";
import type {
  ChatChannel,
  ChatError,
  ChatMember,
  ChatMessage,
  ChatResult,
  ChatRuntime,
} from "../features/chat/model";

const MESSAGE_COLUMNS = CHAT_MESSAGE_COLUMNS;

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

// ── Results (the store's transport never throws) ────────────────────────────

type SupabaseError = { message: string; code?: string | null } | null;

function chatError(error: NonNullable<SupabaseError>): ChatError {
  return { code: error.code ? String(error.code) : null, message: error.message };
}

function ok<T>(data: T): ChatResult<T> {
  return { data, error: null };
}

function bad<T>(error: ChatError): ChatResult<T> {
  return { data: null, error };
}

/** An op's single row, mapped; a missing row is an error, not a throw. */
function rowResult(data: unknown, error: SupabaseError, what: string): ChatResult<ChatMessage> {
  if (error) return bad(chatError(error));
  const mapped = mapMessage(Array.isArray(data) ? data[0] : data);
  return mapped
    ? ok(mapped)
    : bad({ code: null, message: `The ${what} operation returned nothing.` });
}

/** Runs one request; a thrown fetch (some engines, some proxies) reads as the network. */
async function attempt<T>(run: () => Promise<ChatResult<T>>): Promise<ChatResult<T>> {
  try {
    return await run();
  } catch (e) {
    return bad({ code: null, message: e instanceof Error ? e.message : String(e) });
  }
}

/** A key in a PostgREST logic tree: quoted, so its `:` and `.` stay part of the value. */
const q = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

export function chatRuntimeOn(db: () => SupabaseClient): ChatRuntime {
  return {
    // ── the store's transport ──────────────────────────────────────────────────

    page: ({ channelId, before, after, limit }) =>
      attempt(async () => {
        let query = db().from("chat_messages").select(MESSAGE_COLUMNS).eq("channel_id", channelId);
        // (created_at, id) < key, spelled for PostgREST: the bound keeps it an index range.
        if (after) {
          query = query
            .gte("created_at", after.at)
            .or(`created_at.gt.${q(after.at)},id.gt.${after.id}`)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true });
        } else {
          if (before) {
            query = query
              .lte("created_at", before.at)
              .or(`created_at.lt.${q(before.at)},id.lt.${before.id}`);
          }
          query = query.order("created_at", { ascending: false }).order("id", { ascending: false });
        }
        const { data, error } = await query.limit(limit);
        if (error) return bad(chatError(error));
        const rows = mapRows(data, mapMessage);
        return ok(after ? rows : rows.reverse());
      }),

    chain: (rootId) =>
      attempt(async () => {
        const { data, error } = await db()
          .from("chat_messages")
          .select(MESSAGE_COLUMNS)
          .or(`id.eq.${rootId},parent_id.eq.${rootId}`)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(1000);
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapMessage));
      }),

    message: (id) =>
      attempt(async () => {
        const { data, error } = await db()
          .from("chat_messages")
          .select(MESSAGE_COLUMNS)
          .eq("id", id)
          .maybeSingle();
        if (error) return bad(chatError(error));
        return ok(mapMessage(data));
      }),

    delta: ({ workspaceId, since, after, limit, channelIds }) =>
      attempt(async () => {
        let query = db()
          .from("chat_messages")
          .select(MESSAGE_COLUMNS)
          .eq("workspace_id", workspaceId);
        if (channelIds) query = query.in("channel_id", [...channelIds]);
        // Both forms stay a range on (workspace_id, updated_at, id) with the >= bound.
        query = after
          ? query
              .gte("updated_at", after.updatedAt)
              .or(`updated_at.gt.${q(after.updatedAt)},id.gt.${after.id}`)
          : query.gte("updated_at", since);
        const { data, error } = await query
          .order("updated_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(limit);
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapMessage));
      }),

    syncIds: (workspaceId, since) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_sync_ids", {
          p_workspace_id: workspaceId,
          p_since: since,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapSyncRow));
      }),

    people: (workspaceId) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_people", {
          p_workspace_id: workspaceId,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapPerson));
      }),

    counts: (workspaceId) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_unread_counts", {
          p_workspace_id: workspaceId,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapUnread));
      }),

    send: ({ id, channelId, body, replyToId, format }) =>
      attempt(async () => {
        // v1's screens send v1 markup through the old signature, which converts it
        // on the server and keeps the client-minted id as the row's id (CV-2a).
        const { data, error } =
          format === "v1"
            ? await db()
                .rpc("chat_op_send", {
                  p_channel_id: channelId,
                  p_body: body,
                  p_parent_id: replyToId,
                  p_client_id: id,
                })
                .select(MESSAGE_COLUMNS)
            : await db()
                .rpc("chat_op_send", {
                  p_id: id,
                  p_channel_id: channelId,
                  p_body: body,
                  p_reply_to_id: replyToId,
                })
                .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "send");
      }),

    edit: ({ id, body, format }) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc(
            "chat_op_edit",
            format === "v1"
              ? { p_message_id: id, p_body: body, p_mentioned_user_ids: [] }
              : { p_message_id: id, p_body: body },
          )
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "edit");
      }),

    remove: (id) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_delete", { p_message_id: id })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "delete");
      }),

    react: ({ id, key, on }) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_react", { p_message_id: id, p_key: key, p_on: on })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "react");
      }),

    pin: ({ id, pinned }) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_pin", { p_message_id: id, p_pinned: pinned })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "pin");
      }),

    markRead: ({ channelId, messageId }) =>
      attempt(async () => {
        const { error } = await db().rpc("chat_op_mark_read", {
          p_channel_id: channelId,
          p_message_id: messageId,
        });
        return error ? bad(chatError(error)) : ok(null);
      }),

    markUnread: ({ channelId, messageId }) =>
      attempt(async () => {
        const { error } = await db().rpc("chat_op_mark_unread", {
          p_channel_id: channelId,
          p_message_id: messageId,
        });
        return error ? bad(chatError(error)) : ok(null);
      }),

    async typing({ channelId, parentId, stop }) {
      // Best effort either way: a refused or lost typing event changes nothing.
      try {
        await db().rpc("chat_op_typing", {
          p_channel_id: channelId,
          p_parent_id: parentId,
          p_stop: stop,
        });
      } catch {
        // The network: nothing to show.
      }
    },

    // ── conversation reads and ops ─────────────────────────────────────────────

    /** Chat is on: the owner's plan includes it or the workspace holds a dated grant
     *  (decided server-side, CV-4). Off means paused: the server still serves
     *  reads, and Chat shows its paused state (CV-8a). */
    async isEnabled(workspaceId) {
      const { data, error } = await db().rpc("chat_workspace_enabled", {
        p_workspace_id: workspaceId,
      });
      fail(error);
      return data === true;
    },

    async bootstrap(workspaceId) {
      const { error } = await db().rpc("chat_op_bootstrap", {
        p_workspace_id: workspaceId,
      });
      fail(error);
    },

    async listChannels(workspaceId) {
      const { data, error } = await db()
        .from("chat_channels")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .order("id");
      fail(error);
      return mapRows(data, mapChannel);
    },

    async listMyMemberships(workspaceId, userId) {
      const { data, error } = await db()
        .from("chat_members")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .is("left_at", null);
      fail(error);
      return mapRows(data, mapMember);
    },

    async listChannelMembers(channelId) {
      const { data, error } = await db()
        .from("chat_members")
        .select("*")
        .eq("channel_id", channelId)
        .is("left_at", null)
        .order("joined_at", { ascending: true });
      fail(error);
      return mapRows(data, mapMember);
    },

    async unreadCounts(workspaceId) {
      const { data, error } = await db().rpc("chat_unread_counts", {
        p_workspace_id: workspaceId,
      });
      fail(error);
      return mapRows(data, mapUnread);
    },

    async listPinned(channelId) {
      const { data, error } = await db()
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
      const term = query.trim();
      if (!term) return [];
      const { data, error } = await db()
        .from("chat_messages")
        .select(MESSAGE_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("kind", "message")
        .is("deleted_at", null)
        .ilike("body", `%${likeLiteral(term)}%`)
        .order("created_at", { ascending: false })
        .limit(limit);
      fail(error);
      return mapRows(data, mapMessage);
    },

    async createChannel({ workspaceId, name, topic, isPrivate, memberIds }) {
      const { data, error } = await db().rpc("chat_op_create_channel", {
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
      const { data, error } = await db().rpc("chat_op_open_dm", {
        p_workspace_id: workspaceId,
        p_user_ids: userIds,
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "open conversation");
    },

    async updateChannel({ channelId, name, topic }) {
      const { data, error } = await db().rpc("chat_op_update_channel", {
        p_channel_id: channelId,
        p_name: name ?? null,
        p_topic: topic ?? null,
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "update channel");
    },

    async archiveChannel({ channelId, archived }) {
      const { data, error } = await db().rpc("chat_op_archive_channel", {
        p_channel_id: channelId,
        p_archived: archived,
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "archive channel");
    },

    async join(channelId) {
      const { data, error } = await db().rpc("chat_op_join", { p_channel_id: channelId });
      fail(error);
      return single<ChatMember>(data, mapMember, "join");
    },

    async leave(channelId) {
      const { error } = await db().rpc("chat_op_leave", { p_channel_id: channelId });
      fail(error);
    },

    async addMembers({ channelId, userIds }) {
      const { data, error } = await db().rpc("chat_op_add_members", {
        p_channel_id: channelId,
        p_user_ids: userIds,
      });
      fail(error);
      return typeof data === "number" ? data : 0;
    },

    async removeMember({ channelId, userId }) {
      const { error } = await db().rpc("chat_op_remove_member", {
        p_channel_id: channelId,
        p_user_id: userId,
      });
      fail(error);
    },

    async setPrefs({ channelId, notifyLevel, starred }) {
      const { data, error } = await db().rpc("chat_op_set_prefs", {
        p_channel_id: channelId,
        p_notify_level: notifyLevel ?? null,
        p_starred: starred ?? null,
      });
      fail(error);
      return single<ChatMember>(data, mapMember, "update preferences");
    },

    async myPrefs() {
      const { data, error } = await db().rpc("user_chat_prefs");
      fail(error);
      return mapUserChatPrefs(data);
    },

    async setMyPrefs(patch) {
      // Only what the patch names; the op takes no person (it's auth.uid()).
      const body: Record<string, unknown> = {};
      if ("reactionRow" in patch) body.reaction_row = patch.reactionRow ?? null;
      if (patch.showOnline !== undefined) body.show_online = patch.showOnline;
      if (patch.showFocusTask !== undefined) body.show_focus_task = patch.showFocusTask;
      if (patch.noticeShowText !== undefined) body.notice_show_text = patch.noticeShowText;
      if (patch.emailWhenAway !== undefined) body.email_when_away = patch.emailWhenAway;
      const { data, error } = await db().rpc("user_op_set_chat_prefs", { p_patch: body });
      fail(error);
      return mapUserChatPrefs(data);
    },
  };
}
