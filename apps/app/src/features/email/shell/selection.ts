// The list's selection model (AC13, AC14): a cursor (the open thread), a set
// of picked threads (`x`, ⇧J/⇧K, ⌘A), and auto-advance after a removal.

import type { MailCursor, MailEngine, MailTab, MailView } from "@/lib/runtime.types.mail-engine";

export type MailSelection = {
  cursor: string | null;
  picked: readonly string[];
  anchor: string | null;
};

export const EMPTY_SELECTION: MailSelection = { cursor: null, picked: [], anchor: null };

/** j/k: move the cursor by `delta`, clamped to the list. */
export function moveCursor(
  ids: readonly string[],
  sel: MailSelection,
  delta: number,
): MailSelection {
  if (ids.length === 0) return sel;
  const i = sel.cursor ? ids.indexOf(sel.cursor) : -1;
  const next =
    i < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + delta));
  return { ...sel, cursor: ids[next] ?? null };
}

/** `x`: toggle the cursor's thread in the picked set. */
export function togglePick(sel: MailSelection, id: string | null = sel.cursor): MailSelection {
  if (!id) return sel;
  const picked = sel.picked.includes(id) ? sel.picked.filter((p) => p !== id) : [...sel.picked, id];
  return { ...sel, picked, anchor: id };
}

/** ⇧J/⇧K: move the cursor and pick everything between the anchor and it. */
export function extendPick(
  ids: readonly string[],
  sel: MailSelection,
  delta: number,
): MailSelection {
  const anchor = sel.anchor ?? sel.cursor ?? ids[0] ?? null;
  const moved = moveCursor(ids, sel, delta);
  if (!anchor || !moved.cursor) return moved;
  const a = ids.indexOf(anchor);
  const b = ids.indexOf(moved.cursor);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const range = ids.slice(Math.max(lo, 0), hi + 1);
  const picked = [...new Set([...sel.picked, ...range])];
  return { cursor: moved.cursor, picked, anchor };
}

export function pickAll(ids: readonly string[], sel: MailSelection): MailSelection {
  return { ...sel, picked: [...ids] };
}

/** What an action applies to: the picked set, else the cursor. */
export function targets(sel: MailSelection): string[] {
  if (sel.picked.length > 0) return [...sel.picked];
  return sel.cursor ? [sel.cursor] : [];
}

/**
 * Auto-advance (D27): after `removed` leave the list, the cursor goes to the
 * first remaining thread below the last removed one, else the one above.
 */
export function advanceAfterRemoval(
  ids: readonly string[],
  sel: MailSelection,
  removed: readonly string[],
): MailSelection {
  const gone = new Set(removed);
  const cursorGone = sel.cursor !== null && gone.has(sel.cursor);
  const picked = sel.picked.filter((p) => !gone.has(p));
  if (!cursorGone) return { ...sel, picked };
  let last = -1;
  for (let i = 0; i < ids.length; i++) if (gone.has(ids[i]!)) last = i;
  let next: string | null = null;
  for (let i = last + 1; i < ids.length; i++) {
    if (!gone.has(ids[i]!)) {
      next = ids[i]!;
      break;
    }
  }
  if (!next) {
    for (let i = last - 1; i >= 0; i--) {
      if (!gone.has(ids[i]!)) {
        next = ids[i]!;
        break;
      }
    }
  }
  return { cursor: next, picked, anchor: null };
}

/** What ⌘A covers: the list the shell shows (a view, its tab, the rail's account scope). */
export type MailSelectAllQuery = {
  view: MailView;
  tab: MailTab | null;
  accountId: string | null;
};

/** Ids read per page while ⌘A walks the whole list. */
export const SELECT_ALL_PAGE = 1000;

/**
 * ⌘A (AC20): every thread id in the tab, not only the loaded window. Walks the
 * engine's keyset pages for the same query the list reads; the bulk op then
 * takes the full list as one op with one undo (the engine chunks it).
 */
export async function allThreadIds(
  engine: Pick<MailEngine, "listThreads">,
  query: MailSelectAllQuery,
  pageSize = SELECT_ALL_PAGE,
): Promise<string[]> {
  const ids: string[] = [];
  let after: MailCursor | null = null;
  do {
    const page = await engine.listThreads({
      view: query.view,
      tab: query.tab,
      after,
      limit: pageSize,
    });
    for (const r of page.rows) {
      if (!query.accountId || r.accountId === query.accountId) ids.push(r.threadId);
    }
    after = page.next;
  } while (after);
  return ids;
}
