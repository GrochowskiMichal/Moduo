// Per-project statuses (TV-D9, REPLAN 53/53a): each project names its own
// statuses inside five fixed categories, and the category carries the app's
// behaviour. Pure helpers over the bundle's `statuses`; the server's rules
// (supabase/migrations/20261010170000_project_statuses.sql) are the source of
// truth and these mirror them for optimistic updates and labels.

import {
  TASK_STATUS_CATEGORIES,
  type TaskStatusCategory,
  legacyTaskStatus,
  taskCategoryOf,
} from "@contracts/vocabularies";
import type { Bucket, ProjectStatus, Task } from "./model";

/** What each category is called (also the workspace default names). */
export const CATEGORY_LABELS: Record<TaskStatusCategory, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won’t do",
};

/** One line on what a category means, for the Statuses editor. */
export const CATEGORY_HINTS: Record<TaskStatusCategory, string> = {
  backlog: "Not planned yet. Out of counts, My tasks, Upcoming and Focus.",
  todo: "Planned, not started.",
  in_progress: "Being worked on.",
  done: "Finished.",
  wont_do: "Closed without doing it.",
};

const RANK: Record<TaskStatusCategory, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  done: 3,
  wont_do: 4,
};

/** Statuses in display order: by category, then position. */
export function sortStatuses(list: readonly ProjectStatus[]): ProjectStatus[] {
  return list
    .slice()
    .sort(
      (a, b) =>
        RANK[a.category] - RANK[b.category] ||
        a.position - b.position ||
        (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/**
 * The statuses a project's tasks use: its own set, or the workspace default
 * for the Inbox (a system project). Empty for a project this reader can't see
 * (its statuses aren't readable; the task's category still is).
 */
export function statusSetFor(
  statuses: readonly ProjectStatus[],
  bucket: Pick<Bucket, "id" | "isSystem"> | null | undefined,
): ProjectStatus[] {
  if (!bucket) return [];
  if (bucket.isSystem) return defaultStatusSet(statuses);
  return sortStatuses(statuses.filter((s) => s.projectId === bucket.id));
}

/** The workspace default set, in order. */
export function defaultStatusSet(statuses: readonly ProjectStatus[]): ProjectStatus[] {
  return sortStatuses(statuses.filter((s) => s.projectId === null));
}

/** A category's first status in a set: visible ones first, then by position
 *  (the server's `tasks__first_status`). */
export function firstStatusOf(
  set: readonly ProjectStatus[],
  category: TaskStatusCategory,
): ProjectStatus | null {
  const inCategory = sortStatuses(set.filter((s) => s.category === category));
  return inCategory.find((s) => !s.hidden) ?? inCategory[0] ?? null;
}

/** The fields a status change sets on a task, for showing it before the
 *  server answers. A category keeps the current status when it's already in
 *  it (as the server does); an id is taken as it is. */
export type StatusTarget = { statusId: string } | { category: TaskStatusCategory };

export function optimisticStatus(
  task: Pick<Task, "status" | "statusId" | "statusCategory">,
  target: StatusTarget,
  set: readonly ProjectStatus[],
): Pick<Task, "status" | "statusId" | "statusCategory"> {
  if ("statusId" in target) {
    const s = set.find((x) => x.id === target.statusId);
    const category = s?.category ?? taskCategoryOf(task);
    return { statusId: target.statusId, statusCategory: category, status: legacyTaskStatus(category) };
  }
  const category = target.category;
  if (taskCategoryOf(task) === category && task.statusId) {
    return { statusId: task.statusId, statusCategory: category, status: legacyTaskStatus(category) };
  }
  return {
    statusId: firstStatusOf(set, category)?.id ?? task.statusId ?? null,
    statusCategory: category,
    status: legacyTaskStatus(category),
  };
}

/** The name a task's status goes by: its project's, else its category's. */
export function statusNameOf(
  task: Pick<Task, "status" | "statusId" | "statusCategory">,
  byId: ReadonlyMap<string, ProjectStatus>,
): string {
  const own = task.statusId ? byId.get(task.statusId) : undefined;
  return own?.name ?? CATEGORY_LABELS[taskCategoryOf(task)];
}

/** A set grouped by category, every category present (an empty list when a
 *  set somehow lacks one), in the fixed order. */
export function statusesByCategory(
  set: readonly ProjectStatus[],
): Array<{ category: TaskStatusCategory; statuses: ProjectStatus[] }> {
  const sorted = sortStatuses(set);
  return TASK_STATUS_CATEGORIES.map((category) => ({
    category,
    statuses: sorted.filter((s) => s.category === category),
  }));
}

/** Replace one set (a project's, or the default when `projectId` is null)
 *  inside the bundle's statuses with what an op answered. */
export function replaceStatusSet(
  all: readonly ProjectStatus[],
  projectId: string | null,
  set: readonly ProjectStatus[],
): ProjectStatus[] {
  return [...all.filter((s) => s.projectId !== projectId), ...set];
}
