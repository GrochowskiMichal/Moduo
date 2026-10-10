// Manual order lives inside one project (tasks-v3 §4, default m; TV-U4).
// Pure: no React, no IO.
//
// `tasks.position` is one key space: every project's manual order is a filter
// of it. A drag writes a position only where the list on screen IS one
// project's order — a project, or the Inbox — and only while it shows that
// order (Display → Order by: Manual). A sorted project view keeps its manual
// order untouched underneath, says so ("Sorted by due date · Back to manual
// order") and asks to switch back before a reorder. A view across projects
// (All, My tasks, the Queue's board) has no manual order of its own: a drag
// there never writes a position; it only changes the field of the group it
// lands in (status, priority, assignee, project). One shared order can't
// survive two views sorted differently.

import type { TaskOrder } from "./display";

/** How a drag in a view treats the order. */
export type DragOrder =
  /** One project's manual order: a reorder writes `position`. */
  | "manual"
  /** One project, sorted: a reorder is refused and asks to switch back. */
  | "sorted"
  /** Across projects: no reorder, and the view never writes a position. */
  | "none";

/**
 * Whether a scope lists one project's tasks, so it has a manual order: a
 * project (its id) or the Inbox. All, My tasks and the Queue ("today", whose
 * own line-up is the queue's, not `position`) are across projects.
 */
export function hasManualOrder(scope: string): boolean {
  return scope !== "all" && scope !== "mine" && scope !== "today";
}

/** How a drag in `scope` under Display → Order by `order` treats the order. */
export function dragOrderFor(scope: string, order: TaskOrder): DragOrder {
  if (!hasManualOrder(scope)) return "none";
  return order === "manual" ? "manual" : "sorted";
}

/** Whether the view shows the "Sorted by … · Back to manual order" line. */
export function showsSortedNote(scope: string, order: TaskOrder): boolean {
  return dragOrderFor(scope, order) === "sorted";
}

const SORTED_BY: Record<Exclude<TaskOrder, "manual">, string> = {
  due: "due date",
  scheduled: "scheduled time",
  priority: "priority",
  created: "date created",
  updated: "last updated",
};

/** "Sorted by due date": the sorted note, the drag note and the drop toast. */
export function sortedByLabel(order: Exclude<TaskOrder, "manual">): string {
  return `Sorted by ${SORTED_BY[order]}`;
}

/** The sorted note's action: Display → Order by goes back to Manual. */
export const BACK_TO_MANUAL_ORDER = "Back to manual order";
