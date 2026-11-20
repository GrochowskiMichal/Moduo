// The calendar task lens — pure selectors that render scheduled tasks as time
// blocks on the grid. The lens model (specs/calendar.md, decision 1): a block
// is never a stored object of the Calendar's own. Since TV-F6 (tasks-v3 AC2.3,
// AC7.3) a block is one of my work sessions (TV-D10's `task_sessions`, several
// per task), falling back to the task row (`scheduledAt` + `durationMinutes`)
// for a task with no session known; due-only tasks are all-day chips.
//
// Everything here is real-instant math over local calendar days — never hour
// indices — so DST days (23h/25h) resolve correctly (see grid-layout.ts).

import { formatDate, formatWeekdayDate } from "../../lib/time-format";
import { todayStr } from "../tasks/helpers";
import type { Task, TaskSession } from "../tasks/model";

/** The grid views, and Month (CALR-12): six whole weeks around the anchor's month. */
export type CalendarView = "day" | "week" | "month";

/** Tasks with no duration render as a 30-minute block (spec AC2). */
export const DEFAULT_BLOCK_MINUTES = 30;

/** The slice of a Task the lens reads. Kept narrow so tests stay cheap. */
export type LensTask = Pick<
  Task,
  "id" | "title" | "scheduledAt" | "durationMinutes" | "status" | "deletedAt"
> &
  Partial<Pick<Task, "statusCategory">>;

/** A task rendered as a block — a projection, never a stored object. */
export type TaskBlock = {
  /** The block's own id: its work session's (TV-D10), or the task's for a
   *  schedule read from the task row (no sessions known for it). */
  blockId: string;
  /** The work session it shows; null when read from the task row. */
  sessionId: string | null;
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
export function visibleRange(view: CalendarView, anchor: Date, prefs: RangePrefs): VisibleRange {
  const anchorDay = startOfLocalDay(anchor);
  let days: Date[];
  if (view === "day") {
    days = [anchorDay];
  } else {
    // Month: the six weeks from the week holding the 1st.
    const from =
      view === "month" ? new Date(anchorDay.getFullYear(), anchorDay.getMonth(), 1) : anchorDay;
    const back = (from.getDay() - prefs.weekStartsOn + 7) % 7;
    const weekStart = addDays(from, -back);
    days = Array.from({ length: view === "month" ? 42 : 7 }, (_, i) => addDays(weekStart, i));
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

/** Step the anchor one period (day/week/month) forward or back; a month lands on its 1st. */
export function stepAnchor(view: CalendarView, anchor: Date, dir: 1 | -1): Date {
  if (view === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return addDays(startOfLocalDay(anchor), (view === "week" ? 7 : 1) * dir);
}

/**
 * Shape the visible task blocks: open + done tasks whose `scheduledAt` falls
 * on a visible local day. Archived and deleted tasks never render; done tasks
 * render (checked/dimmed) on the day they were scheduled (AC2). One task ⇒ at
 * most one block — no double-render anywhere.
 */
/** A work session as the lens reads it (TV-D10's `task_sessions`). */
export type LensSession = Pick<TaskSession, "id" | "taskId" | "userId" | "startsAt" | "endsAt">;

/**
 * Task blocks in the visible days (TV-F6, AC2.3/AC7.3: "sessions as blocks").
 * With `sessions`, each of my work sessions is its own block (a task can be in
 * my calendar several times, REPLAN 25), and a teammate's session stays in
 * their calendar. A scheduled task the store has no session for at all (a
 * build from before TV-D10, sessions not read yet) shows from its row, once.
 */
export function taskBlocks(
  tasks: LensTask[],
  range: VisibleRange,
  sessions?: { list: readonly LensSession[]; me: string | null },
): TaskBlock[] {
  const dayKeys = new Set(range.days.map(localDayKey));
  const seen = new Set<string>();
  const out: TaskBlock[] = [];
  const withSessions = new Set<string>();
  if (sessions) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const s of sessions.list) {
      withSessions.add(s.taskId);
      if (s.userId && s.userId !== sessions.me) continue;
      const t = byId.get(s.taskId);
      if (!t || t.deletedAt || t.status === "archived") continue;
      const startMs = Date.parse(s.startsAt);
      const endMs = Date.parse(s.endsAt);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      const dayKey = localDayKey(new Date(startMs));
      if (!dayKeys.has(dayKey)) continue;
      const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60_000));
      out.push({
        blockId: s.id,
        sessionId: s.id,
        taskId: t.id,
        title: t.title,
        startMs,
        endMs: startMs + durationMinutes * 60_000,
        durationMinutes,
        done: t.status === "done",
        dayKey,
      });
    }
  }
  for (const t of tasks) {
    if (t.deletedAt) continue;
    if (t.status === "archived") continue;
    if (!t.scheduledAt) continue;
    if (withSessions.has(t.id)) continue;
    if (seen.has(t.id)) continue;
    const start = new Date(t.scheduledAt);
    const startMs = start.getTime();
    if (Number.isNaN(startMs)) continue;
    const dayKey = localDayKey(start);
    if (!dayKeys.has(dayKey)) continue;
    seen.add(t.id);
    const durationMinutes =
      t.durationMinutes && t.durationMinutes > 0 ? t.durationMinutes : DEFAULT_BLOCK_MINUTES;
    out.push({
      blockId: t.id,
      sessionId: null,
      taskId: t.id,
      title: t.title,
      startMs,
      endMs: startMs + durationMinutes * 60_000,
      durationMinutes,
      done: t.status === "done",
      dayKey,
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.blockId.localeCompare(b.blockId));
}

/** A due-only task as an all-day chip (TV-F6, AC2.3/AC7.3). */
export type DueChip = {
  taskId: string;
  title: string;
  dayKey: string;
  done: boolean;
};

/**
 * Your own due-only tasks in the visible days, as all-day chips (spec §18): a
 * task of yours with a due date and nothing in your calendar shows on its due
 * day (REPLAN 1.3: "due-only tasks never reach the calendar grid"). A Won't do
 * task doesn't; a done one shows done.
 */
export function dueChipsByDay(
  tasks: readonly (LensTask &
    Partial<Pick<Task, "dueOn" | "assigneeId" | "creatorId" | "creatorUnknown">>)[],
  range: VisibleRange,
  sessions: { list: readonly Pick<LensSession, "taskId" | "userId">[]; me: string | null },
): Map<string, DueChip[]> {
  const dayKeys = new Set(range.days.map(localDayKey));
  const known = new Set(sessions.list.map((s) => s.taskId));
  const mine = new Set(
    sessions.list.filter((s) => !s.userId || s.userId === sessions.me).map((s) => s.taskId),
  );
  const out = new Map<string, DueChip[]>();
  for (const t of tasks) {
    if (t.deletedAt || t.status === "archived" || !t.dueOn) continue;
    // Your own (spec §18): assigned to you, or yours as its creator while
    // nobody is assigned. Teammates' tasks stay out.
    const owner = t.assigneeId ?? (t.creatorUnknown ? null : (t.creatorId ?? null));
    if (!sessions.me || owner !== sessions.me) continue;
    // In your calendar already: a session of yours (or, with no session known
    // for it, the row's schedule).
    if (mine.has(t.id) || (!known.has(t.id) && t.scheduledAt)) continue;
    const dayKey = t.dueOn.slice(0, 10);
    if (!dayKeys.has(dayKey)) continue;
    const chip: DueChip = { taskId: t.id, title: t.title, dayKey, done: t.status === "done" };
    const list = out.get(dayKey);
    if (list) list.push(chip);
    else out.set(dayKey, [chip]);
  }
  return out;
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
export function rangeLabel(range: VisibleRange, locale?: string, now: Date = new Date()): string {
  const first = range.days[0];
  const last = range.days[range.days.length - 1];
  if (range.view === "month") {
    // The middle of six weeks always sits in the month they're for.
    const mid = range.days[Math.floor(range.days.length / 2)];
    return mid.toLocaleDateString(locale, { month: "long", year: "numeric" });
  }
  // The app passes no locale: the label reads the one date grammar, so it
  // follows Time & region's date order (TV-D14).
  if (!locale) {
    if (range.view === "day") return formatWeekdayDate(first, now);
    return `${formatDate(first, now)} – ${formatDate(last, now)}`;
  }
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
