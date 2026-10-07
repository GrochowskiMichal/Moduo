// Pure helpers for the API-keys settings section (DF-19d). Kept free of UI
// imports so the scope logic is unit-tested without pulling in components.

import type { WorkspaceApiKey } from "../../lib/runtime";

export type KeyScope = "view" | "edit";

/**
 * Which scope a key grants. Keys carry a per-module scope map; today the UI
 * manages the `tasks` scope (the shared-lane default). Per-module scope breadth
 * is coupled to server-side enforcement and lands with MCP-1.
 */
export function keyScope(key: WorkspaceApiKey): KeyScope {
  return key.scopes?.tasks === "edit" ? "edit" : "view";
}

export type ChatKeyScope = "none" | "view" | "edit";

/**
 * A key's chat access (specs/chat.md §Agents). Chat has its own lane and is
 * off unless granted — and even then apps only see public channels.
 */
export function chatKeyScope(key: WorkspaceApiKey): ChatKeyScope {
  const raw = key.scopes?.chat;
  return raw === "edit" || raw === "view" ? raw : "none";
}

export const CHAT_SCOPE_LABEL: Record<ChatKeyScope, string> = {
  none: "No chat",
  view: "Read public channels",
  edit: "Read + post",
};
