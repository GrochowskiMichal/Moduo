// Upcoming (tasks-v3 §8, call 83, defaults r and t; TV-U15). Pure: no React,
// no IO.
//
// - Who's in it: your dated tasks plus unassigned ones in projects you can
//   see (the store holds only those), minus Backlog and unassigned tasks
//   routed to a team you're not in. Won't do sits out; a task done today or
//   later stays in its day, behind the list's one "N completed · Show" (MOD-148).
// - One row per task, at its next session or its due date, whichever comes
//   first by day (`rowDateOf`, the List's own rule). A session that ended
//   with the task still open reads "missed 2:00 PM"; a passed due date reads
//   "late" (muted, never red).
// - The one Date grouping: Earlier · Today · Tomorrow · the next five day
//   names · Later, rolling. The seven days always show (an empty day keeps
//   its header and takes drops); Earlier and Later only when they hold work.
//   No "No date" here, and no week strip.
// - Day headers carry the load: "Thu · Oct 15 · 3 · ~2h 30m" (the estimate
//   total only when there are estimates).
// - Within a day: timed rows first, by time, then priority, then the
//   sidebar's project order.
// - Dragging between days moves the row's own date: a due date moves to the
//   day, a session keeps its time and length. Earlier takes nothing; Later
//   opens the due picker. A repeat asks "Move just this one · Change the
//   pattern" first (the caller's dialog).

import { isOpenTask, taskCategoryOf } from "@contracts/vocabularies";
import {
  dayOffset,
  formatDate,
  formatDay,
  formatDayTime,
  formatDuration,
  formatTime,
} from "../../lib/time-format";
import {
  DATE_GROUPS,
  type DateGroup,
  dateGroupOf,
  LEVEL_ORDER,
  rowDateOf,
  type TaskGroup,
  todayStr,
} from "./helpers";
import { dateGroupDay } from "./list-group-add";
import { estimateOf, isLate, type Task } from "./model";
import { isOtherTeamsWork } from "./teams";

/** Upcoming's groups, in order: the Date groups without No date. */
export const UPCOMING_GROUPS = DATE_GROUPS.filter((g) => g !== "none") as Exclude<
  DateGroup,
  "none"
>[];
export type UpcomingGroup = (typeof UPCOMING_GROUPS)[number];

/** The groups that always show, even empty (they take drops). */
const ALWAYS_SHOWN: ReadonlySet<UpcomingGroup> = new Set([
  "today",
  "tomorrow",
  "day2",
  "day3",
  "day4",
  "day5",
  "day6",
]);

export type UpcomingCoverage = {
  /** The signed-in person (null: nobody, so only unassigned work). */
  me: string | null;
  /** The teams they're in. */
  myTeams: ReadonlySet<string>;
};

/**
 * Whether a task shows in Upcoming (spec §8, default t). A task that isn't
 * saved yet ("" = its creator, the one capturing) counts as yours.
 */
export function inUpcoming(task: Task, coverage: UpcomingCoverage, now: Date): boolean {
  if (task.deletedAt) return false;
  const category = taskCategoryOf(task);
  if (category !== "todo" && category !== "in_progress" && category !== "done") return false;
  const at = rowDateOf(task);
  if (!at) return false;
  // Finished earlier work isn't upcoming; finished work on a coming day stays
  // in its day, behind the list's one "N completed · Show" (MOD-148).
  if (category === "done" && dayOffset(at, now) < 0) return false;
  const assignee = task.assigneeId;
  if (assignee === "" || (assignee !== null && assignee === coverage.me)) return true;
  if (assignee !== null) return false;
  // Unassigned: everyone's to plan, unless it's routed to a team you're not in.
  return !isOtherTeamsWork(task, coverage.myTeams);
}

/** The group a task's row date puts it in (never No date for a task in scope). */
export function upcomingGroupOf(task: Task, now: Date): UpcomingGroup {
  const group = dateGroupOf(task, now);
  return group === "none" ? "later" : group;
}

/** Whether a task's row stands for a work session (else its due date). */
export function placedOnSession(task: Pick<Task, "scheduledAt" | "dueDate">): boolean {
  const at = rowDateOf(task);
  return !!at && !!task.scheduledAt && at.getTime() === new Date(task.scheduledAt).getTime();
}

/**
 * A session that ended with the task still open: it's missed ("missed 2:00
 * PM"). Its length is the session's; without one, the start counts.
 */
export function isMissedSession(task: Task, now: Date): boolean {
  if (!placedOnSession(task) || !isOpenTask(task) || !task.scheduledAt) return false;
  const start = new Date(task.scheduledAt).getTime();
  const end = start + Math.max(0, task.durationMinutes ?? 0) * 60_000;
  return end < now.getTime();
}

/** The wall-clock moment a row's date stands for, when it has a time. */
function timeOf(task: Task): number | null {
  if (placedOnSession(task) && task.scheduledAt) return new Date(task.scheduledAt).getTime();
  if (task.dueTime && task.dueDate) {
    const [h, m] = task.dueTime.split(":").map(Number);
    const d = new Date(task.dueDate);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      d.setHours(h ?? 0, m ?? 0, 0, 0);
      return d.getTime();
    }
  }
  return null;
}

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(
  LEVEL_ORDER.map((level, i) => [level, i]),
);

/**
 * Upcoming's order: by day; within a day timed rows first (by time), then
 * priority (high to none), then the sidebar's project order, then the
 * project's own order (the incoming one). Stable.
 */
export function orderUpcoming<T extends Task>(
  tasks: readonly T[],
  projectRank: (bucketId: string) => number,
): T[] {
  const day = (t: Task) => {
    const at = rowDateOf(t);
    return at ? new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() : 0;
  };
  return tasks
    .map((task, index) => ({ task, index, day: day(task), time: timeOf(task) }))
    .sort((a, b) => {
      if (a.day !== b.day) return a.day - b.day;
      if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
      if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time;
      const pa = a.task.priority ? (PRIORITY_RANK[a.task.priority] ?? 3) : 3;
      const pb = b.task.priority ? (PRIORITY_RANK[b.task.priority] ?? 3) : 3;
      if (pa !== pb) return pa - pb;
      const ra = projectRank(a.task.bucketId);
      const rb = projectRank(b.task.bucketId);
      if (ra !== rb) return ra - rb;
      return a.index - b.index;
    })
    .map(({ task }) => task);
}

/**
 * Upcoming's groups, in order, each task in exactly one: the seven days
 * always (empty ones included), Earlier and Later only with work in them.
 * Tasks keep their incoming order inside a group (order first, then group).
 */
export function upcomingGroups(tasks: readonly Task[], now: Date): TaskGroup[] {
  const map = new Map<UpcomingGroup, Task[]>();
  for (const task of tasks) {
    const key = upcomingGroupOf(task, now);
    const list = map.get(key);
    if (list) list.push(task);
    else map.set(key, [task]);
  }
  return UPCOMING_GROUPS.filter((g) => ALWAYS_SHOWN.has(g) || map.has(g)).map((key) => ({
    key,
    label: upcomingLabel(key, now),
    tasks: map.get(key) ?? [],
  }));
}

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** The group's day (today + n), or null for Earlier and Later. */
export function upcomingDay(group: UpcomingGroup, now: Date): Date | null {
  const key = dateGroupDay(group, todayStr(now));
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/** A header's name: Earlier · Today · Tomorrow · Thu … · Later. */
export function upcomingLabel(group: UpcomingGroup, now: Date): string {
  if (group === "earlier") return "Earlier";
  if (group === "today") return "Today";
  if (group === "tomorrow") return "Tomorrow";
  if (group === "later") return "Later";
  const day = upcomingDay(group, now);
  return day ? WEEKDAY_SHORT.format(day) : "";
}

/**
 * A row's planned minutes for its day's load: a session's length, else the
 * estimate.
 */
function plannedMinutes(task: Task): number {
  const minutes = placedOnSession(task) ? task.durationMinutes : estimateOf(task);
  return minutes && minutes > 0 ? minutes : 0;
}

/**
 * The quiet line after a header's name (call 83): "Wed, Oct 14 · 3 · ~1h 25m"
 * for Today and Tomorrow, "Oct 15 · 3 · ~2h 30m" for a named day, an empty
 * day just its date. Earlier and Later show their count instead (null here).
 * The count is the open tasks; the total only when there are estimates.
 */
export function upcomingHeaderLine(
  group: UpcomingGroup,
  tasks: readonly Task[],
  now: Date,
): string | null {
  const day = upcomingDay(group, now);
  if (!day) return null;
  const open = tasks.filter((t) => isOpenTask(t));
  const date =
    group === "today" || group === "tomorrow"
      ? `${WEEKDAY_SHORT.format(day)}, ${formatDate(day, now)}`
      : formatDate(day, now);
  const parts = [date];
  if (open.length > 0) parts.push(String(open.length));
  const minutes = open.reduce((sum, t) => sum + plannedMinutes(t), 0);
  if (minutes > 0) parts.push(`~${formatDuration(minutes)}`);
  return `· ${parts.join(" · ")}`;
}

/**
 * What a row's date column says in Upcoming: only a time inside a day
 * ("3:00 PM · 45m", "due 5:00 PM", "due Thu"), "missed 2:00 PM" for a
 * session that ended with the task open, "Oct 8 · late" for a passed due
 * date, and the day in Later ("due Nov 7", "Nov 7, 3:00 PM").
 */
export function upcomingWhen(task: Task, now: Date): string | null {
  const at = rowDateOf(task);
  if (!at) return null;
  const group = upcomingGroupOf(task, now);
  const oneDay = group !== "earlier" && group !== "later";
  if (placedOnSession(task) && task.scheduledAt) {
    const start = new Date(task.scheduledAt);
    if (isMissedSession(task, now)) {
      return dayOffset(start, now) === 0
        ? `missed ${formatTime(start)}`
        : `missed ${formatDayTime(start, now)}`;
    }
    if (!oneDay) return formatDayTime(start, now);
    const length = task.durationMinutes ?? 0;
    return length > 0 ? `${formatTime(start)} · ${formatDuration(length)}` : formatTime(start);
  }
  if (!task.dueDate) return null;
  if (isLate(task, todayStr(now))) return `${formatDay(task.dueDate, now)} · late`;
  if (oneDay && task.dueTime) {
    const t = timeOf(task);
    if (t !== null) return `due ${formatTime(t)}`;
  }
  return `due ${formatDay(task.dueDate, now)}`;
}

// ── moving a row to another day ────────────────────────────────────────────

/** What moving a row to another day writes. */
export type UpcomingMove =
  /** The due date moves to the day (local midnight, as the app stores it). */
  | { kind: "due"; dueDate: string; day: string }
  /** The session keeps its clock time and length on the new day. */
  | { kind: "session"; scheduledAt: string; day: string };

/** "2026-10-13" for a local day. */
function dayKey(d: Date): string {
  return todayStr(d);
}

/** The local day a row stands on ("2026-10-13"), or null without a date. */
export function rowDay(task: Pick<Task, "scheduledAt" | "dueDate">): string | null {
  const at = rowDateOf(task);
  return at ? dayKey(at) : null;
}

/** A day key `days` after another ("2026-10-13" + 1 → "2026-10-14"). */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayKey(new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
}

/**
 * The write that puts a row on `day` ("2026-10-15"): its session (keeping the
 * clock time) when the row stands for one, else its due date. Null when it's
 * already there or has no date to move.
 */
export function moveToDay(
  task: Pick<Task, "scheduledAt" | "dueDate">,
  day: string,
): UpcomingMove | null {
  const current = rowDay(task);
  if (!current || current === day) return null;
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return null;
  if (placedOnSession(task) && task.scheduledAt) {
    const start = new Date(task.scheduledAt);
    const next = new Date(y, m - 1, d, start.getHours(), start.getMinutes(), 0, 0);
    return { kind: "session", scheduledAt: next.toISOString(), day };
  }
  return { kind: "due", dueDate: new Date(y, m - 1, d).toISOString(), day };
}

/**
 * Where a drop on a group lands: a day key for Today … the fifth day, "pick"
 * for Later (it opens the due picker), null for Earlier (a new date is never
 * in the past).
 */
export function dropDayFor(group: string, now: Date): string | "pick" | null {
  if (group === "later") return "pick";
  if (group === "earlier") return null;
  return dateGroupDay(group as DateGroup, todayStr(now));
}

/** Whether a dragged row may land in a group (not Earlier, not its own day). */
export function upcomingAccepts(group: string, task: Task, now: Date): boolean {
  if (group === "earlier") return false;
  if (group === "later") return upcomingGroupOf(task, now) !== "later";
  const day = dropDayFor(group, now);
  return typeof day === "string" && day !== "pick" && day !== rowDay(task);
}

/**
 * Whether a row still stands where a move put it, so its Undo may put it
 * back (Undo never overwrites a newer change). Compared as moments, never as
 * strings: the server's row says "…+00:00" where the app wrote "…Z".
 */
export function stillMoved(
  current: Pick<Task, "scheduledAt" | "dueDate"> | null | undefined,
  move: UpcomingMove,
): boolean {
  if (!current) return false;
  const same = (a: string | null | undefined, b: string) =>
    !!a && new Date(a).getTime() === new Date(b).getTime();
  return move.kind === "session"
    ? same(current.scheduledAt, move.scheduledAt)
    : same(current.dueDate, move.dueDate);
}
