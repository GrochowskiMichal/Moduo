// Pure geometry for the Tasks Timeline view (specs/tasks-timeline.md).
//
// Everything the view renders — the axis window, bar spans + the fade grammar,
// bucket lanes, row layout, dependency-arrow anchors, tray membership, and the
// day-snapping date math the drag layer (TL-2) writes through — is computed
// here, in local time, with no React and no IO. The view is a projection of
// this module's output.
//
// The bar grammar (one concept, no milestone diamonds): a solid edge is a
// known date, a faded edge is an unknown one. scheduledAt+dueDate = solid
// span; scheduledAt only = solid left, fade right; dueDate only = fade left,
// solid right; neither = the unscheduled tray, never the axis.

import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

import { isOpen } from "./helpers";
import type { Task, TaskRelation } from "./model";

// ── Zoom ─────────────────────────────────────────────────────────────────────

export type TimelineZoom = "week" | "month" | "quarter";

export const TIMELINE_ZOOMS: TimelineZoom[] = ["week", "month", "quarter"];

/** Pixels per day at each zoom level. */
export const DAY_WIDTH: Record<TimelineZoom, number> = {
  week: 120,
  month: 40,
  quarter: 14,
};

/** How far the axis extends past today/the dated extent, per zoom (days). */
const WINDOW_PAD_DAYS: Record<TimelineZoom, number> = {
  week: 21,
  month: 45,
  quarter: 120,
};

/**
 * Hard cap on how far from today the dated extent may stretch the window, per
 * zoom. One mistyped year (2126 for 2026) must not inflate the canvas to a
 * century of ticks and gridlines — bars past the cap simply render off-axis
 * until the date is fixed.
 */
const WINDOW_MAX_EXTENT_DAYS: Record<TimelineZoom, number> = {
  week: 120,
  month: 400,
  quarter: 800,
};

/** Guard for the persisted zoom preference (Month is the spec default). */
export function sanitizeTimelineZoom(raw: unknown): TimelineZoom {
  return raw === "week" || raw === "quarter" ? raw : "month";
}

// ── Pixel constants (exported so the view and the layout math never drift) ──

/** Length of a faded (unknown-date) bar edge. Encodes direction, not data. */
export const FADE_PX = 80;
/** Two-row sticky date header (month labels + ticks). */
export const HEADER_H = 44;
/** One bucket swimlane header row. */
export const LANE_HEADER_H = 28;
/** One task row inside a lane. */
export const ROW_H = 36;
/** Bar height, vertically centered in its row. */
export const BAR_H = 26;
/** Breathing room under a lane's last row. */
const LANE_PAD_B = 8;
/** Below this bar width the title renders beside the bar, not inside it. */
export const TITLE_INSIDE_MIN_PX = 110;

// ── Axis window ──────────────────────────────────────────────────────────────

export type AxisWindow = {
  zoom: TimelineZoom;
  /** Local start-of-day of the first rendered day. */
  start: Date;
  totalDays: number;
  dayWidth: number;
};

function taskDay(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

/**
 * The rendered day range: the dated tasks' extent unioned with today, padded
 * per zoom so there is always past/future to scroll into. Stable for a given
 * (tasks, zoom, today) — scrolling never extends it (v1: no infinite axis).
 */
export function axisWindow(tasks: Task[], zoom: TimelineZoom, now: Date = new Date()): AxisWindow {
  const today = startOfDay(now);
  let min = today;
  let max = today;
  for (const task of tasks) {
    for (const day of [taskDay(task.scheduledAt), taskDay(task.dueDate)]) {
      if (!day) continue;
      if (day < min) min = day;
      if (day > max) max = day;
    }
  }
  // Clamp the extent so one absurd date can't explode the canvas.
  const cap = WINDOW_MAX_EXTENT_DAYS[zoom];
  const floor = addDays(today, -cap);
  const ceil = addDays(today, cap);
  if (min < floor) min = floor;
  if (max > ceil) max = ceil;
  const pad = WINDOW_PAD_DAYS[zoom];
  const start = addDays(min, -pad);
  const end = addDays(max, pad);
  return {
    zoom,
    start,
    totalDays: differenceInCalendarDays(end, start) + 1,
    dayWidth: DAY_WIDTH[zoom],
  };
}

/** Calendar-day index of `day` within the window (0 = the first day). */
export function dayIndex(window: AxisWindow, day: Date): number {
  return differenceInCalendarDays(day, window.start);
}

/** Left x of a local day's column. */
export function xForDay(window: AxisWindow, day: Date): number {
  return dayIndex(window, day) * window.dayWidth;
}

/** The local day under a canvas x, clamped to the window's range. */
export function dayAtX(window: AxisWindow, x: number): Date {
  const idx = Math.floor(x / window.dayWidth);
  return addDays(window.start, Math.max(0, Math.min(window.totalDays - 1, idx)));
}

/**
 * The today-line x: today's column plus the elapsed fraction of the local day
 * (DST-honest — the fraction is measured against the day's real duration).
 */
export function todayLineX(window: AxisWindow, now: Date = new Date()): number {
  const dayStart = startOfDay(now);
  const dayMs = startOfDay(addDays(now, 1)).getTime() - dayStart.getTime();
  const fraction = (now.getTime() - dayStart.getTime()) / dayMs;
  return (dayIndex(window, dayStart) + fraction) * window.dayWidth;
}

// ── Axis ticks (header labels + gridlines) ──────────────────────────────────

export type AxisTick = { x: number; label: string };
export type MonthSegment = { x: number; width: number; label: string };

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: "short" });
const MONTH_YEAR_FMT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const WEEKDAY_DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });

/**
 * Tick marks per zoom — week: one per day ("Mon 6"); month: one per Monday
 * (day of month); quarter: one per month start ("Jul"). Ticks double as the
 * grid-line x positions.
 */
export function axisTicks(window: AxisWindow): AxisTick[] {
  const ticks: AxisTick[] = [];
  for (let i = 0; i < window.totalDays; i++) {
    const day = addDays(window.start, i);
    if (window.zoom === "week") {
      ticks.push({ x: i * window.dayWidth, label: WEEKDAY_DAY_FMT.format(day) });
    } else if (window.zoom === "month") {
      if (day.getDay() === 1) ticks.push({ x: i * window.dayWidth, label: String(day.getDate()) });
    } else if (day.getDate() === 1) {
      ticks.push({ x: i * window.dayWidth, label: MONTH_FMT.format(day) });
    }
  }
  return ticks;
}

/** Month bands for the header's context row ("July 2026" spans). */
export function monthSegments(window: AxisWindow): MonthSegment[] {
  const segments: MonthSegment[] = [];
  let segStart = 0;
  let current = window.start.getMonth();
  for (let i = 1; i <= window.totalDays; i++) {
    const day = i < window.totalDays ? addDays(window.start, i) : null;
    if (day && day.getMonth() === current) continue;
    segments.push({
      x: segStart * window.dayWidth,
      width: (i - segStart) * window.dayWidth,
      label: MONTH_YEAR_FMT.format(addDays(window.start, segStart)),
    });
    if (day) {
      segStart = i;
      current = day.getMonth();
    }
  }
  return segments;
}

// ── Bars ─────────────────────────────────────────────────────────────────────

export type TimelineBar = {
  task: Task;
  /** Local day the bar's left (solid or healed) edge sits on. */
  startDay: Date;
  /** Local day of the known end, when there is one. */
  endDay: Date | null;
  x: number;
  width: number;
  /** Solid = the date on that side is known; faded = open/unknown. */
  solidLeft: boolean;
  solidRight: boolean;
  /** Open task whose known end (or lone start) is past — the ambient dot. */
  pastEnd: boolean;
  done: boolean;
  /** Done or Won't do: drawn closed, never a blocker (TV-U2). */
  closed: boolean;
};

/**
 * Bar geometry for one task, or null when it is undated (tray, not axis).
 * Bad data (due before scheduled) heals to a 1-day bar at scheduledAt.
 */
export function barForTask(
  task: Task,
  window: AxisWindow,
  now: Date = new Date(),
): TimelineBar | null {
  const sched = taskDay(task.scheduledAt);
  let due = taskDay(task.dueDate);
  if (!sched && !due) return null;

  // Bad data: an end before the start renders as a 1-day solid bar at
  // scheduledAt; fixing either date heals it (spec §Edge cases).
  const badData = !!sched && !!due && due < sched;
  if (badData) due = sched;

  const startDay = sched ?? due!;
  const endDay = due;
  const dw = window.dayWidth;

  let x: number;
  let width: number;
  if (sched && due) {
    x = xForDay(window, sched);
    width = (dayIndex(window, due) - dayIndex(window, sched) + 1) * dw;
  } else if (sched) {
    // Start known, end open — the right side fades out.
    x = xForDay(window, sched);
    width = dw + FADE_PX;
  } else {
    // End known, start open — the bar fades in toward the due day.
    x = xForDay(window, due!) - FADE_PX;
    width = dw + FADE_PX;
  }

  const open = isOpen(task);
  const knownEnd = endDay ?? startDay;
  return {
    task,
    startDay,
    endDay,
    x,
    width,
    solidLeft: !!sched,
    solidRight: !!due,
    pastEnd: open && dayIndex(window, knownEnd) < dayIndex(window, startOfDay(now)),
    done: task.status === "done",
    closed: !open,
  };
}

// ── Lanes (bucket swimlanes) + tray ──────────────────────────────────────────

export type LaneDef = { id: string; name: string };

export type TimelineLane = {
  bucketId: string;
  name: string;
  collapsed: boolean;
  /** Row-ordered bars; empty when collapsed (collapsed lanes have no rows). */
  bars: TimelineBar[];
  /** Dated-task count — shown on the header even when collapsed. */
  count: number;
};

export type TimelineRollup = {
  lanes: TimelineLane[];
  /** Undated tasks — the unscheduled tray's chips (open work only). */
  tray: Task[];
};

/**
 * Partition scope tasks into bucket swimlanes (dated) and the tray (undated).
 * Lane order follows `laneDefs` (Inbox first, then position-sorted buckets —
 * the rail's order); only lanes with at least one dated task render, matching
 * how List's "All" grouping skips empty buckets. Within a lane, bars sort by
 * their leftmost day (known start first on ties), then stored position.
 */
export function buildTimelineRollup(opts: {
  tasks: Task[];
  laneDefs: LaneDef[];
  collapsedIds: ReadonlySet<string>;
  window: AxisWindow;
  now?: Date;
}): TimelineRollup {
  const { tasks, laneDefs, collapsedIds, window } = opts;
  const now = opts.now ?? new Date();

  const tray: Task[] = [];
  const scopeIds = new Set(tasks.map((t) => t.id));
  const barsByBucket = new Map<string, TimelineBar[]>();
  for (const task of tasks) {
    const bar = barForTask(task, window, now);
    if (!bar) {
      // The tray exists to schedule work — done tasks have nothing to
      // schedule, and an undated subtask whose parent is in scope is covered
      // by the parent (List/Board hide nested subtasks the same way; dated
      // subtasks DO get their own bars, per spec).
      const nested = !!task.parentId && task.parentId !== task.id && scopeIds.has(task.parentId);
      if (isOpen(task) && !nested) tray.push(task);
      continue;
    }
    const list = barsByBucket.get(task.bucketId);
    if (list) list.push(bar);
    else barsByBucket.set(task.bucketId, [bar]);
  }

  const defs = [...laneDefs];
  // Safety net: a task whose bucket isn't among the defs still gets a lane.
  for (const bucketId of barsByBucket.keys()) {
    if (!defs.some((d) => d.id === bucketId)) defs.push({ id: bucketId, name: "Other" });
  }

  const lanes: TimelineLane[] = [];
  for (const def of defs) {
    const bars = barsByBucket.get(def.id);
    if (!bars || bars.length === 0) continue;
    // Order by the leftmost DAY, not pixel x — a due-only bar's fade offset
    // (-FADE_PX) is presentation, and sorting on it would reorder rows per
    // zoom level. Known starts win ties; stored position settles the rest.
    bars.sort((a, b) => {
      const dayDiff = a.startDay.getTime() - b.startDay.getTime();
      if (dayDiff !== 0) return dayDiff;
      if (a.solidLeft !== b.solidLeft) return a.solidLeft ? -1 : 1;
      return a.task.position < b.task.position ? -1 : a.task.position > b.task.position ? 1 : 0;
    });
    const collapsed = collapsedIds.has(def.id);
    lanes.push({
      bucketId: def.id,
      name: def.name,
      collapsed,
      bars: collapsed ? [] : bars,
      count: bars.length,
    });
  }
  return { lanes, tray };
}

// ── Row layout (y positions) ─────────────────────────────────────────────────

export type PositionedBar = TimelineBar & {
  /** Row top, relative to the lanes region (below the sticky header). */
  y: number;
};

export type TimelineLayout = {
  totalHeight: number;
  /** Lane header tops, in lane order, relative to the lanes region. */
  laneTops: Map<string, number>;
  /** Row heights per lane (0 when collapsed) — the view sizes lane blocks with this. */
  laneBodyHeights: Map<string, number>;
  barsByTask: Map<string, PositionedBar>;
};

/** Top offset of a bar within its lane body — the one row-y formula, shared
 * by {@link layoutRows} and the view so the two can never drift. */
export function barRowTop(rowIndex: number): number {
  return rowIndex * ROW_H + (ROW_H - BAR_H) / 2;
}

/** Assign vertical positions: header row per lane, then one row per bar. */
export function layoutRows(lanes: TimelineLane[]): TimelineLayout {
  const laneTops = new Map<string, number>();
  const laneBodyHeights = new Map<string, number>();
  const barsByTask = new Map<string, PositionedBar>();
  let cursor = 0;
  for (const lane of lanes) {
    laneTops.set(lane.bucketId, cursor);
    cursor += LANE_HEADER_H;
    const bodyH = lane.collapsed ? 0 : lane.bars.length * ROW_H + LANE_PAD_B;
    laneBodyHeights.set(lane.bucketId, bodyH);
    lane.bars.forEach((bar, i) => {
      barsByTask.set(bar.task.id, { ...bar, y: cursor + i * ROW_H });
    });
    cursor += bodyH;
  }
  return { totalHeight: cursor, laneTops, laneBodyHeights, barsByTask };
}

// ── Dependency arrows ────────────────────────────────────────────────────────

export type TimelineArrow = {
  blockerId: string;
  blockedId: string;
  /** From the blocker bar's end … */
  x1: number;
  y1: number;
  /** … to the blocked bar's start. Anchors sit on solid edges (fades excluded). */
  x2: number;
  y2: number;
};

/**
 * Arrow anchor points from blocked-by edges. Pairs with a hidden endpoint
 * (collapsed lane, trayed/undated, out of scope) are dropped — no dangling
 * arrows (spec §Edge cases).
 */
export function arrowEndpoints(
  relations: TaskRelation[],
  barsByTask: ReadonlyMap<string, PositionedBar>,
): TimelineArrow[] {
  const arrows: TimelineArrow[] = [];
  for (const rel of relations) {
    if (rel.blockerTaskId === rel.blockedTaskId) continue;
    const from = barsByTask.get(rel.blockerTaskId);
    const to = barsByTask.get(rel.blockedTaskId);
    if (!from || !to) continue;
    arrows.push({
      blockerId: rel.blockerTaskId,
      blockedId: rel.blockedTaskId,
      x1: from.x + from.width - (from.solidRight ? 0 : FADE_PX),
      y1: from.y + ROW_H / 2,
      x2: to.x + (to.solidLeft ? 0 : FADE_PX),
      y2: to.y + ROW_H / 2,
    });
  }
  return arrows;
}

// ── Date math for drags (TL-2 writes through these) ─────────────────────────

/**
 * Move a bar body by whole days: every known date shifts by `deltaDays`,
 * preserving its clock time (existing reschedule semantics). Unknown dates
 * stay unknown — moving a half-open bar never invents the missing date.
 */
export function shiftTaskDates(
  task: Pick<Task, "scheduledAt" | "dueDate">,
  deltaDays: number,
): Partial<Pick<Task, "scheduledAt" | "dueDate">> {
  const patch: Partial<Pick<Task, "scheduledAt" | "dueDate">> = {};
  if (task.scheduledAt) {
    const d = new Date(task.scheduledAt);
    if (!Number.isNaN(d.getTime())) patch.scheduledAt = addDays(d, deltaDays).toISOString();
  }
  if (task.dueDate) {
    const d = new Date(task.dueDate);
    if (!Number.isNaN(d.getTime())) patch.dueDate = addDays(d, deltaDays).toISOString();
  }
  return patch;
}

/** Hour a tray drop / newly-set start lands on (scheduling implies a morning anchor). */
export const TRAY_DROP_HOUR = 9;

/**
 * Set one edge of a bar to a local day — a solid-edge adjust, or a faded-edge
 * drag that *sets* the missing date (the bar solidifies). Clock time is kept
 * when the date already exists; a newly-set start anchors at 09:00 local and a
 * newly-set end at local midnight (the due-date convention). The span clamps
 * to a 1-day minimum and never inverts: the moved edge yields to the other.
 */
export function setBarEdge(
  task: Pick<Task, "scheduledAt" | "dueDate">,
  edge: "start" | "end",
  day: Date,
): Partial<Pick<Task, "scheduledAt" | "dueDate">> {
  let target = startOfDay(day);

  if (edge === "start") {
    const due = taskDay(task.dueDate);
    if (due && target > due) target = due; // clamp — never invert (day level)
    const prev = task.scheduledAt ? new Date(task.scheduledAt) : null;
    let next = new Date(target);
    if (prev && !Number.isNaN(prev.getTime())) {
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    } else {
      next.setHours(TRAY_DROP_HOUR, 0, 0, 0);
    }
    // Instant-level guard: re-applying the clock time on the clamped day can
    // still put the start AFTER the due instant (due is local midnight) —
    // never store a sub-day inversion either.
    const dueInstant = task.dueDate ? new Date(task.dueDate) : null;
    if (dueInstant && !Number.isNaN(dueInstant.getTime()) && next > dueInstant) {
      next = dueInstant;
    }
    return { scheduledAt: next.toISOString() };
  }

  const sched = taskDay(task.scheduledAt);
  if (sched && target < sched) target = sched; // clamp — never invert (day level)
  const prev = task.dueDate ? new Date(task.dueDate) : null;
  let next = new Date(target);
  if (prev && !Number.isNaN(prev.getTime())) {
    next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
  }
  const schedInstant = task.scheduledAt ? new Date(task.scheduledAt) : null;
  if (schedInstant && !Number.isNaN(schedInstant.getTime()) && next < schedInstant) {
    next = schedInstant;
  }
  return { dueDate: next.toISOString() };
}
