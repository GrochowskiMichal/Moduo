// What a person folded on a Board (TV-U11; 53b, call 85): columns and lanes,
// remembered per person, workspace, view and grouping on this device, like
// the List's groups (U10-7). Backlog and Won't do start folded; a fold you
// choose (either way) wins. The key is the page's
// `moduo:tasks:folds:<user>:<scope>:board:<group>:<ws>`.
//
// A Board's droppable ids are opaque (`col:status:<uuid>`), so screen readers
// hear the names the board registers here (`boardDropName`), never ids.

import { useCallback, useState } from "react";

export type BoardFolds = {
  /** The fold you chose for an id (a column id, "col:…", or "lane:<kind>:<key>"), else undefined. */
  get: (id: string) => boolean | undefined;
  set: (id: string, folded: boolean) => void;
};

function read(key: string | null): Record<string, boolean> {
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "boolean") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function write(key: string | null, folds: Record<string, boolean>): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(folds));
  } catch {
    // Quota or disabled storage: the fold still works, it just isn't remembered.
  }
}

export function useBoardFolds(key: string | null): BoardFolds {
  const [state, setState] = useState(() => ({ key, folds: read(key) }));
  let folds = state.folds;
  if (state.key !== key) {
    // Derive-on-render: another view's folds replace these in this render.
    folds = read(key);
    setState({ key, folds });
  }
  const get = useCallback((id: string) => folds[id], [folds]);
  const set = useCallback((id: string, folded: boolean) => {
    setState((prev) => {
      const next = { ...prev.folds, [id]: folded };
      write(prev.key, next);
      return { key: prev.key, folds: next };
    });
  }, []);
  return { get, set };
}

// ── what a drop target is called ────────────────────────────────────────────

const names = new Map<string, string>();

/** The board says what each of its drop targets is called (a column, a cell). */
export function registerBoardDropNames(entries: Iterable<[string, string]>): void {
  names.clear();
  for (const [id, name] of entries) names.set(id, name);
}

/** A Board drop target's name ("In review", "In review · Sam"), or null. */
export function boardDropName(id: string): string | null {
  return names.get(id) ?? null;
}
