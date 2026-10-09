// Tasks' Filter (tasks-v2 §7, TV-U2): the dimensions, what each task's values
// are on them, and the rules around them. Pure: the conditions are DS-4's
// plain `FilterCondition` data, matched with `matchesFilters`, so they persist
// through the view prefs as-is and test without rendering. The options and
// icons the menu shows are added by the page (use-tasks-filters.tsx), since
// they need the workspace's members and tags.
//
// Operators: is / is not / any of, AND across dimensions. Yes/no dimensions
// (In my queue, Blocked, …) offer only "is".

import {
  type FilterCondition,
  type FilterDimension,
  matchesFilters,
  normalizeCondition,
  sanitizeConditions,
  toggleFilterValue,
} from "../../components/ui/filter-model";
import { dueFilterValues, scheduledFilterValues } from "./day-buckets";
import type { PriorityLevel, Task } from "./model";

export const TASK_FILTER_DIMENSIONS = [
  "assignee",
  "creator",
  "tag",
  "status",
  "priority",
  "energy",
  "due",
  "scheduled",
  "queued",
  "blocked",
  "recurring",
  "subtasks",
  "attachments",
] as const;
export type TaskFilterDimension = (typeof TASK_FILTER_DIMENSIONS)[number];

/** The value for "nobody" / "no level" / "no tag" on a dimension. */
export const NONE_VALUE = "none";

const YES_NO_DIMENSIONS: ReadonlySet<string> = new Set([
  "queued",
  "blocked",
  "recurring",
  "subtasks",
  "attachments",
]);

export const TASK_FILTER_LABELS: Record<TaskFilterDimension, string> = {
  assignee: "Assignee",
  creator: "Creator",
  tag: "Tag",
  status: "Status",
  priority: "Priority",
  energy: "Energy",
  due: "Due date",
  scheduled: "Scheduled",
  queued: "In my queue",
  blocked: "Blocked",
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
};

const yesNo = (on: boolean) => [on ? "yes" : "no"];

/** A task's values on one dimension (several for tags and date choices). */
export function taskFilterValues(
  task: Task,
  dimension: string,
  ctx: TaskFilterContext,
): readonly string[] {
  switch (dimension as TaskFilterDimension) {
    case "assignee":
      return [task.assigneeId ?? NONE_VALUE];
    case "creator":
      // A creator lost before TV-D1 matches no one.
      return task.creatorUnknown || !task.creatorId ? [] : [task.creatorId];
    case "tag": {
      const ids = ctx.tagIdsOf(task.id);
      return ids.length > 0 ? ids : [NONE_VALUE];
    }
    case "status":
      return [task.status];
    case "priority":
      return [task.priority ?? NONE_VALUE];
    case "energy":
      return [task.energyLevel ?? NONE_VALUE];
    case "due":
      return dueFilterValues(task, ctx.now);
    case "scheduled":
      return scheduledFilterValues(task, ctx.now);
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
 * "N completed · show" lines.
 */
export function showsDone(conditions: readonly FilterCondition[]): boolean {
  return asksForStatus(conditions, "done");
}

export type CaptureSeed = {
  /** Tags a new task starts with. */
  tagIds: string[];
  /** Absent = the capture's own default (me); null = Unassigned. */
  assigneeId?: string | null;
  priority?: PriorityLevel | null;
};

const PRIORITIES: readonly string[] = ["low", "medium", "high"];

/**
 * What New pre-fills inside a filtered scope (U2-5), so the task you create
 * shows where you are: the tag, assignee and priority a filter asks for. An
 * "is" condition gives its value; "is any of" gives its first. "Is not" gives
 * nothing (it says what the task isn't, not what it is).
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
    }
  }
  return seed;
}
