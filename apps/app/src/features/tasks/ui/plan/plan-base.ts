// What the plan view is handed, and the small things every part of it shares.

import type { ModuoRuntime } from "../../../../lib/runtime.types";
import { useTasksSelector, useTasksStatus } from "../../tasks-context";
import type { ListExtraGroup } from "../list-extensions";

export type TasksPlanViewProps = {
  workspaceId: string;
  /** Spine runtime — powers the task detail panel's linked-entity hub (DF-8). */
  runtime: ModuoRuntime | null;
  /** URL-held task selection (?id=, DF-1) — the page owns the router coupling. */
  urlTaskId: string | null;
  onUrlTaskIdChange: (id: string | null) => void;
  /** `?view=<id>` (TV-U8): a saved view's link, opened once, then taken off the URL. */
  urlViewId?: string | null;
  onUrlViewConsumed?: () => void;
  /** `?place=` (DF-1): the place open in the centre; the page owns the router coupling. */
  urlPlace?: string | null;
  onUrlPlaceChange: (place: string) => void;
};

export const EMPTY_IDS: readonly string[] = [];
export const NO_OP = () => {};
export const NO_EXTRAS: readonly ListExtraGroup[] = [];

// Per-workspace UI state (selection / mode / zoom) persisted locally — these
// are view preferences, not synced data. Layout, grouping and filters are
// per scope, in Display (use-tasks-display.tsx).
function lsKey(workspaceId: string, part: string): string {
  return `moduo:tasks:${part}:${workspaceId}`;
}
export function readLS(workspaceId: string, part: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(lsKey(workspaceId, part));
  } catch {
    return null;
  }
}
export function writeLS(workspaceId: string, part: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lsKey(workspaceId, part), value);
  } catch {
    /* ignore */
  }
}
export function removeLS(workspaceId: string, part: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(lsKey(workspaceId, part));
  } catch {
    /* ignore */
  }
}

/**
 * The props, with their defaults, and the module's four most-read fields
 * (read from the page's `TasksProvider`).
 */
export function usePlanBase(props: TasksPlanViewProps) {
  const { canEdit } = useTasksStatus();
  const buckets = useTasksSelector((d) => d.buckets);
  const inbox = useTasksSelector((d) => d.inbox);
  const tasks = useTasksSelector((d) => d.liveTasks);
  return {
    ...props,
    urlViewId: props.urlViewId ?? null,
    urlPlace: props.urlPlace ?? null,
    canEdit,
    buckets,
    inbox,
    tasks,
  };
}

export type PlanBase = ReturnType<typeof usePlanBase>;
