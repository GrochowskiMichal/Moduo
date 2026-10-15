// The Chat nav-tab count + the app-wide presence holder.
//
// Mounted once in the app chrome, so you appear online while you're anywhere in
// Moduo (not only on the Chat tab). It holds the workspace's chat store for the
// session (CV-3: Chat opens warm) and reads the store's badge slice, so a new
// message costs no request. The count (CV-6b, spec §11 "Count") is the open
// workspace's open Catch up items: an "Every message" conversation is one item,
// a conversation on Nothing never counts. It also feeds the switcher and the
// dock badge (`lib/notices/chat-counts`) and answers which conversations this
// workspace holds (a notice's landing, its sound).

import { useCallback, useEffect, useMemo } from "react";
import { setLiveChatCount } from "@/lib/notices/chat-counts";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { useChatPresence, useChatSnapshot, useChatStore } from "../store/react";
import type { ChatSnapshot } from "../store/store";

/** Open Catch up items across the conversations you're in (none on Nothing). */
export function catchupCount(snapshot: Pick<ChatSnapshot, "mine" | "unread">): number {
  let n = 0;
  for (const [channelId, counts] of Object.entries(snapshot.unread)) {
    const member = snapshot.mine[channelId];
    if (!member || member.notifyLevel === "none") continue;
    if (counts.catchup > 0) n += counts.catchup;
  }
  return n;
}

export type ChatBadge = {
  enabled: boolean;
  count: number;
  /** The conversation's kind when this workspace's store holds it, else null. */
  conversationKind: (channelId: string) => string | null;
};

export function useChatBadge({
  runtime,
  workspaceId,
  userId,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
}): ChatBadge {
  const store = useChatStore(runtime, userId, workspaceId);
  const snapshot = useChatSnapshot(store);
  // A workspace without chat (or not loaded yet, or offline with no copy) shows no chat chrome.
  const enabled = snapshot.status === "ready";
  useChatPresence(workspaceId, userId, enabled);

  const { mine, unread } = snapshot;
  const count = useMemo(
    () => (enabled ? catchupCount({ mine, unread }) : 0),
    [enabled, mine, unread],
  );

  useEffect(() => {
    setLiveChatCount(enabled ? workspaceId : null, count);
  }, [enabled, workspaceId, count]);

  const channels = snapshot.channels;
  const conversationKind = useCallback(
    (channelId: string) => (enabled ? (channels[channelId]?.kind ?? null) : null),
    [enabled, channels],
  );

  return { enabled, count, conversationKind };
}
