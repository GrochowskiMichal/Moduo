/**
 * Chat — module #7 on the Moduo MCP connector (specs/chat-v2.md §14).
 *
 * Connector-side mirror of src/features/chat/ops-manifest.ts (keep the
 * descriptions in sync). Chat has its OWN key scope (`scopes->>'chat'`, none by
 * default). A key acts as its creator — "Alex · via CI key" — inside the key's
 * rules, which the database applies (chat__key_actor / chat__key_reads_channel):
 * channels only, public ones, private ones only with the key's "Include private
 * channels I'm in" switch while its creator is a member; direct messages never.
 *
 * Every tool is one RPC; none reads a chat table itself (the service role
 * bypasses RLS, so a hand-filtered query here would be the only guard).
 */

import type { ConnectorModule, ToolContext } from "../registry.ts";

type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

/** A message or chain id: canonical uuids only (the server reads more spellings). */
export function messageId(args: Row, name: string, required = true): string {
  const v = str(args, name, required);
  if (v === "") return "";
  if (!UUID.test(v)) throw new Error(`${name} must be a message id.`);
  return v.toLowerCase();
}

export function clampLimit(args: Row, fallback: number, max: number): number {
  const v = Number(args?.limit);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

async function call<T = Row[]>(ctx: ToolContext, fn: string, params: Row): Promise<T> {
  const { data, error } = await ctx.db.rpc(fn, params);
  if (error) throw new Error(error.message);
  return data as T;
}

function one(data: unknown): Row {
  return (Array.isArray(data) ? data[0] : data) as Row;
}

/** "Alex" or "Alex · via CI key". */
export function byline(name: string, via: string | null | undefined): string {
  return via ? `${name} · via ${via}` : name;
}

/**
 * Bodies are stored in Markdown with Moduo links (`[@Alex](moduo://person/<id>)`).
 * Agents get the text as stored, plus a readable line without the link targets.
 */
export function readable(body: string): string {
  return String(body ?? "").replace(/\[([^\]]*)\]\(moduo:\/\/[a-z_]+\/[0-9a-f-]{36}\)/gi, "$1");
}

/**
 * A conversation by id, or by its name as typed ("#Release Train" or
 * "Release Train"): names are matched exactly, never lower-cased.
 */
export async function conversation(ctx: ToolContext, channel: string): Promise<Row> {
  const list = await call<Row[]>(ctx, "chat_agent_conversations", { p_workspace_id: ctx.key.workspaceId });
  const wanted = channel.trim();
  const byId = UUID.test(wanted) ? list.find((c) => c.id === wanted.toLowerCase()) : undefined;
  const found = byId ?? list.find((c) => c.name === wanted || `#${c.name}` === wanted);
  if (!found) throw new Error(`No conversation "${channel}" this key can read. Use chat_list_channels to see them.`);
  return found;
}

/** A conversation's id: as given when it's an id (the RPC applies the key's rules), else by name. */
export async function conversationId(ctx: ToolContext, channel: string): Promise<string> {
  const wanted = channel.trim();
  return UUID.test(wanted) ? wanted.toLowerCase() : (await conversation(ctx, wanted)).id;
}

function shapeMessage(m: Row): Row {
  return {
    id: m.id,
    chain_root_id: m.parent_id ?? null,
    reply_to_id: m.reply_to_id ?? null,
    author: { user_id: m.author_id ?? null, name: byline(m.author_name, m.via) },
    text: readable(m.body),
    body: m.body,
    reactions: m.reactions ?? {},
    reply_count: m.reply_count ?? 0,
    decision: Boolean(m.decision),
    wrapped_up: Boolean(m.wrapped),
    settled_by: m.settled_id ?? null,
    edited: Boolean(m.edited),
    created_at: m.created_at,
  };
}

const POST_HINT =
  "Write Markdown (**bold**, _italic_, `code`); mention a person with <@USER_ID> and everyone with <!channel> (plain text unless the key's creator may mention everyone).";

export const chatConnectorModule: ConnectorModule = {
  module: "chat",
  tools: [
    // ── reads (View) ───────────────────────────────────────────────────────
    {
      name: "chat_list_channels",
      description:
        "List the conversations this key can read: public channels, and private channels its creator is in when the key's \"Include private channels I'm in\" is on. Direct messages are never visible to a key.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const list = await call<Row[]>(ctx, "chat_agent_conversations", { p_workspace_id: ctx.key.workspaceId });
        return list.map((c) => ({
          id: c.id,
          name: c.name,
          topic: c.topic ?? null,
          private: Boolean(c.is_private),
          announcement: Boolean(c.announcement),
          archived: Boolean(c.archived),
          last_message_at: c.last_message_at,
        }));
      },
    },
    {
      name: "chat_read",
      description:
        "Read a conversation (its messages, oldest first) or one reply chain when chain_id is given (the chain's first message and its replies). Pages back with before (a message id from the previous page).",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Conversation name as shown (e.g. Release Train) or id." },
          chain_id: { type: "string", description: "Optional: the first message of a reply chain." },
          before: { type: "string", description: "Optional: read the messages before this message id." },
          limit: { type: "number", description: "Max messages (default 30, max 100)." },
        },
        required: ["channel"],
      },
      handler: async (args, ctx) => {
        const channel = await conversation(ctx, str(args, "channel"));
        // thread_id: v1's name for it, still read from agents set up then.
        const chain = messageId(args, "chain_id", false) || messageId(args, "thread_id", false) || null;
        const limit = clampLimit(args, 30, 100);
        const before = messageId(args, "before", false);
        const list = await call<Row[]>(ctx, "chat_agent_messages", {
          p_channel_id: channel.id,
          p_root_id: chain,
          p_before: null,
          p_before_id: before || null,
          p_limit: limit,
        });
        const messages = [...list].reverse().map(shapeMessage);
        return {
          channel: { id: channel.id, name: channel.name, topic: channel.topic ?? null, archived: Boolean(channel.archived) },
          messages,
          more: list.length === limit ? { before: list[list.length - 1]?.id } : null,
        };
      },
    },
    {
      name: "chat_search",
      description:
        "Search messages in the conversations this key can read, newest first. Matches whole words and their beginnings, Polish without diacritics too.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search text." },
          channel: { type: "string", description: "Optional: only this conversation (name or id)." },
          limit: { type: "number", description: "Max results (default 20, max 50)." },
        },
        required: ["query"],
      },
      handler: async (args, ctx) => {
        const only = str(args, "channel", false);
        const channelId = only ? await conversationId(ctx, only) : null;
        const list = await call<Row[]>(ctx, "chat_agent_search", {
          p_workspace_id: ctx.key.workspaceId,
          p_query: str(args, "query"),
          p_channel_id: channelId,
          p_limit: clampLimit(args, 20, 50),
        });
        return list.map((h) => ({
          id: h.message_id,
          channel: { id: h.channel_id, name: h.channel_name },
          chain_root_id: h.parent_id ?? null,
          author: { user_id: h.author_id ?? null, name: byline(h.author_name, h.via) },
          // The match is marked with U+E000 … U+E001; agents get **…**.
          snippet: String(h.snippet ?? "").replace(/\uE000/g, "**").replace(/\uE001/g, "**"),
          created_at: h.created_at,
        }));
      },
    },
    {
      name: "chat_addressed_to_me",
      description:
        "What's waiting for the key's creator in Catch up: messages that mention them, their teams or everyone, replies in chains they're in, and announcements, in conversations this key can read (never direct messages). Newest first.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "Max items (default 30, max 100)." } },
      },
      handler: async (args, ctx) => {
        const list = await call<Row[]>(ctx, "chat_agent_addressed", {
          p_workspace_id: ctx.key.workspaceId,
          p_limit: clampLimit(args, 30, 100),
        });
        return list.map((i) => ({
          reason: i.reason,
          channel: { id: i.channel_id, name: i.channel_name },
          message_id: i.message_id,
          chain_root_id: i.chain_root_id ?? null,
          author: { user_id: i.author_id ?? null, name: byline(i.author_name, i.via) },
          text: readable(i.body),
          created_at: i.created_at,
        }));
      },
    },

    // ── writes (Edit) ──────────────────────────────────────────────────────
    {
      name: "chat_post",
      description: `Post a message in a conversation as the key's creator ("Alex · via <key name>"). ${POST_HINT} 30 posts a minute per key.`,
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Conversation name as shown or id." },
          text: { type: "string", description: "The message (max 8,000 characters)." },
          thread_id: { type: "string", description: "Deprecated: use chat_reply. A message to answer." },
        },
        required: ["channel", "text"],
      },
      handler: async (args, ctx) => {
        const channelId = await conversationId(ctx, str(args, "channel"));
        const m = one(
          await call(ctx, "chat_op_agent_post", {
            p_workspace_id: ctx.key.workspaceId,
            p_channel_id: channelId,
            p_body: str(args, "text"),
            p_parent_id: messageId(args, "thread_id", false) || null,
          }),
        );
        return { id: m?.id, channel_id: m?.channel_id, chain_root_id: m?.parent_id ?? null, created_at: m?.created_at };
      },
    },
    {
      name: "chat_reply",
      description: `Reply to a message, quoting it: the reply joins that message's chain. ${POST_HINT}`,
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "The message to answer." },
          text: { type: "string", description: "The reply (max 8,000 characters)." },
        },
        required: ["message_id", "text"],
      },
      handler: async (args, ctx) => {
        const m = one(
          await call(ctx, "chat_op_agent_post", {
            p_workspace_id: ctx.key.workspaceId,
            p_channel_id: null,
            p_body: str(args, "text"),
            p_parent_id: messageId(args, "message_id"),
          }),
        );
        return { id: m?.id, chain_root_id: m?.parent_id ?? null, reply_to_id: m?.reply_to_id ?? null, created_at: m?.created_at };
      },
    },
    {
      name: "chat_react",
      description: "Add (or, with on=false, take back) the key creator's reaction on a message: an emoji like 👍, or a workspace emoji as :name:.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "The message." },
          emoji: { type: "string", description: "The emoji, e.g. 👍 or :shipit:." },
          on: { type: "boolean", description: "false takes the reaction back (default true)." },
        },
        required: ["message_id", "emoji"],
      },
      handler: async (args, ctx) => {
        const m = one(
          await call(ctx, "chat_op_agent_react", {
            p_workspace_id: ctx.key.workspaceId,
            p_message_id: messageId(args, "message_id"),
            p_key: str(args, "emoji"),
            p_on: args?.on !== false,
          }),
        );
        return { id: m?.id, reactions: m?.reactions ?? {} };
      },
    },
    {
      name: "chat_mark_decision",
      description:
        "Mark a message as a decision (or unmark it with on=false). Decisions show in the conversation's Details and on the items it's linked to.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "The message." },
          on: { type: "boolean", description: "false unmarks it (default true)." },
        },
        required: ["message_id"],
      },
      handler: async (args, ctx) => {
        const m = one(
          await call(ctx, "chat_op_agent_mark_decision", {
            p_workspace_id: ctx.key.workspaceId,
            p_message_id: messageId(args, "message_id"),
            p_on: args?.on !== false,
          }),
        );
        return { id: m?.id, decision: Boolean(m?.decision_at) };
      },
    },
    {
      name: "chat_wrap_up",
      description:
        "Wrap up a reply chain with the reply that settled it (optionally marking that reply as a decision). Whoever started the chain, the channel's managers and admins can.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          chain_id: { type: "string", description: "The chain's first message." },
          settled_by: { type: "string", description: "The reply that settled it." },
          mark_decision: { type: "boolean", description: "Also mark that reply as a decision." },
        },
        required: ["chain_id", "settled_by"],
      },
      handler: async (args, ctx) => {
        const m = one(
          await call(ctx, "chat_op_agent_wrap_up", {
            p_workspace_id: ctx.key.workspaceId,
            p_root_id: messageId(args, "chain_id"),
            p_settled_id: messageId(args, "settled_by"),
            p_mark_decision: args?.mark_decision === true,
          }),
        );
        return { id: m?.id, wrapped_up: Boolean(m?.wrapped_at), settled_by: m?.settled_id ?? null };
      },
    },
    {
      name: "chat_create_channel",
      description:
        "Create a channel as the key's creator (their role decides whether they may). Private only when the key's \"Include private channels I'm in\" is on.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The channel's name, as it should read." },
          topic: { type: "string", description: "Optional topic." },
          private: { type: "boolean", description: "Make it private (default false)." },
        },
        required: ["name"],
      },
      handler: async (args, ctx) => {
        const c = one(
          await call(ctx, "chat_op_agent_create_channel", {
            p_workspace_id: ctx.key.workspaceId,
            p_name: str(args, "name"),
            p_topic: str(args, "topic", false),
            p_is_private: args?.private === true,
          }),
        );
        return { id: c?.id, name: c?.name, private: Boolean(c?.is_private) };
      },
    },
  ],
};
