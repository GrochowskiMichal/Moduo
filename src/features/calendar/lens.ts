// The calendar task lens — pure selectors that render scheduled tasks as time
// blocks on the grid. The lens model (specs/calendar.md, decision 1): a task
// block IS the task row (`scheduledAt` + `durationMinutes`); no separate block
// object exists in v1, so Tasks and Calendar cannot drift apart by construction.
//
// Everything here is real-instant math over local calendar days — never hour
// indices — so DST days (23h/25h) resolve correctly (see grid-layout.ts).

import { todayStr } from "../tasks/helpers";
import type { Task } from "../tasks/model";

/** The two v1 grid views. Month/agenda are explicit fast-follows (§11). */
export type CalendarView = "day" | "week";

/** Tasks with no duration render as a 30-minute block (spec AC2). */
export const DEFAULT_BLOCK_MINUTES = 30;

/** The slice of a Task the lens reads. Kept narrow so tests stay cheap. */
export type LensTask = Pick<
  Task,
  "id" | "title" | "scheduledAt" | "durationMinutes" | "status" | "deletedAt"
>;

/** A task rendered as a block — a projection, never a stored object. */
export type TaskBlock = {
  taskId: string;
  title: string;
  /** Real instant of the block's start (ms epoch). */
  startMs: number;
  /** Real instant of the block's end (start + duration). */
  endMs: number;
  durationMinutes: number;
  done: boolean;
  /** Local calendar day (YYYY-MM-DD) the block renders in — its start's day. */
  dayKey: string;
};

/** The visible slice of the calendar: the ordered day columns + range bounds. */
export type VisibleRange = {
  view: CalendarView;
  /** Local day-start Dates for each rendered column, in order. */
  days: Date[];
  startMs: number;
  /** Exclusive end — local midnight after the last visible day. */
  endMs: number;
};

/**
 * Local calendar date key (YYYY-MM-DD) — the timestamptz-normalization rule.
 * Delegates to the Tasks `todayStr` so the app has ONE local-day-key
 * definition (it's also what `committedFor` stores).
 */
export function localDayKey(d: Date): string {
  return todayStr(d);
}

/** Parse a YYYY-MM-DD key back to a local day-start Date. Invalid → null. */
export function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Calendar-day addition (DST-safe — goes through Y/M/D, not ms). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export type RangePrefs = {
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
  showWeekends: boolean;
};

/** Compute the visible day columns for a view anchored at `anchor`. */
export function visibleRange(
  view: CalendarView,
  anchor: Date,
  prefs: RangePrefs,
): VisibleRange {
  const anchorDay = startOfLocalDay(anchor);
  let days: Date[];
  if (view === "day") {
    days = [anchorDay];
  } else {
    const back = (anchorDay.getDay() - prefs.weekStartsOn + 7) % 7;
    const weekStart = addDays(anchorDay, -back);
    days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    if (!prefs.showWeekends) {
      days = days.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
    }
  }
  const last = days[days.length - 1];
  return {
    view,
    days,
    startMs: days[0].getTime(),
    endMs: addDays(last, 1).getTime(),
  };
}

/** Step the anchor one period (day/week) forward or back. */
export function stepAnchor(view: CalendarView, anchor: Date, dir: 1 | -1): Date {
  return addDays(startOfLocalDay(anchor), (view === "week" ? 7 : 1) * dir);
}

/**
 * Shape the visible task blocks: open + done tasks whose `scheduledAt` falls
 * on a visible local day. Archived and deleted tasks never render; done tasks
 * render (checked/dimmed) on the day they were scheduled (AC2). One task ⇒ at
 * most one block — no double-render anywhere.
 */
export function taskBlocks(tasks: LensTask[], range: VisibleRange): TaskBlock[] {
  const dayKeys = new Set(range.days.map(localDayKey));
  const seen = new Set<string>();
  const out: TaskBlock[] = [];
  for (const t of tasks) {
    if (t.deletedAt) continue;
    if (t.status === "archived") continue;
    if (!t.scheduledAt) continue;
    if (seen.has(t.id)) continue;
    const start = new Date(t.scheduledAt);
    const startMs = start.getTime();
    if (Number.isNaN(startMs)) continue;
    const dayKey = localDayKey(start);
    if (!dayKeys.has(dayKey)) continue;
    seen.add(t.id);
    const durationMinutes =
      t.durationMinutes && t.durationMinutes > 0
        ? t.durationMinutes
        : DEFAULT_BLOCK_MINUTES;
    out.push({
      taskId: t.id,
      title: t.title,
      startMs,
      endMs: startMs + durationMinutes * 60_000,
      durationMinutes,
      done: t.status === "done",
      dayKey,
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.taskId.localeCompare(b.taskId));
}

/** Group blocks into their day columns (each block lands in exactly one). */
export function blocksByDay(blocks: TaskBlock[]): Map<string, TaskBlock[]> {
  const map = new Map<string, TaskBlock[]>();
  for (const b of blocks) {
    const list = map.get(b.dayKey);
    if (list) list.push(b);
    else map.set(b.dayKey, [b]);
  }
  return map;
}

/**
 * Toolbar label for the visible range ("Jun 30 – Jul 6" / "Wednesday, July 2").
 * Each side gains its own year only when it differs from `now`'s year, so a
 * cross-year week reads honestly ("Dec 28, 2026 – Jan 3, 2027") and current-
 * year ranges stay terse. `now` is injectable so tests don't rot at new year.
 */
export function rangeLabel(
  range: VisibleRange,
  locale?: string,
  now: Date = new Date(),
): string {
  const first = range.days[0];
  const last = range.days[range.days.length - 1];
  if (range.view === "day") {
    return first.toLocaleDateString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      ...(first.getFullYear() !== now.getFullYear() ? { year: "numeric" } : null),
    });
  }
  const side = (d: Date): string =>
    d.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : null),
    });
  return `${side(first)} – ${side(last)}`;
}
