import { useCallback, useState } from "react";

/**
 * The dashboard's edit-mode toggle (DB-3, AC4). Deliberately tiny — just the
 * boolean plus stable enter/exit/toggle. The *entries* (floating Edit control,
 * right-click menu, long-press) and *exits* (Done control, Escape) all funnel
 * through these; keeping the state here (not in the page component's body) lets
 * the drag hook and the chrome share one source of truth and lets DB-4 persist
 * "was I editing" per device later without reshaping callers.
 */
export interface EditModeApi {
  editing: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

export function useEditMode(): EditModeApi {
  const [editing, setEditing] = useState(false);
  const enter = useCallback(() => setEditing(true), []);
  const exit = useCallback(() => setEditing(false), []);
  const toggle = useCallback(() => setEditing((e) => !e), []);
  return { editing, enter, exit, toggle };
}
