// The Chat nav-tab badge + the app-wide presence holder (specs/chat.md §Badge).
//
// Mounted once in the app chrome, so you appear online while you're anywhere in
// Moduo (not only on the Chat tab), and the tab shows a dot when a DM or a
// mention is waiting. It holds the workspace's chat store for the session
// (CV-3: Chat opens warm) and reads the store's badge slice, so a new message
// costs no request. Counts follow the quiet bar — see `badgeCount`; the dock,
// tab and switcher counts are CV-6b's.

import { useMemo } from "react";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { useChatPresence, useChatSnapshot, useChatStore } from "../store/react";
import { badgeCount, type SidebarEntry } from "../timeline";

export function useChatBadge({
  runtime,
  workspaceId,
  userId,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
}): { enabled: boolean; count: number } {
  const store = useChatStore(runtime, userId, workspaceId);
  const snapshot = useChatSnapshot(store);
  // A workspace without chat (or not loaded yet, or offline with no copy) shows no chat chrome.
  const enabled = snapshot.status === "ready";
  useChatPresence(workspaceId, userId, enabled);

  const count = useMemo(() => {
    if (!enabled) return 0;
    const entries: SidebarEntry[] = [];
    for (const channel of Object.values(snapshot.channels)) {
      const member = snapshot.mine[channel.id];
      if (!member) continue;
      entries.push({
        channel,
        unread: snapshot.unread[channel.id]?.unread ?? 0,
        mentions: snapshot.unread[channel.id]?.mentions ?? 0,
        starred: member.starred,
        muted: member.notifyLevel === "none",
        isMember: true,
      });
    }
    return badgeCount(entries, (id) => snapshot.mine[id]?.notifyLevel ?? "mentions");
  }, [enabled, snapshot.channels, snapshot.mine, snapshot.unread]);

  return { enabled, count };
}
