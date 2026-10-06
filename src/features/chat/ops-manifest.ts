import type { ModuleManifest } from "../../lib/module-manifest";

/**
 * Chat module manifest (specs/chat.md §Agents). Chat has its OWN key scope
 * (`scopes->>'chat'`, none by default). Apps only ever see PUBLIC, non-archived
 * channels — DMs and private channels are invisible to every API key. An app's
 * post is attributed to the key (author_kind 'api_key', "App" badge), never to a
 * person. Keep in lockstep with supabase/functions/moduo-mcp/modules/chat.ts.
 *
 * The in-app ops (chat_op_send / _react / _pin / …) resolve the caller from
 * auth.uid() and are deliberately NOT agent-callable: only `chat.agent_post`.
 */
export const chatModuleManifest: ModuleManifest = {
  module: "chat",
  summary:
    "Real-time conversations for Duo/Team workspaces. Apps can read and search public channels and post into them (shown as an App); DMs and private channels stay off-limits.",
  permissionKey: "chat",
  activityEntityTypes: ["chat_channel"],
  ops: [
    {
      op: "chat.agent_post",
      rpc: "chat_op_agent_post",
      summary:
        "Post a message to a public channel (or reply in a thread) as the API key's app. Needs Chat: Edit on the key.",
      args: {
        p_workspace_id: "workspace uuid",
        p_channel_id: "a public chat_channels uuid",
        p_body: "the message (markup; <@USER_ID> mentions; max 8,000 chars)",
        p_parent_id: "optional thread root message uuid",
      },
    },
  ],
  resources: [
    { name: "chat.channels", summary: "Public channels: name, topic, last activity." },
    {
      name: "chat.messages",
      summary: "A public channel's recent messages or one thread's replies.",
    },
    { name: "chat.search", summary: "Search message text across public channels." },
  ],
};
