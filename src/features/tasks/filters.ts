// Tasks' Filter (tasks-v2 §7, TV-U2): the dimensions, what each task's values
// are on them, and the rules around them. Pure: the conditions are DS-4's
// plain `FilterCondition` data, matched with `matchesFilters`, so they persist
// through the view prefs as-is and test without rendering. The options and
// icons the menu shows are added by the page (use-tasks-filters.tsx), since
// they need the workspace's members and tags.
//
// Operators: is / is not / any of, AND across dimensions. Yes/no dimensions
// (In your Focus, Blocked, …) offer only "is".

import { TASK_STATUSES } from "@contracts/vocabularies";
import {
  type FilterCondition,
  type FilterDimension,
  matchesFilters,
  normalizeCondition,
  sanitizeConditions,
  toggleFilterValue,
} from "../../components/ui/filter-model";
import { completedFilterValues, dueFilterValues, scheduledFilterValues } from "./day-buckets";
import type { PriorityLevel, Task, TaskStatus } from "./model";
import { type StatusKey, statusKeyOf } from "./statuses";

export const TASK_FILTER_DIMENSIONS = [
  // MOD-141: the project a task is in, where more than one shows.
  "project",
  "assignee",
  // TV-D13: the team a task is routed to.
  "team",
  "creator",
  "tag",
  "status",
  // TV-U8: when a task was finished (the seeded "Done last week").
  "completed",
  "priority",
  "energy",
  "due",
  "scheduled",
  "queued",
  "blocked",
  // TV-U8: who or what a task waits on (the seeded "Waiting on …" views).
  "waiting",
  "recurring",
  "subtasks",
  "attachments",
] as const;
export type TaskFilterDimension = (typeof TASK_FILTER_DIMENSIONS)[number];

/** The value for "nobody" / "no level" / "no tag" on a dimension. */
export const NONE_VALUE = "none";

/**
 * Project's value for the reader's own Inbox (MOD-141): a word, not the
 * Inbox's id, so a shared view "Project is Inbox" shows each reader their own.
 */
export const INBOX_VALUE = "inbox";

/**
 * The places where Filter offers Project (MOD-141): those that show more
 * than one project's tasks (All, My tasks, Upcoming, Won't do, and the views
 * over them). Never inside one project or the Inbox.
 */
export function offersProjectFilter(place: string): boolean {
  return place === "all" || place === "mine" || place === "upcoming" || place === "wontdo";
}

const YES_NO_DIMENSIONS: ReadonlySet<string> = new Set([
  "queued",
  "blocked",
  "recurring",
  "subtasks",
  "attachments",
]);

export const TASK_FILTER_LABELS: Record<TaskFilterDimension, string> = {
  project: "Project",
  assignee: "Assignee",
  team: "Team",
  creator: "Creator",
  tag: "Tag",
  status: "Status",
  completed: "Completed",
  priority: "Priority",
  energy: "Energy",
  due: "Due date",
  scheduled: "Scheduled",
  // "your", never "my" (MOD-137).
  queued: "In your Focus",
  blocked: "Blocked",
  waiting: "Waiting on",
  recurring: "Recurring",
  subtasks: "Has subtasks",
  attachments: "Has attachments",
};

/** A dimension's shape without its options: the operators it offers and
 *  whether it takes more than one value. */
export function taskFilterShape(id: TaskFilterDimension): FilterDimension {
  return YES_NO_DIMENSIONS.has(id)
    ? { id, label: TASK_FILTER_LABELS[id], options: [], operators: ["is"], multiple: false }
    : { id, label: TASK_FILTER_LABELS[id], options: [] };
}

const SHAPES: FilterDimension[] = TASK_FILTER_DIMENSIONS.map(taskFilterShape);

/** Reads a scope's stored filters back: anything malformed or on a dimension
 *  that no longer exists is dropped (values aren't checked: a tag or member
 *  that loads later still applies). */
export function sanitizeTaskFilters(raw: unknown): FilterCondition[] {
  return sanitizeConditions(raw, SHAPES);
}

/**
 * Makes a dimension's condition include a value (a `#tag` or `@name` typed in
 * search). Unlike the menu's toggle it never removes: a value already asked
 * for stays. An "is not" condition on the dimension turns into "is" that value.
 */
export function addFilterValue(
  conditions: readonly FilterCondition[],
  dimension: TaskFilterDimension,
  value: string,
): FilterCondition[] {
  const shape = taskFilterShape(dimension);
  const index = conditions.findIndex((c) => c.dimension === dimension);
  const current = index === -1 ? null : conditions[index];
  if (!current) return toggleFilterValue(conditions, shape, value);
  if (current.operator === "is_not") {
    const next = normalizeCondition({ dimension, operator: "is", values: [value] }, shape);
    return next ? conditions.map((c, i) => (i === index ? next : c)) : [...conditions];
  }
  if (current.values.includes(value)) return [...conditions];
  return toggleFilterValue(conditions, shape, value);
}

/** What the matcher needs to know beyond the task row itself. */
export type TaskFilterContext = {
  now: Date;
  tagIdsOf: (taskId: string) => readonly string[];
  isQueued: (taskId: string) => boolean;
  isBlocked: (taskId: string) => boolean;
  hasSubtasks: (taskId: string) => boolean;
  /** Live files on a task; unknown (not loaded yet) counts as none. */
  attachmentCount: (taskId: string) => number;
  /** What a task waits on (the kinds of its live Waiting on… entries). */
  waitingKindsOf?: (taskId: string) => readonly string[];
  /** The reader's own Inbox: its tasks read as Project `inbox`. */
  inboxId?: string | null;
};

/** Waiting on's "anything" value: a task with at least one entry. */
export const WAITING_ANY = "any";

const yesNo = (on: boolean) => [on ? "yes" : "no"];

/** A task's values on one dimension (several for tags and date choices). */
export function taskFilterValues(
  task: Task,
  dimension: string,
  ctx: TaskFilterContext,
): readonly string[] {
  switch (dimension as TaskFilterDimension) {
    case "project":
      // Every task is in a project or an Inbox: no "none".
      return [ctx.inboxId && task.bucketId === ctx.inboxId ? INBOX_VALUE : task.bucketId];
    case "assignee":
      return [task.assigneeId ?? NONE_VALUE];
    case "team":
      return [task.teamId ?? NONE_VALUE];
    case "creator":
      // A creator lost before TV-D1 matches no one.
      return task.creatorUnknown || !task.creatorId ? [] : [task.creatorId];
    case "tag": {
      const ids = ctx.tagIdsOf(task.id);
      return ids.length > 0 ? ids : [NONE_VALUE];
    }
    case "status":
      return [statusKeyOf(task)];
    case "priority":
      return [task.priority ?? NONE_VALUE];
    case "energy":
      return [task.energyLevel ?? NONE_VALUE];
    case "due":
      return dueFilterValues(task, ctx.now);
    case "scheduled":
      return scheduledFilterValues(task, ctx.now);
    case "completed":
      return completedFilterValues(task, ctx.now);
    case "waiting": {
      const kinds = ctx.waitingKindsOf?.(task.id) ?? [];
      return kinds.length > 0 ? [WAITING_ANY, ...new Set(kinds)] : [NONE_VALUE];
    }
    case "queued":
      return yesNo(ctx.isQueued(task.id));
    case "blocked":
      return yesNo(ctx.isBlocked(task.id));
    case "recurring":
      return yesNo(task.recurrence !== null);
    case "subtasks":
      return yesNo(ctx.hasSubtasks(task.id));
    case "attachments":
      return yesNo(ctx.attachmentCount(task.id) > 0);
    default:
      return [];
  }
}

/** The tasks that pass every condition. */
export function filterTasks<T extends Task>(
  tasks: readonly T[],
  conditions: readonly FilterCondition[],
  ctx: TaskFilterContext,
): T[] {
  if (conditions.length === 0) return [...tasks];
  return tasks.filter((task) =>
    matchesFilters(task, conditions, (t, dimension) => taskFilterValues(t, dimension, ctx)),
  );
}

/** Whether a Status condition asks for this status (is / is any of). */
function asksForStatus(conditions: readonly FilterCondition[], status: string): boolean {
  return conditions.some(
    (c) => c.dimension === "status" && c.operator !== "is_not" && c.values.includes(status),
  );
}

/**
 * Archived ("won't do") tasks are out of every scope until a Status filter
 * asks for them (tasks-v2 §6: "reachable through Filter → Status: Archived").
 */
export function showsArchived(conditions: readonly FilterCondition[]): boolean {
  return asksForStatus(conditions, "archived");
}

/**
 * A Status filter that asks for Done shows done tasks whatever Display →
 * Completed says: otherwise "Status is Done" would list nothing but
 * a "N completed · Show" line.
 */
export function showsDone(conditions: readonly FilterCondition[]): boolean {
  return asksForStatus(conditions, "done") || asksForCompletion(conditions);
}

/** A Completed filter that asks for a finished day ("Done last week"): it
 *  lists done tasks, so Display → Completed can't hide them. */
function asksForCompletion(conditions: readonly FilterCondition[]): boolean {
  return conditions.some(
    (c) =>
      c.dimension === "completed" &&
      c.operator !== "is_not" &&
      c.values.some((v) => v !== NONE_VALUE),
  );
}

/**
 * The statuses a Status filter lets through, or null without one: "is" /
 * "is any of" its values; "is not" every open or done status it doesn't
 * name (Won't do only joins when asked). The Board shows a group for each, so
 * "Status is Won't do" is one Won't do group, not three empty ones (TV-U2).
 */
export function statusesLetThrough(
  conditions: readonly FilterCondition[],
): ReadonlySet<StatusKey> | null {
  const condition = conditions.find((c) => c.dimension === "status");
  if (!condition) return null;
  if (condition.operator === "is_not") {
    const open: StatusKey[] = ["todo", "in_progress", "done"];
    return new Set(open.filter((s) => !condition.values.includes(s)));
  }
  const all: StatusKey[] = ["backlog", ...TASK_STATUSES];
  return new Set(all.filter((s) => condition.values.includes(s)));
}

/**
 * Backlog tasks join My tasks when a Status filter asks for them (TV-D9: they
 * sit out of it otherwise).
 */
export function showsBacklog(conditions: readonly FilterCondition[]): boolean {
  return asksForStatus(conditions, "backlog");
}

export type CaptureSeed = {
  /** Tags a new task starts with. */
  tagIds: string[];
  /** Absent = the capture's own default (me); null = Unassigned. */
  assigneeId?: string | null;
  priority?: PriorityLevel | null;
  /**
   * Where a Project filter files the task (MOD-141): absent = it names none;
   * null = the reader's Inbox; else a project id. The page turns it into the
   * capture's destination (`seededProject`), never part of the seed itself.
   */
  projectId?: string | null;
};

/**
 * The project New files into under a Project filter (MOD-141), so the new
 * task stays in the filtered list: the one the filter names when the reader
 * holds it (`projectIds`, their live projects). Null leaves the capture's own
 * default, the reader's Inbox: what "Project is Inbox" asks for, and the
 * answer when no Project filter applies or its project is gone.
 */
export function seededProject(seed: CaptureSeed, projectIds: readonly string[]): string | null {
  const id = seed.projectId;
  return id && projectIds.includes(id) ? id : null;
}

const PRIORITIES: readonly string[] = ["low", "medium", "high"];

/**
 * What New pre-fills inside a filtered scope (U2-5), so the task you create
 * shows where you are: the tag, assignee, priority and project (MOD-141) a
 * filter asks for. An "is" condition gives its value; "is any of" gives its
 * first. "Is not" gives nothing (it says what the task isn't, not what it is).
 */
export function captureSeed(conditions: readonly FilterCondition[]): CaptureSeed {
  const seed: CaptureSeed = { tagIds: [] };
  for (const c of conditions) {
    if (c.operator === "is_not") continue;
    const first = c.values[0];
    if (first === undefined) continue;
    if (c.dimension === "tag") {
      if (first !== NONE_VALUE) seed.tagIds.push(first);
    } else if (c.dimension === "assignee") {
      seed.assigneeId = first === NONE_VALUE ? null : first;
    } else if (c.dimension === "priority") {
      if (first === NONE_VALUE) seed.priority = null;
      else if (PRIORITIES.includes(first)) seed.priority = first as PriorityLevel;
    } else if (c.dimension === "project") {
      if (first !== NONE_VALUE) seed.projectId = first === INBOX_VALUE ? null : first;
    }
  }
  return seed;
}
