// What a person folded on a Board (TV-U11; 53b, call 85): columns and lanes,
// remembered per person, workspace, view and grouping, like the List's
// groups (U10-7), and following the person to every device (TV-U8,
// `boardFoldKey` in folds.ts). Backlog and Won't do start folded; a fold you
// choose (either way) wins.
//
// A Board's droppable ids are opaque (`col:status:<uuid>`), so screen readers
// hear the names the board registers here (`boardDropName`), never ids.

import { useCallback, useState } from "react";
import { readFolds, writeFold } from "../folds";

export type BoardFolds = {
  /** The fold you chose for an id (a column id, "col:…", or "lane:<kind>:<key>"), else undefined. */
  get: (id: string) => boolean | undefined;
  set: (id: string, folded: boolean) => void;
};

export function useBoardFolds(key: string | null): BoardFolds {
  const [state, setState] = useState(() => ({ key, folds: readFolds(key) }));
  let folds = state.folds;
  if (state.key !== key) {
    // Derive-on-render: another view's folds replace these in this render.
    folds = readFolds(key);
    setState({ key, folds });
  }
  const get = useCallback((id: string) => folds[id], [folds]);
  const set = useCallback((id: string, folded: boolean) => {
    setState((prev) => {
      const next = { ...prev.folds, [id]: folded };
      writeFold(prev.key, id, folded);
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
