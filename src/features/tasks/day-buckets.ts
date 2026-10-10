// Calendar-day arithmetic the Tasks views share (tasks-v2 §6–7): the row's
// short date, the Filter's Due / Scheduled choices and the Display's Due,
// Scheduled and Time groupings. Days are local calendar days; weeks start on
// Monday, as in the date picker and the calendar's default.

import { isDrifted, type Task } from "./model";

const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from today to `d` (negative in the past). */
export function dayOffset(d: Date, now: Date): number {
  return Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
}

function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days from today to this week's Sunday: 6 on a Monday, 0 on a Sunday. */
export function daysLeftInWeek(now: Date): number {
  const weekday = now.getDay(); // 0 = Sunday
  return weekday === 0 ? 0 : 7 - weekday;
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

// ── Filter → Due / Scheduled ────────────────────────────────────────────────

/** The Due filter's choices. "This week" is today until Sunday; a date
 *  before today is "Earlier", never "This week". */
export const DUE_FILTER_VALUES = ["today", "week", "none", "earlier"] as const;
export type DueFilterValue = (typeof DUE_FILTER_VALUES)[number];

/** The Scheduled filter's choices: "Drifted" is a passed time on an open task. */
export const SCHEDULED_FILTER_VALUES = ["today", "week", "none", "drifted"] as const;
export type ScheduledFilterValue = (typeof SCHEDULED_FILTER_VALUES)[number];

function dayChoices(d: Date | null, now: Date): string[] {
  if (!d) return ["none"];
  const offset = dayOffset(d, now);
  if (offset < 0) return ["earlier"];
  const out: string[] = [];
  if (offset === 0) out.push("today");
  if (offset <= daysLeftInWeek(now)) out.push("week");
  return out;
}

/** Every Due choice a task meets (due today is also due this week). */
export function dueFilterValues(task: Pick<Task, "dueDate">, now: Date): DueFilterValue[] {
  return dayChoices(validDate(task.dueDate), now) as DueFilterValue[];
}

/** Every Scheduled choice a task meets. A time that passed today is both
 *  "Today" and "Drifted"; one on an earlier day is only "Drifted". */
export function scheduledFilterValues(
  task: Pick<Task, "scheduledAt" | "status">,
  now: Date,
): ScheduledFilterValue[] {
  const d = validDate(task.scheduledAt);
  const out = dayChoices(d, now).filter((v) => v !== "earlier") as ScheduledFilterValue[];
  if (isDrifted(task, now)) out.push("drifted");
  return out;
}

// ── Display → Due / Scheduled / Time groups ─────────────────────────────────

/** One group per calendar day, with everything before today as "Earlier"
 *  and no date as "none". Keys sort: earlier, then days, then none. */
export function dayGroupKey(iso: string | null, now: Date): string {
  const d = validDate(iso);
  if (!d) return "none";
  if (dayOffset(d, now) < 0) return "earlier";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `d:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A day group's header: "Earlier", a short day ("Today", "Thu", "Oct 14"). */
export function dayGroupLabel(key: string, now: Date, noneLabel: string): string {
  if (key === "none") return noneLabel;
  if (key === "earlier") return "Earlier";
  const [y, m, d] = key.slice(2).split("-").map(Number);
  return formatShortDate(new Date(y, (m ?? 1) - 1, d ?? 1).toISOString(), now);
}

/** Display → Group by → Time, in order. */
export const TIME_GROUPS = ["earlier", "today", "tomorrow", "week", "later", "none"] as const;
export type TimeGroup = (typeof TIME_GROUPS)[number];

export const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  earlier: "Earlier",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  later: "Later",
  none: "No date",
};

/**
 * The Time group of a task: the day of its row date (the scheduled time or
 * the due date, whichever comes first, as the date column shows) relative to
 * today. "This week" is after tomorrow until Sunday.
 */
export function timeGroupOf(task: Pick<Task, "scheduledAt" | "dueDate">, now: Date): TimeGroup {
  const scheduled = validDate(task.scheduledAt);
  const due = validDate(task.dueDate);
  const first =
    scheduled && due
      ? startOfDay(due) < startOfDay(scheduled)
        ? due
        : scheduled
      : (scheduled ?? due);
  if (!first) return "none";
  const offset = dayOffset(first, now);
  if (offset < 0) return "earlier";
  if (offset === 0) return "today";
  if (offset === 1) return "tomorrow";
  if (offset <= daysLeftInWeek(now)) return "week";
  return "later";
}
