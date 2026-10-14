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
import { formatAge } from "../../../lib/time-format";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { ProjectStatus, Tag, Task, TaskWaitingEntry } from "../model";
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
  /** Its section's name (Detailed's "Project › Section"); null without one. */
  sectionName: string | null;
  /** "on Anna · 2d" while it waits on someone or something (TV-D10). */
  waiting: string | null;
  /** Live comments on it (TV-D11a's counts). */
  comments: number;
  /** Finished files on it (AT-3's 📎 counts). Absent: 0. */
  attachments?: number;
  /** A capture or check-off of it waits on this device to sync (offline). */
  pending: boolean;
  /**
   * What the date column says in this view, when the view words it its own
   * way (Upcoming's "3:00 PM · 45m", "missed 2:00 PM"; TV-U15). Absent: the
   * List's own date.
   */
  when?: string | null;
  /** A team's unclaimed task you can take (My tasks' team block, TV-U15). */
  takeable?: boolean;
  /** Where an Inbox task came from ("from Mike"; TV-U15). */
  source?: string | null;
  /** "Claude · working" while an agent session you can see works on it (TV-D16). */
  agent?: string | null;
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
> & {
  /** Section id → name (the view builds it once from `api.sections`). */
  sectionNames?: ReadonlyMap<string, string>;
  /** Task id → its waiting line (`waitingLabelsOf`). */
  waitingLabels?: ReadonlyMap<string, string>;
  commentCounts?: ReadonlyMap<string, number>;
  /** Task id → its finished files (AT-3). */
  attachmentCounts?: ReadonlyMap<string, number>;
  pendingTaskIds?: ReadonlySet<string>;
  /** The view's own date words for a row (TV-U15). */
  whenOf?: (task: Task) => string | null;
  /** Tasks a row offers "Take it" on (TV-U15). */
  takeableIds?: ReadonlySet<string>;
  /** Where a row's task came from (the Inbox's source words, TV-U15). */
  sourceOf?: (task: Task) => string | null;
  /** Task id → its agent mark (`agentRowMarks`, TV-D16). */
  agentMarks?: ReadonlyMap<string, string>;
};

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
    statusName: statusNameOf(task, api.statusById ?? NO_STATUSES),
    sectionName: task.sectionId ? (api.sectionNames?.get(task.sectionId) ?? null) : null,
    waiting: api.waitingLabels?.get(task.id) ?? null,
    comments: api.commentCounts?.get(task.id) ?? 0,
    attachments: api.attachmentCounts?.get(task.id) ?? 0,
    pending: api.pendingTaskIds?.has(task.id) ?? false,
    ...(api.whenOf ? { when: api.whenOf(task) } : {}),
    ...(api.takeableIds?.has(task.id) ? { takeable: true } : {}),
    ...(api.sourceOf ? { source: api.sourceOf(task) } : {}),
    ...(api.agentMarks?.has(task.id) ? { agent: api.agentMarks.get(task.id) } : {}),
  };
}

const NO_STATUSES: ReadonlyMap<string, ProjectStatus> = new Map<string, ProjectStatus>();

/**
 * Each waiting task's line, "on Anna · 2d" (TV-D10's Waiting on…): the first
 * thing it waits on by name ("+1" for more), and how long since the earliest.
 * People read by name (`nameOf`); an email, an agent or a note reads by its
 * label.
 */
export function waitingLabelsOf(
  entries: ReadonlyArray<Pick<TaskWaitingEntry, "taskId" | "kind" | "ref" | "label" | "since">>,
  nameOf: (userId: string) => string | null,
  now: Date = new Date(),
): Map<string, string> {
  const byTask = new Map<string, typeof entries>();
  for (const e of entries) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);
  const out = new Map<string, string>();
  for (const [taskId, list] of byTask) {
    const sorted = [...list].sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    const first = sorted[0];
    if (!first) continue;
    const who =
      (first.kind === "person" && first.ref ? nameOf(first.ref) : null) ??
      first.label?.trim() ??
      (first.kind === "email" ? "a reply" : first.kind === "agent" ? "an agent" : "something");
    const more = sorted.length > 1 ? ` +${sorted.length - 1}` : "";
    out.set(taskId, `on ${who || "something"}${more} · ${formatAge(first.since, now)}`);
  }
  return out;
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
    a.sectionName === b.sectionName &&
    a.waiting === b.waiting &&
    a.comments === b.comments &&
    (a.attachments ?? 0) === (b.attachments ?? 0) &&
    a.pending === b.pending &&
    (a.when ?? null) === (b.when ?? null) &&
    !!a.takeable === !!b.takeable &&
    (a.source ?? null) === (b.source ?? null) &&
    (a.agent ?? null) === (b.agent ?? null) &&
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
  | "toggleDone"
  | "patchTask"
  | "toggleQueue"
  | "focusOnTask"
  | "skipOccurrence"
  | "setTaskParent"
  | "deleteTask"
  | "setTaskStatus"
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
    focusOnTask: (...args) => latest.current.focusOnTask(...args),
    skipOccurrence: (...args) => latest.current.skipOccurrence(...args),
    setTaskParent: (...args) => latest.current.setTaskParent(...args),
    deleteTask: (...args) => latest.current.deleteTask(...args),
    // Optional on the views' stand-in APIs (stories, tests).
    setTaskStatus: (...args) => latest.current.setTaskStatus?.(...args),
  }));
  return actions;
}
