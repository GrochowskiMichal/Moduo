import type { ModuleManifest } from "../../lib/module-manifest";

/**
 * Chat module manifest (specs/chat-v2.md §14). Chat has its OWN key scope
 * (`scopes->>'chat'`, none by default). A key acts as its creator, shown as
 * "Alex · via <key name>": it reads public channels, private ones only with the
 * key's "Include private channels I'm in" switch while its creator is a member,
 * and never a direct message. Keep in lockstep with
 * supabase/functions/moduo-mcp/modules/chat.ts.
 *
 * The in-app ops (chat_op_send, chat_op_react, …) resolve the caller from
 * auth.uid() and refuse keys; agents reach the same bodies through the
 * `chat_op_agent_*` ops below, which apply the key's rules first.
 */
export const chatModuleManifest: ModuleManifest = {
  module: "chat",
  summary:
    'Conversations for Duo/Team workspaces. A key reads, searches and posts as its creator ("Alex · via CI key") in public channels, and in private ones its creator is in only when the key allows it; direct messages stay off-limits.',
  permissionKey: "chat",
  activityEntityTypes: ["chat_channel"],
  ops: [
    {
      op: "chat.agent_post",
      rpc: "chat_op_agent_post",
      summary:
        "Post in a conversation, or reply to a message (quoting it, joining its chain), as the key's creator via the key. Needs Chat: Edit; 30 posts a minute per key.",
      args: {
        p_workspace_id: "workspace uuid",
        p_channel_id: "a chat_channels uuid the key can read (null when replying)",
        p_body: "the message (Markdown; <@USER_ID> mentions; <!channel>; max 8,000 chars)",
        p_parent_id: "optional: the message this answers",
      },
    },
    {
      op: "chat.agent_react",
      rpc: "chat_op_agent_react",
      summary: "Add or take back the key creator's reaction on a message. Needs Chat: Edit.",
      args: {
        p_workspace_id: "workspace uuid (the key's)",
        p_message_id: "chat_messages uuid",
        p_key: "emoji or :name:",
        p_on: "boolean",
      },
    },
    {
      op: "chat.agent_mark_decision",
      rpc: "chat_op_agent_mark_decision",
      summary: "Mark or unmark a message as a decision. Needs Chat: Edit.",
      args: {
        p_workspace_id: "workspace uuid (the key's)",
        p_message_id: "chat_messages uuid",
        p_on: "boolean",
      },
    },
    {
      op: "chat.agent_wrap_up",
      rpc: "chat_op_agent_wrap_up",
      summary: "Wrap up a reply chain with the reply that settled it. Needs Chat: Edit.",
      args: {
        p_workspace_id: "workspace uuid (the key's)",
        p_root_id: "the chain's first message",
        p_settled_id: "the settling reply",
        p_mark_decision: "also mark it as a decision",
      },
    },
    {
      op: "chat.agent_create_channel",
      rpc: "chat_op_agent_create_channel",
      summary:
        "Create a channel as the key's creator; private only with the key's private switch on. Needs Chat: Edit.",
      args: {
        p_workspace_id: "workspace uuid",
        p_name: "the name as it should read",
        p_topic: "optional topic",
        p_is_private: "boolean",
      },
    },
  ],
  resources: [
    {
      name: "chat.conversations",
      summary: "The conversations the key can read (chat_agent_conversations).",
    },
    {
      name: "chat.messages",
      summary:
        "A conversation's messages or one reply chain, in keyset pages (chat_agent_messages).",
    },
    {
      name: "chat.search",
      summary: "Search the conversations the key can read (chat_agent_search).",
    },
    {
      name: "chat.addressed",
      summary:
        "What's waiting for the key's creator in Catch up, never direct messages (chat_agent_addressed).",
    },
  ],
};
