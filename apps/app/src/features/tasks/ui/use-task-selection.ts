// The page's multi-selection (TV-U12, `selection.ts`): kept beside the cursor
// (`selectedTaskId`, which the panel, the URL and the keys follow). Views pass
// their visible order with each gesture, so the page never needs to know how
// rows are drawn. Every function keeps its identity, so a memoised row that
// holds one never redraws for it.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  extendSelection,
  isMulti,
  NO_SELECTION,
  pruneSelection,
  selectAll as selectAllIn,
  type SelectMods,
  type SelectResult,
  selectWith,
  type TaskSelection,
} from "../selection";

/** What a view needs to select several tasks. */
export type MultiSelect = {
  /** The selected tasks while two or more are; empty otherwise. */
  ids: ReadonlySet<string>;
  /** A click on a task (⇧ a range, ⌘ one more), against the view's order. */
  select: (id: string, mods: SelectMods, order: readonly string[]) => void;
  /** ⇧↑ / ⇧↓ from the cursor. */
  extend: (step: 1 | -1, order: readonly string[]) => void;
  /** ⌘A. */
  selectAll: (order: readonly string[]) => void;
  /** Back to the cursor alone. True when there was a set to clear. */
  clear: () => boolean;
};

export function useTaskSelection(
  cursor: string | null,
  setCursor: (id: string | null) => void,
): MultiSelect & {
  selection: TaskSelection;
  multi: boolean;
  /** Drop the tasks `keep` says left; one left alone is the cursor again. */
  prune: (keep: (id: string) => boolean, order?: readonly string[]) => void;
} {
  const [selection, setSelection] = useState<TaskSelection>(NO_SELECTION);
  const latest = useRef({ selection, cursor, setCursor });
  useLayoutEffect(() => {
    latest.current = { selection, cursor, setCursor };
  });
  const apply = useCallback((result: SelectResult | null) => {
    if (!result) return;
    latest.current.selection = result.selection;
    setSelection(result.selection);
    if (result.cursor !== latest.current.cursor) {
      latest.current.cursor = result.cursor;
      latest.current.setCursor(result.cursor);
    }
  }, []);
  const select = useCallback(
    (id: string, mods: SelectMods, order: readonly string[]) =>
      apply(selectWith(latest.current.selection, latest.current.cursor, id, mods, order)),
    [apply],
  );
  const extend = useCallback(
    (step: 1 | -1, order: readonly string[]) =>
      apply(extendSelection(latest.current.selection, latest.current.cursor, step, order)),
    [apply],
  );
  const selectAll = useCallback(
    (order: readonly string[]) => apply(selectAllIn(latest.current.cursor, order)),
    [apply],
  );
  const clear = useCallback(() => {
    if (latest.current.selection.ids.size === 0) return false;
    latest.current.selection = NO_SELECTION;
    setSelection(NO_SELECTION);
    return true;
  }, []);
  const prune = useCallback(
    (keep: (id: string) => boolean, order: readonly string[] = []) =>
      apply(pruneSelection(latest.current.selection, latest.current.cursor, keep, order)),
    [apply],
  );
  const multi = isMulti(selection);
  return useMemo(
    () => ({ selection, ids: selection.ids, multi, select, extend, selectAll, clear, prune }),
    [selection, multi, select, extend, selectAll, clear, prune],
  );
}
