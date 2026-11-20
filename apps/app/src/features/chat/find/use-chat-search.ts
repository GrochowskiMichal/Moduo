// One server search, debounced, newest first, paged by the last row's key
// (CV-19). The last request wins, so a slow answer never replaces a newer
// query's. A failed read is "unavailable", never "no matches" (AC1.10).
// Pages belong to the words and filters that produced them: while a new query
// is on its way the old list stays on screen, but "Show older" is off until the
// new first page lands, so two queries' pages never mix.

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatRuntime, ChatSearchHit, ChatSearchQuery } from "../model";
import { appendPage, hasSearchableWords, pageCursor, SEARCH_PAGE } from "./model";

export type ChatSearchState =
  | { status: "idle" }
  /** Words typed, but none to find (only negated words): nothing is asked. */
  | { status: "nothing" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; hits: ChatSearchHit[]; more: boolean; loadingMore: boolean };

type Inner =
  | Exclude<ChatSearchState, { status: "ready" }>
  | (Extract<ChatSearchState, { status: "ready" }> & { key: string });

/** What a search of negated words only says (it asks the server nothing). */
export const NOTHING_TO_FIND = "Type a word to search for";

/** One search cadence across the app (the palette and the @ pickers use 150 ms). */
export const SEARCH_DEBOUNCE_MS = 150;

/** The identity of a query: its words and filters (the paging key stays out). */
export function searchKey(args: Omit<ChatSearchQuery, "before" | "limit"> | null): string | null {
  if (!args || !hasSearchableWords(args.query)) return null;
  return JSON.stringify({ ...args, query: args.query.trim() });
}

export function useChatSearch(
  chat: ChatRuntime | null,
  args: Omit<ChatSearchQuery, "before" | "limit"> | null,
  limit = SEARCH_PAGE,
): { state: ChatSearchState; loadMore: () => void; retry: () => void } {
  const [inner, setInner] = useState<Inner>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const req = useRef(0);
  const key = searchKey(args);
  const typed = !!args?.query.trim();

  useEffect(() => {
    const id = ++req.current;
    if (!args || !key) {
      setInner({ status: typed && args ? "nothing" : "idle" });
      return;
    }
    // Words to find, but Chat's runtime isn't here yet: it's on its way, never
    // "nothing to find".
    if (!chat) {
      setInner({ status: "loading" });
      return;
    }
    setInner((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    const timer = setTimeout(() => {
      void chat.search({ ...args, limit }).then((res) => {
        if (id !== req.current) return;
        if (res.error) setInner({ status: "error" });
        else
          setInner({
            status: "ready",
            key,
            hits: res.data,
            more: res.data.length >= limit,
            loadingMore: false,
          });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `args`; `attempt` re-runs it
  }, [chat, key, typed, limit, attempt]);

  // A list from an earlier query is shown, but it can't be continued.
  const current = inner.status === "ready" && inner.key === key;

  const loadMore = useCallback(() => {
    if (!chat || !args || inner.status !== "ready" || inner.key !== key) return;
    if (!inner.more || inner.loadingMore) return;
    const id = req.current;
    const pageKey = inner.key;
    const shown = inner.hits;
    setInner({ ...inner, loadingMore: true });
    void chat.search({ ...args, limit, before: pageCursor(shown) }).then((res) => {
      if (id !== req.current) return;
      if (res.error) setInner({ status: "error" });
      else
        setInner({
          status: "ready",
          key: pageKey,
          hits: appendPage(shown, res.data),
          more: res.data.length >= limit,
          loadingMore: false,
        });
    });
  }, [chat, args, key, limit, inner]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let state: ChatSearchState;
  if (inner.status === "ready") {
    const { key: _key, ...rest } = inner;
    state = current ? rest : { ...rest, more: false, loadingMore: false };
  } else {
    state = inner;
  }
  return { state, loadMore, retry };
}
