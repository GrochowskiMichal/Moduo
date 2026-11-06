// A windowed read of one (view, tab) list (decision 10): keyset pages from
// the engine, more on scroll, and a re-read of what's loaded whenever the
// engine says threads changed. No row cap: the window grows as you scroll.

import { useCallback, useEffect, useRef, useState } from "react";

import type { MailEngine, MailTab, MailThreadRow, MailView } from "@/lib/runtime.types.mail-engine";

import { groupBySender, type SenderGroup } from "../views/newsletter-groups";

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

/** One virtual-list item (specs/mail-v3.md §3, AC14): group headers are items of
 *  their own, never sticky; a newsletter sender folds its threads into one row. */
export type MailListItem =
  | { kind: "header"; key: string; label: string }
  | { kind: "row"; key: string; row: MailThreadRow }
  | { kind: "sender"; key: string; group: SenderGroup; open: boolean; leadId: string }
  | { kind: "more"; key: string; count: number };

/** "Came back while you were away" shows this many, then "Show {n} more". */
export const AWAY_GROUP_MAX = 20;

export const MAIL_GROUP_LABELS = {
  away: "Came back while you were away",
  pinned: "Pinned",
  rest: "Everything else",
} as const;

export type MailGroupOptions = {
  /** Threads that came back while the app was closed (the store's `awayReturned`). */
  awayReturned?: readonly string[];
  /** The Personal tab of the Inbox: the only place the away group shows. */
  personal?: boolean;
  /** The Newsletters tab: one row per sender. */
  newsletters?: boolean;
  /** Senders (lowercased address) expanded in the Newsletters tab. */
  openSenders?: ReadonlySet<string>;
  /** "Show {n} more" was pressed on the away group. */
  awayShowAll?: boolean;
};

const rowItem = (row: MailThreadRow): MailListItem => ({ kind: "row", key: row.threadId, row });

function senderItems(rows: readonly MailThreadRow[], open: ReadonlySet<string>): MailListItem[] {
  const byId = new Map(rows.map((r) => [r.threadId, r] as const));
  const out: MailListItem[] = [];
  const grouped = new Set<string>();
  for (const group of groupBySender(rows)) {
    const members = group.threadIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
    members.forEach((r) => grouped.add(r.threadId));
    if (members.length === 1) {
      out.push(rowItem(members[0]!));
      continue;
    }
    const isOpen = open.has(group.email);
    const leadId = members[0]!.threadId;
    out.push({ kind: "sender", key: `sender:${group.email}`, group, open: isOpen, leadId });
    if (isOpen) out.push(...members.map(rowItem));
  }
  // Rows the grouping can't place (no sender) stay as rows.
  out.push(...rows.filter((r) => !grouped.has(r.threadId)).map(rowItem));
  return out;
}

function awayItems(away: readonly MailThreadRow[], showAll: boolean): MailListItem[] {
  if (away.length === 0) return [];
  const shown = showAll ? away : away.slice(0, AWAY_GROUP_MAX);
  const out: MailListItem[] = [
    { kind: "header", key: "group:away", label: MAIL_GROUP_LABELS.away },
    ...shown.map(rowItem),
  ];
  if (shown.length < away.length)
    out.push({ kind: "more", key: "group:away-more", count: away.length - shown.length });
  return out;
}

/** The list window as items: the away, pinned and everything-else groups (headers
 *  only when there is more than one group), or the Newsletters tab per sender. */
export function groupWindow(
  rows: readonly MailThreadRow[],
  opts: MailGroupOptions = {},
): MailListItem[] {
  if (opts.newsletters) return senderItems(rows, opts.openSenders ?? new Set());
  const awaySet = new Set(opts.personal ? (opts.awayReturned ?? []) : []);
  const away = rows.filter((r) => awaySet.has(r.threadId));
  const rest = awaySet.size > 0 ? rows.filter((r) => !awaySet.has(r.threadId)) : rows;
  const pinned = rest.filter((r) => r.pinned);
  const others = pinned.length > 0 ? rest.filter((r) => !r.pinned) : rest;
  const out = awayItems(away, opts.awayShowAll ?? false);
  if (pinned.length > 0) {
    out.push({ kind: "header", key: "group:pinned", label: MAIL_GROUP_LABELS.pinned });
    out.push(...pinned.map(rowItem));
  }
  if (others.length > 0 && out.length > 0)
    out.push({ kind: "header", key: "group:rest", label: MAIL_GROUP_LABELS.rest });
  out.push(...others.map(rowItem));
  return out;
}

/** The ids j/k walk: every row, and a folded sender's newest thread. */
export function navigableIds(items: readonly MailListItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.kind === "row") out.push(item.row.threadId);
    else if (item.kind === "sender" && !item.open) out.push(item.leadId);
  }
  return out;
}

/** Rows at the top of a window whose bodies are raised to Visible priority. */
export const VISIBLE_PREFETCH = 30;

export function useThreadWindow(
  engine: MailEngine | null,
  view: MailView,
  tab: MailTab | null,
  version: number,
  /** Scopes the window to one account (the rail's account row, spec §1); the
   *  engine's lists span every account, so rows are filtered as pages arrive. */
  accountId: string | null = null,
): ThreadWindow {
  const [rows, setRows] = useState<MailThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const want = useRef(MAIL_PAGE);
  const key = JSON.stringify([view, tab, accountId]);
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
      out.push(...(accountId ? page.rows.filter((r) => r.accountId === accountId) : page.rows));
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
