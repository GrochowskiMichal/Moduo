// What one List row or Board card shows beyond its task, and the actions it
// can take (Tasks v3 TV-D11b, spec §Assumptions #8, REPLAN §6.11: "rows
// memoised, and hooks keep stable identities, so editing one task redraws one
// row").
//
// The module's API object is new on every change (any task, the queue, a
// tag), so a row that took it as a prop redrew on every edit anywhere. A row
// takes instead:
//   - its task (the store keeps every other task's object as it was);
//   - its facts, read from the API's maps for that task only, compared by
//     value (`sameTaskFacts`): a row redraws when its own facts change;
//   - one actions object that never changes (`useRowActions`), which calls
//     the newest API when a person acts.

import { isClosedTask } from "@contracts/vocabularies";
import { useLayoutEffect, useRef, useState } from "react";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Tag, Task } from "../model";
import { statusNameOf } from "../statuses";

/** Everything a row or card shows that isn't on its task. */
export type TaskFacts = {
  /** In my queue. */
  queued: boolean;
  /** Who else has it queued (user ids, earliest first). */
  claims: readonly string[];
  /** "Blocked by …" when an open task blocks it; null when nothing does. */
  blockedLabel: string | null;
  /** Its tags, name-sorted. */
  tags: readonly Tag[];
  /** Subtasks done / total (null without subtasks). */
  progress: { done: number; total: number } | null;
  /** The status's own name (Detailed rows). */
  statusName: string;
};

/** The API maps the facts are read from. */
export type FactsSource = Pick<
  TasksModuleApi,
  | "queuedTaskIds"
  | "queueClaims"
  | "blockedTaskIds"
  | "blockersByTask"
  | "tagsByTask"
  | "subtaskProgressByTask"
  | "statusById"
>;

const NONE: readonly never[] = [];

/** "Blocked by “Design review”" or "Blocked by 3 tasks". */
export function blockedLabelOf(blockers: readonly Pick<Task, "title" | "status">[]): string {
  const open = blockers.filter((b) => !isClosedTask(b as Task));
  return open.length === 1
    ? `Blocked by “${open[0]?.title || "Untitled"}”`
    : `Blocked by ${open.length} tasks`;
}

export function taskFactsOf(task: Task, api: FactsSource): TaskFacts {
  const blocked = api.blockedTaskIds.has(task.id);
  return {
    queued: api.queuedTaskIds.has(task.id),
    claims: api.queueClaims.get(task.id) ?? NONE,
    blockedLabel: blocked ? blockedLabelOf(api.blockersByTask.get(task.id) ?? NONE) : null,
    tags: api.tagsByTask.get(task.id) ?? NONE,
    progress: api.subtaskProgressByTask.get(task.id) ?? null,
    statusName: statusNameOf(task, api.statusById),
  };
}

function sameItems<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => same(x, b[i] as T)));
}

const sameTag = (a: Tag, b: Tag) =>
  a === b || (a.id === b.id && a.name === b.name && a.color === b.color);

/** Two facts that draw the same row. */
export function sameTaskFacts(a: TaskFacts, b: TaskFacts): boolean {
  if (a === b) return true;
  return (
    a.queued === b.queued &&
    a.blockedLabel === b.blockedLabel &&
    a.statusName === b.statusName &&
    (a.progress === b.progress ||
      (!!a.progress &&
        !!b.progress &&
        a.progress.done === b.progress.done &&
        a.progress.total === b.progress.total)) &&
    sameItems(a.claims, b.claims, Object.is) &&
    sameItems(a.tags, b.tags, sameTag)
  );
}

/** Two flat objects with the same values (a row's columns, say). */
export function sameValues<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof T)[];
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
}

/** The actions a row or card can take. */
export type TaskRowActions = Pick<
  TasksModuleApi,
  "toggleDone" | "patchTask" | "toggleQueue" | "skipOccurrence" | "setTaskParent" | "deleteTask"
>;

/**
 * One actions object for the life of the view: each call goes to the newest
 * API, so rows never redraw because the API object did.
 */
export function useRowActions(api: TaskRowActions): TaskRowActions {
  const latest = useRef(api);
  useLayoutEffect(() => {
    latest.current = api;
  });
  const [actions] = useState<TaskRowActions>(() => ({
    toggleDone: (...args) => latest.current.toggleDone(...args),
    patchTask: (...args) => latest.current.patchTask(...args),
    toggleQueue: (...args) => latest.current.toggleQueue(...args),
    skipOccurrence: (...args) => latest.current.skipOccurrence(...args),
    setTaskParent: (...args) => latest.current.setTaskParent(...args),
    deleteTask: (...args) => latest.current.deleteTask(...args),
  }));
  return actions;
}
