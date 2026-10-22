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

import { CUSTOM_EMOJI_PER_WORKSPACE } from "@contracts/vocabularies";

import { CHAT_MESSAGE_COLUMNS } from "../features/chat/columns";
import { mapCustomEmoji } from "../features/chat/emoji/model";
import { type Db, DbError, type Json } from "./runtime.db";

/** The private bucket custom emoji images live in (CV-20). */
const CHAT_EMOJI_BUCKET = "chat-emoji";
const CUSTOM_EMOJI_COLUMNS =
  "id, workspace_id, name, storage_path, poster_path, mime, width, height, bytes, animated, created_by, created_at, deleted_at";

import {
  mapCatchupItem,
  mapChannel,
  mapChatFile,
  mapConversationFound,
  mapDeletedChannel,
  mapHistory,
  mapItemDecision,
  mapMember,
  mapMessage,
  mapPerson,
  mapRows,
  mapSearchHit,
  mapSyncRow,
  mapUnread,
  mapUserChatPrefs,
  parseMoveAnswer,
} from "../features/chat/mappers";
import {
  CHAT_HISTORY_OPS,
  type ChatChannel,
  type ChatError,
  type ChatMember,
  type ChatMessage,
  type ChatMessageRef,
  type ChatResult,
  type ChatRuntime,
} from "../features/chat/model";

const MESSAGE_COLUMNS = CHAT_MESSAGE_COLUMNS;

type Row = Record<string, unknown>;

function single<T>(data: unknown, mapper: (r: unknown) => T | null, what: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  const mapped = mapper(row);
  if (!mapped) throw new Error(`The ${what} operation returned nothing.`);
  return mapped;
}

function fail(error: { message: string } | null): void {
  if (error) throw new DbError(error);
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

/** A key in a PostgREST logic tree: quoted, so its `:` and `.` stay part of the value.
 * Backslashes go first: a value ending in `\` would otherwise escape the closing quote. */
export const q = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function chatRuntimeOn(db: () => Db): ChatRuntime {
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

    search: ({ workspaceId, query, channelId, fromId, after, hasFile, before, limit }) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_search", {
          p_workspace_id: workspaceId,
          p_query: query,
          p_channel_id: channelId ?? null,
          p_before: before?.createdAt ?? null,
          p_before_id: before?.messageId ?? null,
          p_limit: limit ?? 50,
          p_from: fromId ?? null,
          p_after: after ?? null,
          p_has_file: hasFile ?? false,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapSearchHit));
      }),

    findConversations: ({ workspaceId, query, limit }) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_find_conversations", {
          p_workspace_id: workspaceId,
          p_query: query,
          p_limit: limit ?? 5,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapConversationFound));
      }),

    counts: (workspaceId) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_unread_counts", {
          p_workspace_id: workspaceId,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapUnread));
      }),

    send: ({ id, channelId, body, replyToId }) =>
      attempt(async () => {
        // Idempotent on the id the client minted (the outbox retries with it).
        const { data, error } = await db()
          .rpc("chat_op_send", {
            p_id: id,
            p_channel_id: channelId,
            p_body: body,
            p_reply_to_id: replyToId,
          })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "send");
      }),

    edit: ({ id, body }) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_edit", { p_message_id: id, p_body: body })
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

    markDecision: ({ id, on }) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_mark_decision", { p_message_id: id, p_on: on })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "decision");
      }),

    wrapUp: ({ rootId, settledId, markDecision }) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_wrap_up", {
            p_root_id: rootId,
            p_settled_id: settledId,
            p_mark_decision: markDecision ?? false,
          })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "wrap up");
      }),

    reopen: (rootId) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_reopen", { p_root_id: rootId })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "reopen");
      }),

    attachToChain: ({ messageId, replyToId }) =>
      attempt(async () => {
        const { data, error } = await db()
          .rpc("chat_op_attach_to_chain", { p_message_id: messageId, p_reply_to_id: replyToId })
          .select(MESSAGE_COLUMNS);
        return rowResult(data, error, "reply to");
      }),

    moveMessages: ({ ids, targetId, confirm, undo }) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_op_move_messages", {
          p_ids: ids,
          p_target_channel_id: targetId,
          p_confirm: confirm,
          p_undo: undo ?? false,
        });
        if (error) return bad(chatError(error));
        const answer = parseMoveAnswer(data);
        return answer ? ok(answer) : bad({ code: null, message: "Couldn't move the messages." });
      }),

    messages: (ids) =>
      attempt(async () => {
        // PostgREST puts the ids in the URL: 100 at a time, side by side.
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
        const results = await Promise.all(
          chunks.map((chunk) => db().from("chat_messages").select(MESSAGE_COLUMNS).in("id", chunk)),
        );
        const out: ChatMessage[] = [];
        for (const { data, error } of results) {
          if (error) return bad(chatError(error));
          out.push(...mapRows(data, mapMessage));
        }
        return ok(out);
      }),

    catchupOpen: (workspaceId) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_catchup_open", {
          p_workspace_id: workspaceId,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapCatchupItem));
      }),

    catchupDone: (ids) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_op_catchup_done", { p_item_ids: [...ids] });
        return error ? bad(chatError(error)) : ok(Number(data) || 0);
      }),

    catchupReopen: (ids) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_op_catchup_reopen", {
          p_item_ids: [...ids],
        });
        return error ? bad(chatError(error)) : ok(Number(data) || 0);
      }),

    remind: ({ messageId, channelId, itemIds, at }) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_op_remind", {
          p_message_id: itemIds ? null : (messageId ?? null),
          p_channel_id: itemIds || messageId ? null : (channelId ?? null),
          p_at: at,
          p_item_ids: itemIds ? [...itemIds] : null,
        });
        return error ? bad(chatError(error)) : ok(Number(data) || 0);
      }),

    chainRead: (rootId) =>
      attempt(async () => {
        const { error } = await db().rpc("chat_op_chain_read", { p_root_id: rootId });
        return error ? bad(chatError(error)) : ok(null);
      }),

    chains: (channelId) =>
      attempt(async () => {
        const { data, error } = await db()
          .from("chat_messages")
          .select(MESSAGE_COLUMNS)
          .eq("channel_id", channelId)
          .is("parent_id", null)
          .gt("reply_count", 0)
          .is("deleted_at", null)
          .order("last_reply_at", { ascending: false })
          .limit(100);
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapMessage));
      }),

    // CV-9: the Files view (newest message first) and the files of a page of messages.
    files: ({ channelId, before, limit }) =>
      attempt(async () => {
        const { data, error } = await db().rpc("chat_files", {
          p_channel_id: channelId,
          p_before: before?.sentAt ?? null,
          p_limit: limit ?? 50,
          p_before_id: before?.id ?? null,
        });
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapChatFile));
      }),

    messageFiles: (messageIds) =>
      attempt(async () => {
        if (messageIds.length === 0) return ok([]);
        // Read through the attachments policy: only what the reader may read.
        const { data, error } = await db()
          .from("attachments")
          .select(
            "id, entity_id, uploader_id, file_name, mime, size_bytes, width, height, object_path, preview_path, preview_mime, created_at",
          )
          .eq("entity_type", "chat_message")
          .in("entity_id", [...messageIds])
          .eq("status", "ready")
          .is("deleted_at", null)
          .order("created_at")
          .order("id")
          .limit(messageIds.length * 10);
        if (error) return bad(chatError(error));
        return ok(mapRows(data, mapChatFile));
      }),

    async chainFollowing(rootId) {
      // RLS shows only your own rows: a row means you stopped following.
      const { data, error } = await db()
        .from("chat_chain_mutes")
        .select("root_id")
        .eq("root_id", rootId)
        .maybeSingle();
      fail(error);
      return !data;
    },

    followChain: (rootId, following) =>
      attempt(async () => {
        const { error } = await db().rpc("chat_op_follow_chain", {
          p_message_id: rootId,
          p_following: following,
        });
        return error ? bad(chatError(error)) : ok(null);
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

    async listDecisions(channelId) {
      const { data, error } = await db()
        .from("chat_messages")
        .select(MESSAGE_COLUMNS)
        .eq("channel_id", channelId)
        .not("decision_at", "is", null)
        .is("deleted_at", null)
        .order("decision_at", { ascending: false })
        .limit(100);
      fail(error);
      return mapRows(data, mapMessage);
    },

    async listKeyReaders(channelId) {
      const { data, error } = await db().rpc("chat_key_readers", { p_channel_id: channelId });
      // Not on this server yet (CV-21's migration): nobody to name.
      if (error?.code === "PGRST202") return [];
      fail(error);
      return ((data ?? []) as Array<{ user_id?: unknown; display_name?: unknown }>)
        .filter((r) => typeof r.user_id === "string")
        .map((r) => ({
          userId: r.user_id as string,
          name: typeof r.display_name === "string" ? r.display_name : "Someone",
        }));
    },

    async history({ workspaceId, channelId, limit = 50 }) {
      // The trail's read policy answers only conversations the caller reads.
      const { data, error } = await db()
        .from("module_activity")
        .select("id, op, actor_type, actor_id, actor_label, payload, created_at")
        .eq("workspace_id", workspaceId)
        .eq("module", "chat")
        .eq("entity_type", "chat_channel")
        .eq("entity_id", channelId)
        .in("op", [...CHAT_HISTORY_OPS])
        .order("created_at", { ascending: false })
        .limit(limit);
      fail(error);
      return mapRows(data, mapHistory);
    },

    async memberCounts(channelIds) {
      const out: Record<string, number> = {};
      for (const id of channelIds) out[id] = 0;
      const PAGE_ROWS = 1000; // the API's row cap: page until a short page
      for (let i = 0; i < channelIds.length; i += 100) {
        for (let from = 0; ; from += PAGE_ROWS) {
          const { data, error } = await db()
            .from("chat_members")
            .select("channel_id, user_id")
            .in("channel_id", channelIds.slice(i, i + 100))
            .is("left_at", null)
            .order("channel_id")
            .order("user_id")
            .range(from, from + PAGE_ROWS - 1);
          fail(error);
          const rows = (data ?? []) as Array<{ channel_id?: unknown }>;
          for (const row of rows) {
            const id = row.channel_id;
            if (typeof id === "string") out[id] = (out[id] ?? 0) + 1;
          }
          if (rows.length < PAGE_ROWS) break;
        }
      }
      return out;
    },

    async createChannel({ workspaceId, name, topic, isPrivate, memberIds, announcement, link }) {
      const { data, error } = await db().rpc("chat_op_create_channel", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_topic: topic ?? "",
        p_is_private: isPrivate ?? false,
        p_member_ids: memberIds ?? [],
        p_announcement: announcement ?? false,
        // Only with a link (CV-13), so a plain create keeps its arguments.
        ...(link ? { p_link_type: link.type, p_link_id: link.id } : {}),
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "create channel");
    },

    async startConversation({ workspaceId, type, id }) {
      const { data, error } = await db().rpc("chat_op_start_conversation", {
        p_workspace_id: workspaceId,
        p_type: type,
        p_id: id,
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "start conversation");
    },

    async linkChannel({ channelId, link }) {
      const { data, error } = await db().rpc("chat_op_link_channel", {
        p_channel_id: channelId,
        p_type: link?.type ?? null,
        p_id: link?.id ?? null,
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "link channel");
    },

    async linkFilesHere(channelId) {
      const { data, error } = await db().rpc("chat_link_files_here", { p_channel_id: channelId });
      fail(error);
      return data === true;
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

    async setManager({ channelId, userId, on }) {
      const { error } = await db().rpc("chat_op_set_manager", {
        p_channel_id: channelId,
        p_user_id: userId,
        p_on: on,
      });
      fail(error);
    },

    async setAnnouncement({ channelId, on }) {
      const { data, error } = await db().rpc("chat_op_set_announcement", {
        p_channel_id: channelId,
        p_on: on,
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "announcement switch");
    },

    async makePrivate(channelId) {
      const { data, error } = await db().rpc("chat_op_make_private", { p_channel_id: channelId });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "make private");
    },

    async deleteChannel(channelId) {
      const { error } = await db().rpc("chat_op_delete_channel", { p_channel_id: channelId });
      fail(error);
    },

    async restoreChannel(channelId) {
      const { data, error } = await db().rpc("chat_op_restore_channel", {
        p_channel_id: channelId,
      });
      fail(error);
      return single<ChatChannel>(data, mapChannel, "restore channel");
    },

    async recentlyDeleted(workspaceId) {
      const { data, error } = await db().rpc("chat_recently_deleted", {
        p_workspace_id: workspaceId,
      });
      fail(error);
      return mapRows(data, mapDeletedChannel);
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
      const { data, error } = await db().rpc("user_op_set_chat_prefs", { p_patch: body as Json });
      fail(error);
      return mapUserChatPrefs(data);
    },

    async customEmoji(workspaceId) {
      const { data, error } = await db()
        .from("chat_custom_emoji")
        .select(CUSTOM_EMOJI_COLUMNS)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(CUSTOM_EMOJI_PER_WORKSPACE);
      fail(error);
      return (Array.isArray(data) ? data : [])
        .map(mapCustomEmoji)
        .filter((e): e is NonNullable<typeof e> => e !== null);
    },

    async uploadEmojiImage(path, image, mime) {
      const { error } = await db()
        .storage.from(CHAT_EMOJI_BUCKET)
        .upload(path, image, { contentType: mime, upsert: false, cacheControl: "31536000" });
      if (error) throw new Error(error.message);
    },

    async beginCustomEmoji(workspaceId) {
      const { data, error } = await db().rpc("chat_op_custom_emoji_begin", {
        p_workspace_id: workspaceId,
      });
      fail(error);
      if (typeof data !== "string") throw new Error("Couldn't start the upload.");
      return data;
    },

    async addCustomEmoji(input) {
      const { data, error } = await db().rpc("chat_op_custom_emoji_add", {
        p_upload_id: input.uploadId,
        p_name: input.name,
        p_mime: input.mime,
        p_width: input.width,
        p_height: input.height,
        p_bytes: input.bytes,
        p_animated: input.animated,
      });
      fail(error);
      return single(data, mapCustomEmoji, "add emoji");
    },

    async removeCustomEmoji(id) {
      const { data, error } = await db().rpc("chat_op_custom_emoji_remove", { p_id: id });
      fail(error);
      return single(data, mapCustomEmoji, "remove emoji");
    },

    async emojiUrls(paths, ttlSeconds) {
      const out = new Map<string, string>();
      if (paths.length === 0) return out;
      const { data, error } = await db()
        .storage.from(CHAT_EMOJI_BUCKET)
        .createSignedUrls([...paths], ttlSeconds);
      fail(error);
      for (const item of data ?? []) {
        if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
      }
      return out;
    },

    async registerMessage(messageId) {
      const { error } = await db().rpc("chat_op_register_message", { p_message_id: messageId });
      fail(error);
      return { type: "chat_message", id: messageId };
    },

    async messageRefs(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await db().rpc("chat_message_refs", { p_ids: [...ids] });
      fail(error);
      return ((data as Row[] | null) ?? []).map(mapMessageRef);
    },

    async conversationsForItem(type, id) {
      const { data, error } = await db().rpc("chat_conversations_for_item", {
        p_type: type,
        p_id: id,
      });
      fail(error);
      return ((data as Row[] | null) ?? []).map((r) => ({
        channelId: String(r.channel_id),
        workspaceId: String(r.workspace_id),
        channelKind: r.channel_kind === "dm" ? "dm" : "channel",
        channelName: typeof r.channel_name === "string" ? r.channel_name : null,
        channelPrivate: r.channel_private === true,
        relation:
          r.relation === "conversation-of" ? ("conversation-of" as const) : ("mentions" as const),
        since: String(r.since),
        unread: typeof r.unread === "number" && r.unread > 0 ? r.unread : 0,
        archived: r.archived === true,
      }));
    },

    async decisionsForItem(type, id) {
      const { data, error } = await db().rpc("chat_decisions_for_item", {
        p_type: type,
        p_id: id,
      });
      fail(error);
      return mapRows(data, mapItemDecision);
    },

    async madeFrom(messageIds) {
      if (messageIds.length === 0) return [];
      // entity_links' policy shows a link to a message only to its readers.
      const { data, error } = await db()
        .from("entity_links")
        .select("source_type, source_id, target_id, created_at")
        .eq("target_type", "chat_message")
        .in("target_id", [...messageIds])
        .eq("relation_kind", "spawned-from")
        .in("source_type", ["task", "note", "event"])
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      fail(error);
      return ((data as Row[] | null) ?? []).map((r) => ({
        messageId: String(r.target_id),
        type: String(r.source_type),
        id: String(r.source_id),
        createdAt: String(r.created_at),
      }));
    },
  };
}

function mapMessageRef(r: Row): ChatMessageRef {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    channelId: String(r.channel_id),
    channelKind: r.channel_kind === "dm" ? "dm" : "channel",
    channelName: str(r.channel_name),
    channelPrivate: r.channel_private === true,
    parentId: str(r.parent_id),
    authorId: str(r.author_id),
    authorKind: str(r.author_kind),
    authorLabel: str(r.author_label),
    createdAt: String(r.created_at),
    editedAt: str(r.edited_at),
    deleted: r.deleted === true,
    excerpt: str(r.excerpt),
  };
}
