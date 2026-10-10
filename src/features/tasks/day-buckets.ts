// Calendar-day arithmetic for Tasks' Filter → Due date / Scheduled (tasks-v2
// §7). The Date grouping lives in helpers.ts (`dateGroupOf`, tasks-v3 call
// 83); "This week" is only a filter. Days are local calendar days; the week
// ends on Sunday until Settings → Time & region (TV-D14) says otherwise.

import { dayOffset } from "../../lib/time-format";
import { isDrifted, type Task } from "./model";

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
