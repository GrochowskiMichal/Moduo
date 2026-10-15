// The Chat tab: its count, whether it shows, and the app-wide presence holder.
//
// Mounted once in the app chrome, so you appear online while you're anywhere in
// Moduo (not only on the Chat tab). It holds the workspace's chat store for the
// session (CV-3: Chat opens warm) and reads the store's badge slice, so a new
// message costs no request. The count (CV-6b, spec §11 "Count") is the open
// workspace's open Catch up items: an "Every message" conversation is one item,
// a conversation on Nothing never counts. It also feeds the switcher and the
// dock badge (`lib/notices/chat-counts`) and answers which conversations this
// workspace holds (a notice's landing, its sound). CV-8a moved it here from
// v1's `hooks/use-chat-badge.ts`.

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

/** Any message was ever written in a conversation this person can read. */
export function hasChatHistory(snapshot: Pick<ChatSnapshot, "channels">): boolean {
  return Object.values(snapshot.channels).some((c) => c.lastMessageAt !== null);
}

/**
 * Whether the Chat tab shows (spec §1): with two or more people in the
 * workspace; a one-person workspace keeps it only while chat history exists.
 * `memberCount` 0 means the member list hasn't loaded: keep the tab (no flicker).
 */
export function chatTabShows(memberCount: number, snapshot: ChatSnapshot): boolean {
  if (memberCount === 0 || memberCount >= 2) return true;
  if (snapshot.status !== "ready") return true;
  return hasChatHistory(snapshot);
}

export type ChatTab = {
  /** The store has loaded (a paused plan included): chat chrome may show. */
  enabled: boolean;
  count: number;
  /** The tab shows (two or more people, or history in a one-person workspace). */
  shows: boolean;
  /** The conversation's kind when this workspace's store holds it, else null. */
  conversationKind: (channelId: string) => string | null;
};

export function useChatTab({
  runtime,
  workspaceId,
  userId,
  memberCount,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  /** People in the workspace (0 while the list loads). */
  memberCount: number;
}): ChatTab {
  const store = useChatStore(runtime, userId, workspaceId);
  const snapshot = useChatSnapshot(store);
  const enabled = snapshot.status === "ready";
  // The workspace presence topic still asks for the plan (CV-17 drops that).
  useChatPresence(workspaceId, userId, enabled && !snapshot.paused);

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

  return { enabled, count, shows: chatTabShows(memberCount, snapshot), conversationKind };
}
