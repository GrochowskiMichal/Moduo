/**
 * Chat — module #7 on the Moduo MCP connector (specs/chat.md §Agents).
 *
 * Connector-side mirror of src/features/chat/ops-manifest.ts (keep the
 * descriptions in sync). Chat has its OWN key scope (`scopes->>'chat'`, none by
 * default) and agents only ever see PUBLIC, non-archived channels — DMs and
 * private channels are invisible to every key, whatever its scope.
 *
 * Reads run as service_role (RLS bypassed), so every query filters on
 * ctx.key.workspaceId AND the public-channel predicate, and checks the plan gate
 * (`chat_workspace_enabled`). The one write is `chat_op_agent_post`, which
 * re-checks all of it server-side and attributes the post to the key
 * (author_kind 'api_key', shown with an "App" badge).
 */

import type { ConnectorModule, ToolContext } from "../registry.ts";

type Row = Record<string, any>;

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

function clampLimit(args: Row, fallback: number, max: number): number {
  const v = Number(args?.limit);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

async function rows(
  query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function assertEnabled(ctx: ToolContext): Promise<void> {
  const { data, error } = await ctx.db.rpc("chat_workspace_enabled", {
    p_workspace_id: ctx.key.workspaceId,
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Chat is available on the Duo and Team plans.");
}

/** A public, live channel in this key's workspace — or throws. */
async function publicChannel(ctx: ToolContext, channel: string): Promise<Row> {
  const byName = !/^[0-9a-f-]{36}$/i.test(channel);
  let q = ctx.db
    .from("chat_channels")
    .select("id, name, topic, archived_at, last_message_at, created_at")
    .eq("workspace_id", ctx.key.workspaceId)
    .eq("kind", "channel")
    .eq("is_private", false);
  q = byName ? q.eq("name", channel.replace(/^#/, "").toLowerCase()) : q.eq("id", channel);
  const found = await rows(q.limit(1));
  const c = found[0];
  if (!c) throw new Error(`No public channel "${channel}". Use chat_list_channels to see them.`);
  return c;
}

/** userId → display name, for the authors + mentions in a page of messages. */
async function names(ctx: ToolContext, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const found = await rows(ctx.db.from("profiles").select("id, display_name").in("id", unique));
  return new Map(found.map((p) => [p.id as string, ((p.display_name as string) || "Member").trim()]));
}

const MESSAGE_COLS =
  "id, channel_id, parent_id, author_id, author_kind, author_label, body, reactions, reply_count, pinned_at, edited_at, created_at";

/** Bodies keep <@uuid> tokens; agents get readable names AND the raw token. */
function shapeMessages(list: Row[], who: Map<string, string>): Row[] {
  return list.map((m) => ({
    id: m.id,
    parent_id: m.parent_id,
    author:
      m.author_kind === "api_key"
        ? { app: m.author_label ?? "App" }
        : { user_id: m.author_id, name: who.get(m.author_id) ?? "Former member" },
    text: String(m.body ?? "").replace(/<@([0-9a-f-]{36})>/gi, (_t, id: string) => `@${who.get(id.toLowerCase()) ?? "someone"}`)
      .replace(/<!channel>/g, "@channel")
      .replace(/<moduo:([a-z_]+):([0-9a-f-]{36})\|([^>]*)>/gi, (_t, type: string, id: string, label: string) => `[${type}: ${label}](moduo:${type}:${id})`),
    body: m.body,
    reactions: m.reactions ?? {},
    reply_count: m.reply_count ?? 0,
    pinned: Boolean(m.pinned_at),
    edited: Boolean(m.edited_at),
    created_at: m.created_at,
  }));
}

function mentionIds(list: Row[]): string[] {
  const ids: string[] = [];
  for (const m of list) {
    if (m.author_id) ids.push(m.author_id);
    for (const t of String(m.body ?? "").matchAll(/<@([0-9a-f-]{36})>/gi)) ids.push(t[1].toLowerCase());
  }
  return ids;
}

export const chatConnectorModule: ConnectorModule = {
  module: "chat",
  tools: [
    // ── reads (view scope) — public channels only ────────────────────────────
    {
      name: "chat_list_channels",
      description:
        "The workspace's public chat channels (name, topic, last activity). DMs and private channels are never visible to apps.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        await assertEnabled(ctx);
        const data = await rows(
          ctx.db
            .from("chat_channels")
            .select("id, name, topic, last_message_at, created_at")
            .eq("workspace_id", ctx.key.workspaceId)
            .eq("kind", "channel")
            .eq("is_private", false)
            .is("archived_at", null)
            .order("name"),
        );
        return data.map((c) => ({ id: c.id, name: `#${c.name}`, topic: c.topic || null, last_message_at: c.last_message_at }));
      },
    },
    {
      name: "chat_read",
      description:
        "Recent messages in a public channel (newest last), or one thread's replies when thread_id is given. Mentions are resolved to names; Moduo items appear as [type: label](moduo:type:id).",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel name (e.g. general or #general) or id." },
          thread_id: { type: "string", description: "Optional: a message id — returns that thread's replies." },
          limit: { type: "number", description: "Max messages (default 30, max 100)." },
        },
        required: ["channel"],
      },
      handler: async (args, ctx) => {
        await assertEnabled(ctx);
        const channel = await publicChannel(ctx, str(args, "channel"));
        const thread = str(args, "thread_id", false);
        const limit = clampLimit(args, 30, 100);
        let q = ctx.db
          .from("chat_messages")
          .select(MESSAGE_COLS)
          .eq("workspace_id", ctx.key.workspaceId)
          .eq("channel_id", channel.id)
          .is("deleted_at", null);
        q = thread ? q.eq("parent_id", thread).order("created_at", { ascending: true }) : q.is("parent_id", null).order("created_at", { ascending: false });
        const list = await rows(q.limit(limit));
        if (!thread) list.reverse();
        return {
          channel: { id: channel.id, name: `#${channel.name}`, topic: channel.topic || null, archived: Boolean(channel.archived_at) },
          messages: shapeMessages(list, await names(ctx, mentionIds(list))),
        };
      },
    },
    {
      name: "chat_search",
      description: "Search message text across the workspace's public channels. Newest first.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search text." },
          limit: { type: "number", description: "Max results (default 20, max 50)." },
        },
        required: ["query"],
      },
      handler: async (args, ctx) => {
        await assertEnabled(ctx);
        const channels = await rows(
          ctx.db
            .from("chat_channels")
            .select("id, name")
            .eq("workspace_id", ctx.key.workspaceId)
            .eq("kind", "channel")
            .eq("is_private", false),
        );
        if (channels.length === 0) return [];
        const byId = new Map(channels.map((c) => [c.id as string, c.name as string]));
        const q = str(args, "query").replace(/[\\%_]/g, (c) => `\\${c}`);
        const list = await rows(
          ctx.db
            .from("chat_messages")
            .select(MESSAGE_COLS)
            .eq("workspace_id", ctx.key.workspaceId)
            .in("channel_id", [...byId.keys()])
            .is("deleted_at", null)
            .ilike("body", `%${q}%`)
            .order("created_at", { ascending: false })
            .limit(clampLimit(args, 20, 50)),
        );
        const shaped = shapeMessages(list, await names(ctx, mentionIds(list)));
        return shaped.map((m, i) => ({ ...m, channel: `#${byId.get(list[i].channel_id) ?? "?"}` }));
      },
    },

    // ── write (edit scope) ───────────────────────────────────────────────────
    {
      name: "chat_post",
      description:
        "Post a message to a public channel (or reply in a thread) as this app. It shows with an \"App\" badge and the key's name. Supports **bold**, _italic_, `code`; mention a person with <@USER_ID>.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel name or id." },
          text: { type: "string", description: "The message (max 8,000 characters)." },
          thread_id: { type: "string", description: "Optional: reply in this message's thread." },
        },
        required: ["channel", "text"],
      },
      handler: async (args, ctx) => {
        const channel = await publicChannel(ctx, str(args, "channel"));
        const { data, error } = await ctx.db.rpc("chat_op_agent_post", {
          p_workspace_id: ctx.key.workspaceId,
          p_channel_id: channel.id,
          p_body: str(args, "text"),
          p_parent_id: str(args, "thread_id", false) || null,
        });
        if (error) throw new Error(error.message);
        const m = Array.isArray(data) ? data[0] : data;
        return { id: m?.id, channel: `#${channel.name}`, created_at: m?.created_at };
      },
    },
  ],
};
