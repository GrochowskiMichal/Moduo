// Row anatomy rules for the List (tasks-v2 §6, TV-U1): which fixed right-hand
// columns a view shows, and which one date a row's date column carries.
//
// A row is: checkbox · title · quiet counts · [priority] [energy] [date]
// [assignee] [queue]. The columns are fixed-width so their contents line up
// down the list, and a column that would be empty on every row of the view
// collapses. Display → "Show on rows" turns a property column off (energy is
// off by default; it always shows in the detail panel).

import { formatTimestamp, isOpen } from "./helpers";
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
  }
>;

/** Every column on: a row rendered on its own (tests, stories) shows everything. */
export const ALL_ROW_COLUMNS: RowColumns = {
  priority: true,
  energy: false,
  date: true,
  assignee: true,
  queue: true,
  queueWide: false,
};

export type RowColumnsContext = {
  /** Display → "Show on rows". */
  properties: readonly string[];
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
  return {
    priority: on.has("priority") && any((t) => t.priority !== null),
    energy: on.has("energy") && any((t) => t.energyLevel !== null),
    date: on.has("date") && any((t) => t.scheduledAt !== null || t.dueDate !== null),
    assignee: on.has("assignee") && ctx.showAssignee && any((t) => !!t.assigneeId),
    // Done and archived tasks can't be queued, so they never carry the mark.
    // Read-only, the mark only shows what someone has queued.
    queue: any((t) => isOpen(t) && (ctx.canEdit || ctx.isQueued(t.id) || ctx.isClaimed(t.id))),
    queueWide: any((t) => isOpen(t) && ctx.isQueued(t.id) && ctx.isClaimed(t.id)),
  };
}

// ── The date column ─────────────────────────────────────────────────────────

/** The one date a row shows. */
export type RowDate = {
  kind: "scheduled" | "due";
  /** Short enough for the column: "10:00 AM", "Thu", "Oct 14". */
  label: string;
  /** Scheduled time has passed on an open task: quiet emphasis, never red. */
  drifted: boolean;
  /** Both dates in full, for the tooltip and screen readers. */
  description: string;
};

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayOffset(d: Date, now: Date): number {
  return Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
}

/**
 * A date as short as the column allows: Today / Tomorrow / Yesterday, the
 * weekday for the rest of the coming week, else the month and day (with the
 * year when it isn't this year's).
 */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const offset = dayOffset(d, now);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  if (offset > 1 && offset < 7) return WEEKDAY_FMT.format(d);
  return d.getFullYear() === now.getFullYear() ? DAY_FMT.format(d) : DAY_YEAR_FMT.format(d);
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
  const parts: string[] = [];
  if (scheduled) parts.push(`Scheduled ${formatTimestamp(task.scheduledAt)}`);
  if (due) parts.push(`Due ${DAY_YEAR_FMT.format(due)}`);
  const description = parts.join(" · ");
  const useDue = due && (!scheduled || startOfDay(due) < startOfDay(scheduled));
  if (useDue && task.dueDate) {
    return { kind: "due", label: formatShortDate(task.dueDate, now), drifted: false, description };
  }
  const at = scheduled as Date;
  return {
    kind: "scheduled",
    label: dayOffset(at, now) === 0 ? TIME_FMT.format(at) : formatShortDate(at.toISOString(), now),
    drifted: isDrifted(task, now),
    description,
  };
}

function validDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
