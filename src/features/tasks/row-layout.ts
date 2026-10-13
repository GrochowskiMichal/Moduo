// Row anatomy rules for the List (tasks-v3 §4, TV-U10; research
// views-list-upcoming.md §1): which columns a view shows, how wide each is,
// which drop first when the centre narrows, and the words each cell says.
//
// A row is: status icon · [handle] · title · quiet counts · [project] … then
// the fixed right-hand columns. Two presets (Display → Rows):
//   - Standard: priority · [energy] · date (the next session or due, whichever
//     comes first by day) · avatar · Focus mark; the project sits after the
//     counts where the scope doesn't imply it.
//   - Detailed: handle before the title, then Project › Section · status name
//     · priority · [energy] · Due · Next session · estimate/time · waiting on
//     · assignee + first name · updated · Focus mark, with sortable headers.
// The title is the only flexible track: it takes the free width and gives way
// first (call 42). Every other column is as wide as its widest value in view
// (call 41: dates, times and counts never truncate), the same on every row, so
// the meta lines up down the list; a column empty on every row collapses.

import {
  dayOffset,
  formatAge,
  formatDate,
  formatDay,
  formatDuration,
  formatDurationSeconds,
  formatTime,
  formatWhen,
} from "../../lib/time-format";
import { formatTimestamp, isUnfinished } from "./helpers";
import { estimateOf, isDrifted, type Task } from "./model";

/** The row properties Display can switch on and off, in column order. */
export const ROW_PROPERTIES = ["priority", "energy", "date", "assignee"] as const;
export type RowProperty = (typeof ROW_PROPERTIES)[number];

/** Energy is off on rows until someone turns it on (tasks-v2 §6). */
export const DEFAULT_ROW_PROPERTIES: readonly RowProperty[] = ["priority", "date", "assignee"];

/** Display → Rows. */
export type RowPreset = "standard" | "detailed";

/** Which columns the rows of one view render. */
export type RowColumns = Readonly<{
  priority: boolean;
  energy: boolean;
  /** Standard's one date. */
  date: boolean;
  /** The assignee's avatar (both presets). */
  assignee: boolean;
  /** The Focus mark. */
  queue: boolean;
  /** Some row is in my queue and someone else's: its cell fits both marks. */
  queueWide: boolean;
  /** Detailed: `MOD-142`, before the title. */
  handle: boolean;
  /** Detailed: "Project › Section". */
  project: boolean;
  /** Detailed: the status name ("In review", "Won’t do"). */
  status: boolean;
  /** Detailed: the due date. */
  due: boolean;
  /** Detailed: the next work session. */
  session: boolean;
  /** Detailed: estimate and tracked time ("1h 20m / ~4h"). */
  time: boolean;
  /** Detailed: "on Anna · 2d". */
  waiting: boolean;
  /** Detailed: the assignee's first name beside the avatar. */
  assigneeName: boolean;
  /** Detailed: "2d" since the last change. */
  updated: boolean;
  /** Detailed columns left out for room (the header's "+n"). */
  hidden: number;
}>;

const NO_COLUMNS: RowColumns = {
  priority: false,
  energy: false,
  date: false,
  assignee: false,
  queue: false,
  queueWide: false,
  handle: false,
  project: false,
  status: false,
  due: false,
  session: false,
  time: false,
  waiting: false,
  assigneeName: false,
  updated: false,
  hidden: 0,
};

/** Every Standard column on: a row rendered on its own (tests, stories). */
export const ALL_ROW_COLUMNS: RowColumns = {
  ...NO_COLUMNS,
  priority: true,
  date: true,
  assignee: true,
  queue: true,
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
  /** The workspace's task key ("MOD"): Detailed's handles need it. */
  taskKey?: string | null;
  /** Waiting on someone or something (TV-D10). */
  isWaiting?: (taskId: string) => boolean;
};

/**
 * The columns for a view, from every row it can render (pass the shown rows
 * and their subtasks, so expanding a parent never pops a column in). A column
 * is on when its property is on and at least one row has a value for it;
 * Detailed always names the project, the status and the last change.
 */
export function rowColumns(tasks: readonly Task[], ctx: RowColumnsContext): RowColumns {
  const on = new Set(ctx.properties);
  const any = (test: (task: Task) => boolean) => tasks.some(test);
  const detailed = ctx.rows === "detailed";
  const some = tasks.length > 0;
  const assignee = on.has("assignee") && ctx.showAssignee && any((t) => !!t.assigneeId);
  return {
    priority: on.has("priority") && any((t) => t.priority !== null),
    energy: on.has("energy") && any((t) => t.energyLevel !== null),
    date: !detailed && on.has("date") && any((t) => t.scheduledAt !== null || t.dueDate !== null),
    assignee,
    // Done and archived tasks can't be queued, so they never carry the mark.
    // Read-only, the mark only shows what someone has queued.
    queue: any(
      (t) => isUnfinished(t) && (ctx.canEdit || ctx.isQueued(t.id) || ctx.isClaimed(t.id)),
    ),
    queueWide: any((t) => isUnfinished(t) && ctx.isQueued(t.id) && ctx.isClaimed(t.id)),
    handle: detailed && !!ctx.taskKey && any((t) => typeof t.number === "number"),
    project: detailed && some,
    status: detailed && some,
    due: detailed && on.has("date") && any((t) => t.dueDate !== null),
    session: detailed && on.has("date") && any((t) => t.scheduledAt !== null),
    time: detailed && any((t) => rowTime(t) !== null),
    waiting: detailed && !!ctx.isWaiting && any((t) => ctx.isWaiting?.(t.id) ?? false),
    assigneeName: detailed && assignee,
    updated: detailed && some,
    hidden: 0,
  };
}

// ── Widths ──────────────────────────────────────────────────────────────────

/** The columns whose width follows their values (the rest are icon-wide). */
export const SIZED_COLUMNS = [
  "handle",
  "project",
  "status",
  "date",
  "due",
  "session",
  "time",
  "waiting",
  "assignee",
  "updated",
] as const;
export type SizedColumn = (typeof SIZED_COLUMNS)[number];

/** The words each sized cell says on one row (null: nothing). */
export type RowTexts = Partial<Record<SizedColumn, string | null>>;

/** Detailed's header labels (also the narrowest each column gets). */
export const COLUMN_LABELS: Record<Exclude<SizedColumn, "handle" | "date">, string> = {
  project: "Project",
  status: "Status",
  due: "Due",
  session: "Next session",
  time: "Time",
  waiting: "Waiting on",
  assignee: "Assignee",
  updated: "Updated",
};

/** Room a cell takes beside its words, in `ch`: an icon and its gap. */
const CELL_EXTRA_CH: Record<SizedColumn, number> = {
  handle: 1,
  project: 1,
  status: 3,
  date: 3,
  due: 1,
  session: 3,
  time: 1,
  waiting: 1,
  assignee: 4,
  updated: 1,
};

/**
 * A column grows with its widest value only so far: past this a value wraps
 * the cell's own width (a project or a waiting note can be a sentence).
 */
const MAX_CH: Partial<Record<SizedColumn, number>> = {
  project: 32,
  waiting: 24,
  assignee: 18,
};

/**
 * Each sized column's width in `ch` (of the cells' text-xs face): its widest
 * value in view plus its icon, never narrower than its header label. The list
 * sets these as CSS variables (`--tl-col-*`), so every row and the header
 * share them without a row redrawing when a width changes.
 */
export function columnWidths(
  rows: Iterable<RowTexts>,
  opts: { headers?: boolean } = {},
): Record<SizedColumn, number> {
  const widest = Object.fromEntries(SIZED_COLUMNS.map((c) => [c, 0])) as Record<
    SizedColumn,
    number
  >;
  for (const row of rows) {
    for (const col of SIZED_COLUMNS) {
      const text = row[col];
      if (text) widest[col] = Math.max(widest[col], text.length);
    }
  }
  const labels: Partial<Record<SizedColumn, string>> = COLUMN_LABELS;
  const out = {} as Record<SizedColumn, number>;
  for (const col of SIZED_COLUMNS) {
    const label = opts.headers ? (labels[col] ?? "") : "";
    const words = Math.max(widest[col] + (widest[col] > 0 ? CELL_EXTRA_CH[col] : 0), label.length);
    out[col] = Math.min(words, MAX_CH[col] ?? Number.POSITIVE_INFINITY);
  }
  return out;
}

/** The CSS variable a sized column's width lives in. */
export function columnVar(col: SizedColumn): `--tl-col-${SizedColumn}` {
  return `--tl-col-${col}`;
}

/** Detailed's columns, in the order they drop as the centre narrows (research §1). */
export const DETAILED_DROP_ORDER = [
  "updated",
  "time",
  "session",
  "waiting",
  "status",
  "project",
  "assigneeName",
  "handle",
] as const satisfies ReadonlyArray<keyof RowColumns>;

/** About one `ch` of the cells' face in px, for the room sums below. */
const CH_PX = 7;
const GAP_PX = 12;
const ICON_PX = 16;
/** The title's least room: Standard 160 px, Detailed 200 px (research §1). */
const TITLE_MIN_PX = { standard: 160, detailed: 200 } as const;
/** Lead control, padding and the quiet counts' usual room. */
const ROW_FIXED_PX = 24 + GAP_PX + 18 + 48;

function columnPx(
  col: keyof RowColumns,
  cols: RowColumns,
  widths: Record<SizedColumn, number>,
): number {
  if (!cols[col] || col === "hidden" || col === "queueWide") return 0;
  switch (col) {
    case "priority":
    case "energy":
      return ICON_PX + GAP_PX;
    case "queue":
      return (cols.queueWide ? ICON_PX * 2 + 4 : ICON_PX) + GAP_PX;
    case "assignee":
      return cols.assigneeName ? 0 : ICON_PX + 4 + GAP_PX;
    case "assigneeName":
      return widths.assignee * CH_PX + GAP_PX;
    default:
      return widths[col as SizedColumn] * CH_PX + GAP_PX;
  }
}

/**
 * The columns that fit `width` px of row: Detailed drops whole columns in
 * {@link DETAILED_DROP_ORDER} until the title keeps its least room (the
 * glyph, title, due, avatar and Focus mark never drop). `hidden` counts the
 * dropped ones for the header's "+n". Standard drops nothing: its few columns
 * are icon-wide and the title gives way.
 */
export function fitColumns(
  cols: RowColumns,
  widths: Record<SizedColumn, number>,
  width: number,
  preset: RowPreset,
): RowColumns {
  if (preset !== "detailed" || !Number.isFinite(width) || width <= 0) return cols;
  const keys = Object.keys(cols) as Array<keyof RowColumns>;
  const used = (c: RowColumns) =>
    ROW_FIXED_PX + TITLE_MIN_PX.detailed + keys.reduce((sum, k) => sum + columnPx(k, c, widths), 0);
  let next = cols;
  let hidden = 0;
  for (const col of DETAILED_DROP_ORDER) {
    if (used(next) <= width) break;
    if (!next[col]) continue;
    next = { ...next, [col]: false };
    hidden += 1;
  }
  return hidden === 0 ? cols : { ...next, hidden };
}

// ── What the cells say ──────────────────────────────────────────────────────

/** `MOD-142`; null without a number (not saved yet) or a key. */
export function handleLabel(
  taskKey: string | null | undefined,
  number: number | null | undefined,
): string | null {
  return taskKey && typeof number === "number" ? `${taskKey}-${number}` : null;
}

/** "Acme rebrand › Design"; the project alone when the task has no section. */
export function projectLabel(project: string, section: string | null): string {
  return section ? `${project} › ${section}` : project;
}

/** Detailed's Due cell: "Today", "Fri", "Oct 16". */
export function dueLabel(task: Pick<Task, "dueDate">, now: Date = new Date()): string | null {
  return task.dueDate ? formatShortDate(task.dueDate, now) || null : null;
}

/** Detailed's Next session cell: "3:00 PM" today, else "Fri, 9:00 AM". */
export function sessionLabel(
  task: Pick<Task, "scheduledAt">,
  now: Date = new Date(),
): string | null {
  return task.scheduledAt ? formatWhen(task.scheduledAt, now) || null : null;
}

/** Detailed's Updated cell: "now", "3h", "2d". */
export function updatedLabel(task: Pick<Task, "updatedAt">, now: Date = new Date()): string {
  return formatAge(task.updatedAt, now);
}

/**
 * Detailed's time cell: tracked time and the estimate, "1h 20m / ~4h", or
 * either one alone ("1h 20m", "~4h"); null when the task has neither.
 */
export function rowTime(
  task: Pick<Task, "durationMinutes" | "estimateMinutes" | "timeSpentSeconds">,
): string | null {
  const tracked = task.timeSpentSeconds > 0 ? formatDurationSeconds(task.timeSpentSeconds) : null;
  const minutes = estimateOf(task);
  const estimate = minutes && minutes > 0 ? `~${formatDuration(minutes)}` : null;
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
