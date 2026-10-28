// Plan, the right panel's task view (CALR-5, AC24): your open tasks in four
// groups. From earlier (due before today, oldest first, never red), Due this
// week (today to the week's end, by date), Scheduled (placed today or later, by
// time) and No date. A task due after this week waits for its week; Find a
// task still reaches it (`later`, shown only while searching).

import { isBacklogTask, isOpenTask } from "@contracts/vocabularies";

import type { Task } from "../tasks/model";
import { addDays, localDayKey, startOfLocalDay } from "./lens";

export type PlanGroups = {
  earlier: Task[];
  thisWeek: Task[];
  scheduled: Task[];
  noDate: Task[];
  /** Due after this week: listed only while searching. */
  later: Task[];
  /** True when a non-empty query filtered everything out. */
  emptyBySearch: boolean;
};

/** Plan shows six rows a group, then Show more. */
export const PLAN_GROUP_ROWS = 6;

/** Assigned to you, or unassigned and created by you. */
export function isMyTask(t: Pick<Task, "assigneeId" | "creatorId">, me: string): boolean {
  return t.assigneeId === me || (t.assigneeId == null && t.creatorId === me);
}

/** Local calendar-day key of a stored timestamptz (the CO-5 gotcha). */
function dayKeyOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : localDayKey(d);
}

const byDue = (a: Task, b: Task) => Date.parse(a.dueDate ?? "") - Date.parse(b.dueDate ?? "");
const byScheduled = (a: Task, b: Task) =>
  Date.parse(a.scheduledAt ?? "") - Date.parse(b.scheduledAt ?? "");

type PlanGroupId = Exclude<keyof PlanGroups, "emptyBySearch">;

/** Which group a task sits in, or null when Plan leaves it out. */
function planGroupOf(
  t: Task,
  q: { me: string; query: string; todayKey: string; weekEndKey: string },
): PlanGroupId | null {
  if (t.deletedAt || t.parentId || !isMyTask(t, q.me)) return null;
  const parked = isBacklogTask(t);
  if (!parked && !isOpenTask(t)) return null;
  if (q.query && !t.title.toLowerCase().includes(q.query)) return null;
  // A parked (backlog-status) task is unplanned work: never a dated group.
  if (parked) return "noDate";
  const placed = dayKeyOf(t.scheduledAt);
  if (placed && placed >= q.todayKey) return "scheduled";
  const due = dayKeyOf(t.dueDate);
  if (!due) return "noDate";
  if (due < q.todayKey) return "earlier";
  return due <= q.weekEndKey ? "thisWeek" : "later";
}

export function groupPlanTasks(input: {
  /** Live tasks, in position order (deleted already filtered by the hook). */
  tasks: readonly Task[];
  me: string;
  query?: string;
  now?: Date;
  /** 0 = Sunday … 6 = Saturday (default Monday). */
  weekStartsOn?: number;
}): PlanGroups {
  const today = startOfLocalDay(input.now ?? new Date());
  const back = (today.getDay() - (input.weekStartsOn ?? 1) + 7) % 7;
  const q = {
    me: input.me,
    query: (input.query ?? "").trim().toLowerCase(),
    todayKey: localDayKey(today),
    weekEndKey: localDayKey(addDays(today, 6 - back)),
  };
  const groups: Record<PlanGroupId, Task[]> = {
    earlier: [],
    thisWeek: [],
    scheduled: [],
    noDate: [],
    later: [],
  };
  for (const t of input.tasks) {
    const id = planGroupOf(t, q);
    if (id) groups[id].push(t);
  }
  groups.earlier.sort(byDue);
  groups.thisWeek.sort(byDue);
  groups.later.sort(byDue);
  groups.scheduled.sort(byScheduled);
  const total = Object.values(groups).reduce((n, list) => n + list.length, 0);
  return { ...groups, emptyBySearch: q.query !== "" && total === 0 };
}

/** A group's rows before Show more, and how many it hides. */
export function planRows<T>(list: readonly T[], expanded: boolean): { rows: T[]; more: number } {
  if (expanded || list.length <= PLAN_GROUP_ROWS) return { rows: [...list], more: 0 };
  return { rows: list.slice(0, PLAN_GROUP_ROWS), more: list.length - PLAN_GROUP_ROWS };
}
