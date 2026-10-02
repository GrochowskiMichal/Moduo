// DF-21e — the bell's opt-in "overdue" section (AC9). Default OFF. A quiet,
// PASSIVE view of drifted tasks — NOT generated `module_activity` rows, so it is
// never in the unread badge and it clears the instant a task is done/rescheduled
// (recomputed from tasks.list on each bell open). Reuses `isDrifted` (tasks/model)
// so "overdue" == the same ambient drift signal the rest of the app uses — never
// red, never a running count (design principles 4 & 5; spec Assumption 6).

import { isDrifted, type Task } from "../tasks/model";

/** A passive overdue row. Deep-links to /tasks via `moduo:entity:open`. */
export type OverdueItem = {
  id: string;
  title: string;
  /** The passed scheduled time (ISO) — drives the "scheduled N ago" caption. */
  scheduledAt: string;
};

/** The minimal task slice the section needs (a subset of the Tasks bundle). */
export type OverdueTaskInput = Pick<Task, "id" | "title" | "scheduledAt" | "status" | "ownerId">;

/**
 * The passive overdue items for the bell. Empty unless `enabled` (the opt-in
 * `overdueTasks` pref) — so a user who never turns it on pays nothing and sees
 * nothing. Scoped to the current user's OWN tasks (`ownerId === userId`): the bell
 * is a personal "what needs me" surface, so a teammate's drifted work is not the
 * user's overdue (and would be noise in a shared workspace). Drifted = scheduled in
 * the past and still open (`isDrifted`). Ordered most-overdue first (oldest
 * `scheduledAt`) for a calm, stable order. A task that gets completed or rescheduled
 * simply stops being drifted → drops out on the next recompute (no stored rows).
 */
export function selectOverdueTasks(
  tasks: OverdueTaskInput[],
  opts: { enabled: boolean; userId: string | null; now?: Date },
): OverdueItem[] {
  if (!opts.enabled || !opts.userId) return [];
  const now = opts.now ?? new Date();
  return tasks
    .filter(
      (task) => task.ownerId === opts.userId && task.scheduledAt != null && isDrifted(task, now),
    )
    .map((task) => ({ id: task.id, title: task.title, scheduledAt: task.scheduledAt as string }))
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0));
}
