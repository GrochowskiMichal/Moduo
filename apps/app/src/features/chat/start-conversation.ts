// "Start a conversation for X" (chat-v2 §8, CH56; CV-13), from a project's ⋯
// and a client's hub: the server names the channel after X (" 2" on a clash),
// makes it public when everyone who uses chat can see X and private with
// exactly the people who can otherwise, and links it. The app then opens it
// and tells the item's lines to read again. A refusal shows as a toast.

import { useContext } from "react";
import { toast } from "sonner";

import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { useAuth } from "@/providers/auth-provider";

import { WorkspaceContext } from "../workspaces/workspace-context";
import { CONVERSATION_STARTED_EVENT } from "./mentioned-in";
import type { ChatStartableTarget } from "./model";

export type StartableType = ChatStartableTarget;

export async function startConversationFor(
  runtime: ModuoRuntime | null,
  workspaceId: string,
  type: StartableType,
  id: string,
): Promise<void> {
  const chat = runtime?.chat;
  if (!chat) return;
  try {
    const channel = await chat.startConversation({ workspaceId, type, id });
    window.dispatchEvent(new CustomEvent(CONVERSATION_STARTED_EVENT, { detail: { type, id } }));
    window.dispatchEvent(
      new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: "chat_channel", id: channel.id } }),
    );
  } catch (e) {
    toast.error(e instanceof Error && e.message ? e.message : "Couldn't start the conversation.");
  }
}

/** "Start a conversation" for an item in the open workspace, or null when chat is off for you. */
export function useStartConversation(): ((type: StartableType, id: string) => void) | null {
  const { runtime } = useAuth();
  const workspace = useContext(WorkspaceContext);
  const workspaceId = workspace?.selectedWorkspaceId ?? null;
  if (!runtime?.chat || !workspaceId || !workspace || workspace.modulePermissions.chat === "none") {
    return null;
  }
  return (type, id) => void startConversationFor(runtime, workspaceId, type, id);
}
