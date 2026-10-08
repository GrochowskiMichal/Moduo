// Completed tasks in lists and boards (tasks-v2 §6, TV-U1 U1-3).
//
// Display → Completed: Hidden (default) · 7 days · All. Hidden completed tasks
// leave each list or group behind a quiet "N completed · show" line. A task
// you check off stays where it is, struck through, until you change scope or
// reload, so its Undo is still one click away.

import { useState } from "react";
import type { Task, TaskStatus } from "./model";

export const COMPLETED_MODES = ["hidden", "week", "all"] as const;
export type CompletedMode = (typeof COMPLETED_MODES)[number];

/** "7 days" keeps the tasks completed within this many days. */
export const COMPLETED_WINDOW_DAYS = 7;

type CompletedTask = Pick<Task, "id" | "status" | "updatedAt">;

/**
 * Whether a done task is recent enough for "7 days". Completion time isn't
 * stored, so a done task's last update stands in for it: a done task is
 * rarely edited after it's checked off (and the server stamps `updated_at`).
 */
export function completedWithin(task: CompletedTask, now: Date, days: number): boolean {
  const at = new Date(task.updatedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= days * 86_400_000;
}

export type CompletedOptions<T> = {
  mode: CompletedMode;
  now: Date;
  /**
   * Done tasks that stay anyway: the ones just checked off, the selected one
   * (a deep link or the detail panel must never point at a row that isn't
   * there), and a parent with open subtasks (they nest under it).
   */
  keep: (task: T) => boolean;
};

/** Whether Display hides this task: done, outside the window, not kept. */
export function isCompletedHidden<T extends CompletedTask>(
  task: T,
  options: CompletedOptions<T>,
): boolean {
  if (task.status !== "done" || options.mode === "all") return false;
  if (options.keep(task)) return false;
  return !(options.mode === "week" && completedWithin(task, options.now, COMPLETED_WINDOW_DAYS));
}

/**
 * Splits one list or group into the rows it shows and the completed tasks
 * Display hides, keeping their order. Open tasks always show.
 */
export function partitionCompleted<T extends CompletedTask>(
  tasks: readonly T[],
  options: CompletedOptions<T>,
): { shown: T[]; hidden: T[] } {
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const task of tasks) (isCompletedHidden(task, options) ? hidden : shown).push(task);
  return { shown, hidden };
}

// ── Just checked off: stays in place until the scope changes ────────────────

export type JustCompleted = {
  scope: string;
  /** Every task's status as last seen in this scope. */
  seen: ReadonlyMap<string, TaskStatus>;
  /** Tasks seen going from open to done while this scope was showing. */
  ids: ReadonlySet<string>;
};

/**
 * Advances the "just completed" record for this render. A new scope starts
 * empty. A task seen open and now done joins `ids`; a task first seen done
 * (it was already done, or arrived done) doesn't. Returns `prev` itself when
 * nothing changed, so a caller can store it without looping.
 */
export function trackJustCompleted(
  prev: JustCompleted | null,
  scope: string,
  tasks: readonly Pick<Task, "id" | "status">[],
): JustCompleted {
  if (!prev || prev.scope !== scope) {
    return { scope, seen: new Map(tasks.map((t) => [t.id, t.status])), ids: new Set() };
  }
  let seen: Map<string, TaskStatus> | null = null;
  let ids: Set<string> | null = null;
  for (const task of tasks) {
    const before = prev.seen.get(task.id);
    if (before === task.status) continue;
    seen ??= new Map(prev.seen);
    seen.set(task.id, task.status);
    if (before !== undefined && before !== "done" && task.status === "done") {
      ids ??= new Set(prev.ids);
      ids.add(task.id);
    }
  }
  if (!seen) return prev;
  return { scope, seen, ids: ids ?? prev.ids };
}

/**
 * The tasks checked off while `scope` has been showing (TV-U1): they stay
 * listed, struck through, until the scope changes or the page reloads.
 * Derived during render, so a checked-off row never disappears for a frame.
 */
export function useJustCompleted(
  tasks: readonly Pick<Task, "id" | "status">[],
  scope: string,
): ReadonlySet<string> {
  const [record, setRecord] = useState<JustCompleted>(() => trackJustCompleted(null, scope, tasks));
  const next = trackJustCompleted(record, scope, tasks);
  if (next !== record) setRecord(next);
  return next.ids;
}

// ── Opened here: a deep-linked or selected task stays until the scope changes ─

export type OpenedHere = { scope: string; ids: ReadonlySet<string> };

/**
 * Advances the set of tasks opened while `scope` shows: the selected task and
 * its parent (a subtask nests under it, so a hidden parent would hide it). A
 * new scope starts empty. Returns `prev` when nothing changed. Keeping them
 * means a deep link to finished work lands on a row, and moving the selection
 * on doesn't pull that row out from under the cursor.
 */
export function trackOpened(
  prev: OpenedHere | null,
  scope: string,
  selected: { id: string; parentId: string | null } | null,
): OpenedHere {
  const base = !prev || prev.scope !== scope ? { scope, ids: new Set<string>() } : prev;
  if (!selected) return base;
  const add = [selected.id, selected.parentId].filter(
    (id): id is string => !!id && !base.ids.has(id),
  );
  if (add.length === 0) return base;
  return { scope, ids: new Set([...base.ids, ...add]) };
}

/** `trackOpened` as state, derived during render (no frame without the row). */
export function useOpenedHere(
  scope: string,
  selected: { id: string; parentId: string | null } | null,
): ReadonlySet<string> {
  const [record, setRecord] = useState<OpenedHere>(() => trackOpened(null, scope, selected));
  const next = trackOpened(record, scope, selected);
  if (next !== record) setRecord(next);
  return next.ids;
}

/** The quiet line under a list or group: "5 completed". */
export function completedLabel(count: number): string {
  return `${count} completed`;
}
