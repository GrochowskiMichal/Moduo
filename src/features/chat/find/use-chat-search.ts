// One server search, debounced, newest first, paged by the last row's key
// (CV-19). The last request wins, so a slow answer never replaces a newer
// query's. A failed read is "unavailable", never "no matches" (AC1.10).

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatRuntime, ChatSearchHit, ChatSearchQuery } from "../model";
import { appendPage, pageCursor, SEARCH_PAGE } from "./model";

export type ChatSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; hits: ChatSearchHit[]; more: boolean; loadingMore: boolean };

/** One search cadence across the app (the palette and the @ pickers use 150 ms). */
export const SEARCH_DEBOUNCE_MS = 150;

export function useChatSearch(
  chat: ChatRuntime | null,
  args: Omit<ChatSearchQuery, "before" | "limit"> | null,
  limit = SEARCH_PAGE,
): { state: ChatSearchState; loadMore: () => void; retry: () => void } {
  const [state, setState] = useState<ChatSearchState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const req = useRef(0);
  const key = args?.query.trim() ? JSON.stringify(args) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `args`; `attempt` re-runs it
  useEffect(() => {
    const id = ++req.current;
    if (!chat || !args || !key) {
      setState({ status: "idle" });
      return;
    }
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    const timer = setTimeout(() => {
      void chat.search({ ...args, limit }).then((res) => {
        if (id !== req.current) return;
        if (res.error) setState({ status: "error" });
        else
          setState({
            status: "ready",
            hits: res.data,
            more: res.data.length >= limit,
            loadingMore: false,
          });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [chat, key, limit, attempt]);

  const loadMore = useCallback(() => {
    if (!chat || !args || state.status !== "ready" || !state.more || state.loadingMore) return;
    const id = req.current;
    const shown = state.hits;
    setState({ ...state, loadingMore: true });
    void chat.search({ ...args, limit, before: pageCursor(shown) }).then((res) => {
      if (id !== req.current) return;
      if (res.error) setState({ status: "error" });
      else
        setState({
          status: "ready",
          hits: appendPage(shown, res.data),
          more: res.data.length >= limit,
          loadingMore: false,
        });
    });
  }, [chat, args, limit, state]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, loadMore, retry };
}
