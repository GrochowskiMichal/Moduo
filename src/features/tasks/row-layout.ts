// Row anatomy rules for the List (tasks-v2 §6, TV-U1): which fixed right-hand
// columns a view shows, and which one date a row's date column carries.
//
// A row is: checkbox · title · quiet counts · [status name] [priority]
// [energy] [date] [time] [assignee] [queue]. The columns are fixed-width so
// their contents line up down the list, and a column that would be empty on
// every row of the view collapses. Display → "Show on rows" turns a property
// column off (energy is off by default; it always shows in the detail panel).
//
// Display → Rows (tasks-v3 §4, TV-U2): Standard is the row above without the
// status name and time; Detailed adds the status name, estimate / tracked
// time, the assignee's name beside the avatar and the project on every row.
// The rest of Detailed (handle, Project › Section, Due and Next session as
// two columns, waiting, updated, sortable headers) is the List rebuild's
// (TV-U10), on the kit Row.

import {
  dayOffset,
  formatDate,
  formatDay,
  formatDuration,
  formatDurationSeconds,
  formatTime,
} from "../../lib/time-format";
import { formatTimestamp, isUnfinished } from "./helpers";
import { isDrifted, type Task } from "./model";

/** The row properties Display can switch on and off, in column order. */
export const ROW_PROPERTIES = ["priority", "energy", "date", "assignee"] as const;
export type RowProperty = (typeof ROW_PROPERTIES)[number];

/** Energy is off on rows until someone turns it on (tasks-v2 §6). */
export const DEFAULT_ROW_PROPERTIES: readonly RowProperty[] = ["priority", "date", "assignee"];

/** Which right-hand columns the rows of one view render. */
export type RowColumns = Readonly<
  Record<RowProperty | "queue", boolean> & {
    /** Some row is in my queue and someone else's: its cell fits both marks. */
    queueWide: boolean;
    /** Detailed: the status name ("In progress", "Won’t do"). */
    status: boolean;
    /** Detailed: estimate and tracked time ("1h 20m / ~4h"). */
    time: boolean;
    /** Detailed: the assignee's first name beside the avatar. */
    assigneeName: boolean;
  }
>;

/** Every Standard column on: a row rendered on its own (tests, stories). */
export const ALL_ROW_COLUMNS: RowColumns = {
  priority: true,
  energy: false,
  date: true,
  assignee: true,
  queue: true,
  queueWide: false,
  status: false,
  time: false,
  assigneeName: false,
};

export type RowColumnsContext = {
  /** Display → "Show on rows". */
  properties: readonly string[];
  /** Display → Rows. Standard when absent. */
  rows?: RowPreset;
  /** A team workspace, outside My tasks (where every row is mine, D4-4). */
  showAssignee: boolean;
  canEdit: boolean;
  /** In my queue. */
  isQueued: (taskId: string) => boolean;
  /** In someone else's queue (a claim). */
  isClaimed: (taskId: string) => boolean;
};

/**
 * The columns for a view, from every row it can render (pass the shown rows
 * and their subtasks, so expanding a parent never pops a column in). A column
 * is on when its property is on and at least one row has a value for it.
 */
export function rowColumns(tasks: readonly Task[], ctx: RowColumnsContext): RowColumns {
  const on = new Set(ctx.properties);
  const any = (test: (task: Task) => boolean) => tasks.some(test);
  const detailed = ctx.rows === "detailed";
  const assignee = on.has("assignee") && ctx.showAssignee && any((t) => !!t.assigneeId);
  return {
    status: detailed && tasks.length > 0,
    priority: on.has("priority") && any((t) => t.priority !== null),
    energy: on.has("energy") && any((t) => t.energyLevel !== null),
    date: on.has("date") && any((t) => t.scheduledAt !== null || t.dueDate !== null),
    time: detailed && any((t) => rowTime(t) !== null),
    assignee,
    assigneeName: detailed && assignee,
    // Done and archived tasks can't be queued, so they never carry the mark.
    // Read-only, the mark only shows what someone has queued.
    queue: any(
      (t) => isUnfinished(t) && (ctx.canEdit || ctx.isQueued(t.id) || ctx.isClaimed(t.id)),
    ),
    queueWide: any((t) => isUnfinished(t) && ctx.isQueued(t.id) && ctx.isClaimed(t.id)),
  };
}

/** Display → Rows. */
export type RowPreset = "standard" | "detailed";

/**
 * Detailed's time cell: tracked time and the estimate, "1h 20m / ~4h", or
 * either one alone ("1h 20m", "~4h"); null when the task has neither.
 */
export function rowTime(task: Pick<Task, "durationMinutes" | "timeSpentSeconds">): string | null {
  const tracked = task.timeSpentSeconds > 0 ? formatDurationSeconds(task.timeSpentSeconds) : null;
  const estimate =
    task.durationMinutes && task.durationMinutes > 0
      ? `~${formatDuration(task.durationMinutes)}`
      : null;
  if (tracked && estimate) return `${tracked} / ${estimate}`;
  return tracked ?? estimate;
}

// ── The date column ─────────────────────────────────────────────────────────

/** The one date a row shows. */
export type RowDate = {
  kind: "scheduled" | "due";
  /** Short enough for the column: "10:00 AM", "Thu", "Oct 14". */
  label: string;
  /** Scheduled time has passed on an open task: quiet emphasis, never red. */
  drifted: boolean;
  /** Both dates in full, the shown one first: the tooltip and the cell's name. */
  description: string;
};

/**
 * A date as short as the column allows: Today / Tomorrow / Yesterday, the
 * weekday for the rest of the coming week, else the month and day (with the
 * year when it isn't this year's) — the one grammar, src/lib/time-format.ts.
 */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  return formatDay(iso, now);
}

/**
 * The date a row's column shows: the scheduled time or the due date, whichever
 * comes first by day (the next date that matters). On the same day the
 * scheduled time wins, since it says more. A time scheduled for today shows as
 * the time.
 */
export function rowDate(
  task: Pick<Task, "scheduledAt" | "dueDate" | "status">,
  now: Date = new Date(),
): RowDate | null {
  const scheduled = validDate(task.scheduledAt);
  const due = validDate(task.dueDate);
  if (!scheduled && !due) return null;
  const useDue = due && (!scheduled || dayOffset(due, scheduled) < 0);
  // The date shown comes first, so the cell's name matches the editor it opens.
  const parts: string[] = [];
  if (scheduled) parts.push(`Scheduled ${formatTimestamp(task.scheduledAt)}`);
  if (due) parts[useDue ? "unshift" : "push"](`Due ${formatDate(due, now)}`);
  const description = parts.join(" · ");
  if (useDue && task.dueDate) {
    return { kind: "due", label: formatShortDate(task.dueDate, now), drifted: false, description };
  }
  const at = scheduled as Date;
  return {
    kind: "scheduled",
    label: dayOffset(at, now) === 0 ? formatTime(at) : formatDay(at, now),
    drifted: isDrifted(task, now),
    description,
  };
}

function validDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
