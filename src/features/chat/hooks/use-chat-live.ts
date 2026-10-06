// Presence + typing from the shared chat link, as React state.
//
// useSyncExternalStore requires getSnapshot to return the SAME value until the
// store changes. The fallbacks below are module-level constants on purpose: an
// inline `() => []` returns a new array on every read, which React treats as a
// change → re-render → read → … (React error #185, "Maximum update depth
// exceeded"). That shipped once, while the link was still null on page load.

import { useSyncExternalStore } from "react";
import type { ChatLink, TypingEntry } from "../realtime";

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
