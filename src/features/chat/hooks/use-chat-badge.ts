// The Chat nav-tab badge + the app-wide presence holder (specs/chat.md §Badge).
//
// Mounted once in the app chrome, so you appear online while you're anywhere in
// Moduo (not only on the Chat tab), and the tab shows a dot when a DM or a
// mention is waiting. Counts follow the quiet bar — see `badgeCount`.

import { useEffect, useState } from "react";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { acquireChatLink, CHAT_READ_CHANGED_EVENT } from "../realtime";
import { badgeCount, type SidebarEntry } from "../timeline";

const RECOUNT_DEBOUNCE_MS = 400;

export function useChatBadge({
  runtime,
  workspaceId,
  userId,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
}): { enabled: boolean; count: number } {
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    setEnabled(false);
    setCount(0);
    if (!runtime || !workspaceId || !userId) return;
    let cancelled = false;
    let release: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const recount = async () => {
      try {
        const [channels, mine, unread] = await Promise.all([
          runtime.chat.listChannels(workspaceId),
          runtime.chat.listMyMemberships(workspaceId, userId),
          runtime.chat.unreadCounts(workspaceId),
        ]);
        if (cancelled) return;
        const memberOf = new Map(mine.map((m) => [m.channelId, m]));
        const unreadOf = new Map(unread.map((u) => [u.channelId, u]));
        const entries: SidebarEntry[] = channels
          .filter((c) => memberOf.has(c.id))
          .map((c) => ({
            channel: c,
            unread: unreadOf.get(c.id)?.unread ?? 0,
            mentions: unreadOf.get(c.id)?.mentions ?? 0,
            starred: memberOf.get(c.id)?.starred ?? false,
            muted: memberOf.get(c.id)?.notifyLevel === "none",
            isMember: true,
          }));
        setCount(badgeCount(entries, (id) => memberOf.get(id)?.notifyLevel ?? "mentions"));
      } catch {
        // A failed recount keeps the last value — the badge is ambient, never an error.
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void recount(), RECOUNT_DEBOUNCE_MS);
    };

    void (async () => {
      let on = false;
      try {
        on = await runtime.chat.isEnabled(workspaceId);
      } catch {
        on = false; // migration not deployed / offline → no chat chrome, no crash
      }
      if (cancelled || !on) return;
      setEnabled(true);
      const held = acquireChatLink(workspaceId, userId);
      release = held.release;
      unsubscribe = held.link.subscribe((event) => {
        if (event.type === "message" && !event.isInsert) return;
        if (event.type === "message" && event.message.parentId) return;
        schedule();
      });
      void recount();
    })();

    window.addEventListener(CHAT_READ_CHANGED_EVENT, schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(CHAT_READ_CHANGED_EVENT, schedule);
      unsubscribe?.();
      release?.();
    };
  }, [runtime, workspaceId, userId]);

  return { enabled, count };
}
