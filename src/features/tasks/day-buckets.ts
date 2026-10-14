// Calendar-day arithmetic for Tasks' Filter → Due date / Scheduled (tasks-v2
// §7). The Date grouping lives in helpers.ts (`dateGroupOf`, tasks-v3 call
// 83); "This week" is only a filter. Days are local calendar days; the week
// starts where Settings → Time & region says (TV-D14; the device's by default).

import { dayOffset } from "../../lib/time-format";
import { getResolvedTimeRegion } from "../../lib/time-region";
import { isDrifted, type Task } from "./model";

function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days from today to the week's last day: with a Monday start, 6 on a
 *  Monday and 0 on a Sunday; with a Sunday start, 0 on a Saturday. */
export function daysLeftInWeek(
  now: Date,
  weekStartsOn: number = getResolvedTimeRegion().weekStartsOn,
): number {
  const last = (weekStartsOn + 6) % 7; // 0 = Sunday
  return (last - now.getDay() + 7) % 7;
}

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

/** The Completed filter's choices (tasks-v3 §2, TV-U8): when a task was
 *  finished, in this device's days; "none" = not finished. */
export const COMPLETED_FILTER_VALUES = ["today", "week", "last_week", "month", "none"] as const;
export type CompletedFilterValue = (typeof COMPLETED_FILTER_VALUES)[number];

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Every Completed choice a task meets. "This week" and "Last week" follow
 * Time & region's week start; "This month" is the calendar month. A task
 * finished today is also this week (and this month).
 */
export function completedFilterValues(
  task: { completedAt?: string | null },
  now: Date,
  weekStartsOn: number = getResolvedTimeRegion().weekStartsOn,
): CompletedFilterValue[] {
  const done = validDate(task.completedAt);
  if (!done) return ["none"];
  const today = dayStart(now);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() - weekStartsOn + 7) % 7));
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  const day = dayStart(done);
  const out: CompletedFilterValue[] = [];
  if (day.getTime() === today.getTime()) out.push("today");
  if (day >= weekStart && day <= today) out.push("week");
  if (day >= lastWeekStart && day < weekStart) out.push("last_week");
  if (day.getFullYear() === today.getFullYear() && day.getMonth() === today.getMonth()) {
    out.push("month");
  }
  return out;
}
