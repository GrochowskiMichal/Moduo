// React's way into the chat store (CV-3), as `src/lib/sync/react.ts` is for
// Tasks'. A component that shows chat holds the workspace's store while
// mounted (`useChatStore`) and reads its snapshot (`useChatSnapshot`); the
// app chrome holds it for the whole session (the badge), so Chat opens warm.
// Typing and presence are their own small stores.
//
// With the React Compiler on, each hook returns the `useSyncExternalStore`
// snapshot itself (docs/gotchas/ui.md, RF-1).

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  currentChatServerPrefs,
  forgetChatServerPrefs,
  readChatServerPrefs,
  subscribeChatServerPrefs,
} from "@/lib/notices/chat-prefs";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { supabaseClient } from "@/lib/runtime.web";
import { forgetPeopleNow } from "@/lib/statuses/store";
import { postgresChangesSource } from "../realtime";
import { type ChatPresenceSnapshot, chatPresence, forgetChatPresenceStores } from "./presence";
import { PresenceSelfRegistry, windowInput } from "./presence-self";
import "@/lib/statuses/live";
import {
  type ChatSnapshot,
  type ChatStore,
  chatStore,
  EMPTY_CHAT_SNAPSHOT,
  setDefaultChatLive,
} from "./store";
import { type ChatTypingSnapshot, ChatTypingStore } from "./typing";

setDefaultChatLive(() => postgresChangesSource(supabaseClient));

const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_CHAT_SNAPSHOT;
const EMPTY_PRESENCE: ChatPresenceSnapshot = {
  status: "connecting",
  online: new Set(),
  away: new Set(),
  error: null,
};
const emptyPresence = () => EMPTY_PRESENCE;

/** The workspace's chat store, running while this component is mounted. */
export function useChatStore(
  runtime: ModuoRuntime | null,
  userId: string | null,
  workspaceId: string | null,
  enabled = true,
): ChatStore | null {
  const store = useMemo(
    () =>
      enabled && runtime && userId && workspaceId ? chatStore(runtime, userId, workspaceId) : null,
    [enabled, runtime, userId, workspaceId],
  );
  useEffect(() => store?.acquire(), [store]);
  return store;
}

export function useChatSnapshot(store: ChatStore | null): ChatSnapshot {
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.getSnapshot : emptySnapshot,
    store ? store.getSnapshot : emptySnapshot,
  );
}

/** Presence on the workspace's topic, held while mounted and `enabled`. */
export function useChatPresence(
  workspaceId: string | null,
  userId: string | null,
  enabled: boolean,
): ChatPresenceSnapshot {
  const store = useMemo(
    () =>
      enabled && workspaceId && userId
        ? chatPresence(supabaseClient, workspaceId, userId, tabPresenceSelf(userId))
        : null,
    [enabled, workspaceId, userId],
  );
  useEffect(() => store?.acquire(), [store]);
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.getSnapshot : emptyPresence,
    store ? store.getSnapshot : emptyPresence,
  );
}

/** This tab's "me" on presence (CV-17), for the signed-in person only: it
 *  tracks nothing until their own "Show me as online" is read, follows it
 *  (another tab's change too), and is away after 10 minutes without input. */
const presenceSelves = new PresenceSelfRegistry(
  {
    get: (userId) => currentChatServerPrefs(userId)?.showOnline ?? null,
    subscribe: subscribeChatServerPrefs,
    load: (userId) => loadShowOnline(userId, 0),
  },
  { onInput: windowInput },
);

/** Read the switch; a failed read tries again (2 s, 4 s, … at most a minute
 *  apart) while this tab still holds the person and the switch is unknown. */
function loadShowOnline(userId: string, attempt: number): void {
  void readChatServerPrefs().catch(() => {
    setTimeout(
      () => {
        if (presenceSelves.userId === userId && currentChatServerPrefs(userId) === null) {
          loadShowOnline(userId, attempt + 1);
        }
      },
      Math.min(60_000, 2_000 * 2 ** attempt),
    );
  });
}

function tabPresenceSelf(userId: string) {
  watchShowOnlineElsewhere();
  return presenceSelves.for(userId);
}

/** How often the switch is read again, for a change made on another device
 *  or browser (other tabs here hear it at once). */
const SHOW_ONLINE_REREAD_MS = 60_000;
let rereading = false;

/** Another device's change: read the switch again each minute and whenever
 *  the tab comes back into view, while this tab holds a person. */
function watchShowOnlineElsewhere(): void {
  if (rereading || typeof window === "undefined") return;
  rereading = true;
  const reread = () => {
    if (presenceSelves.userId) void readChatServerPrefs().catch(() => undefined);
  };
  window.setInterval(reread, SHOW_ONLINE_REREAD_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reread();
  });
}

/** Sign-out: no presence "me", switch or status copy outlives the person. */
export function forgetChatPresence(): void {
  forgetChatPresenceStores();
  presenceSelves.forget();
  forgetChatServerPrefs();
  forgetPeopleNow();
}

const typingStores = new Map<string, ChatTypingStore>();

/** The person's typing store (one per tab). */
export function chatTypingStore(runtime: ModuoRuntime, userId: string): ChatTypingStore {
  let store = typingStores.get(userId);
  if (!store) {
    store = new ChatTypingStore(supabaseClient, runtime.chat, userId);
    typingStores.set(userId, store);
  }
  return store;
}

const EMPTY_TYPING: ChatTypingSnapshot = { entries: [], error: null };
const emptyTyping = () => EMPTY_TYPING;

export function useChatTypingSnapshot(store: ChatTypingStore | null): ChatTypingSnapshot {
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.getSnapshot : emptyTyping,
    store ? store.getSnapshot : emptyTyping,
  );
}
