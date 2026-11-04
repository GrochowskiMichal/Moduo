// A windowed read of one (view, tab) list (decision 10): keyset pages from
// the engine, more on scroll, and a re-read of what's loaded whenever the
// engine says threads changed. No row cap: the window grows as you scroll.

import { useCallback, useEffect, useRef, useState } from "react";

import type { MailEngine, MailTab, MailThreadRow, MailView } from "@/lib/runtime.types.mail-engine";

export const MAIL_PAGE = 200;

export type ThreadWindow = {
  rows: MailThreadRow[];
  loading: boolean;
  hasMore: boolean;
  loadMore(): void;
};

/** Pinned threads float to the top of their tab; the rest keep engine order. */
export function pinnedFirst(rows: readonly MailThreadRow[]): MailThreadRow[] {
  const pinned = rows.filter((r) => r.pinned);
  if (pinned.length === 0) return rows as MailThreadRow[];
  return [...pinned, ...rows.filter((r) => !r.pinned)];
}

/** Rows at the top of a window whose bodies are raised to Visible priority. */
export const VISIBLE_PREFETCH = 30;

export function useThreadWindow(
  engine: MailEngine | null,
  view: MailView,
  tab: MailTab | null,
  version: number,
): ThreadWindow {
  const [rows, setRows] = useState<MailThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const want = useRef(MAIL_PAGE);
  const key = JSON.stringify([view, tab]);
  const lastKey = useRef(key);
  const seq = useRef(0);

  const read = useCallback(async () => {
    if (!engine) return;
    const my = ++seq.current;
    const out: MailThreadRow[] = [];
    let after = null;
    let more = false;
    do {
      const page = await engine.listThreads({ view, tab, after, limit: MAIL_PAGE });
      out.push(...page.rows);
      after = page.next;
      more = after !== null;
    } while (after && out.length < want.current);
    if (my !== seq.current) return;
    setRows(pinnedFirst(out));
    setHasMore(more);
    setLoading(false);
    // The top of the window is what's on screen: its bodies prefetch next (decision 8).
    void engine
      .setVisible?.(out.slice(0, VISIBLE_PREFETCH).map((r) => r.threadId))
      ?.catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key]);

  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      want.current = MAIL_PAGE;
      setLoading(true);
    }
    void read().catch(() => setLoading(false));
  }, [read, key, version]);

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    want.current += MAIL_PAGE;
    void read().catch(() => {});
  }, [hasMore, read]);

  return { rows, loading, hasMore, loadMore };
}
