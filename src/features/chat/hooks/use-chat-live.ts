// Presence + typing for v1's screens, as React state (CV-3: read from the
// store's presence and typing stores through the `ChatLink` the module hook
// hands the page; v1's screens go with CV-8a).
//
// useSyncExternalStore requires getSnapshot to return the SAME value until the
// store changes. The fallbacks below are module-level constants on purpose: an
// inline `() => []` returns a new array on every read, which React treats as a
// change → re-render → read → … (React error #185, "Maximum update depth
// exceeded"). That shipped once, while the link was still null on page load.

import { useSyncExternalStore } from "react";
import type { TypingEntry } from "../store/typing";

export type { TypingEntry };

/** What v1's page reads presence and typing through (and tells "I'm typing" to). */
export type ChatLink = {
  sendTyping(channelId: string, parentId: string | null, stop?: boolean): void;
  watchTyping(channelId: string): () => void;
  subscribePresence(fn: () => void): () => void;
  getOnline(): ReadonlySet<string>;
  subscribeTyping(fn: () => void): () => void;
  getTyping(): TypingEntry[];
};

const EMPTY_ONLINE: ReadonlySet<string> = new Set();
const EMPTY_TYPING: TypingEntry[] = [];
const noopSubscribe = () => () => {};
const getEmptyOnline = () => EMPTY_ONLINE;
const getEmptyTyping = () => EMPTY_TYPING;

export function useChatOnline(link: ChatLink | null): ReadonlySet<string> {
  return useSyncExternalStore(
    link?.subscribePresence ?? noopSubscribe,
    link?.getOnline ?? getEmptyOnline,
    getEmptyOnline,
  );
}

export function useChatTyping(link: ChatLink | null): TypingEntry[] {
  return useSyncExternalStore(
    link?.subscribeTyping ?? noopSubscribe,
    link?.getTyping ?? getEmptyTyping,
    getEmptyTyping,
  );
}
