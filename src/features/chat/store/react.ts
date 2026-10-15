// React's way into the chat store (CV-3), as `src/lib/sync/react.ts` is for
// Tasks'. A component that shows chat holds the workspace's store while
// mounted (`useChatStore`) and reads its snapshot (`useChatSnapshot`); the
// app chrome holds it for the whole session (the badge), so Chat opens warm.
// Typing and presence are their own small stores.
//
// With the React Compiler on, each hook returns the `useSyncExternalStore`
// snapshot itself (docs/gotchas/ui.md, RF-1).

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { supabaseClient } from "@/lib/runtime.web";
import { postgresChangesSource } from "../realtime";
import { type ChatPresenceSnapshot, chatPresence } from "./presence";
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
      enabled && workspaceId && userId ? chatPresence(supabaseClient, workspaceId, userId) : null,
    [enabled, workspaceId, userId],
  );
  useEffect(() => store?.acquire(), [store]);
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.getSnapshot : emptyPresence,
    store ? store.getSnapshot : emptyPresence,
  );
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
