// Pure selectors for the right panel's Tasks view (DESIGN_BRIEF §5, AC11):
// Queue (my personal queue, in order — TV-D4) · Due soon (overdue + next 7
// days, open) · Backlog (open, unscheduled, not queued — capped + search). Scheduled rows
// show their time and sort to the BOTTOM of their group rather than vanishing
// (visibility beats purity — the row is how you find what's already placed).

import type { Task } from "../tasks/model";
import { addDays, localDayKey } from "./lens";

export type PanelGroups = {
  /** My queue's open tasks, in line-up order. */
  queue: Task[];
  dueSoon: Task[];
  backlog: Task[];
  /** True when a non-empty query filtered everything out. */
  emptyBySearch: boolean;
};

export const BACKLOG_CAP = 50;

function isOpen(t: Task): boolean {
  return (t.status === "todo" || t.status === "in_progress") && !t.deletedAt;
}

/** Local calendar-day key of a stored timestamptz (the CO-5 gotcha). */
function dueDayKey(t: Task): string | null {
  if (!t.dueDate) return null;
  const d = new Date(t.dueDate);
  return Number.isNaN(d.getTime()) ? null : localDayKey(d);
}

function matches(t: Task, query: string): boolean {
  return t.title.toLowerCase().includes(query);
}

/** Scheduled rows sink to the bottom of their group (stable otherwise). */
function scheduledLast(list: Task[]): Task[] {
  const unscheduled = list.filter((t) => !t.scheduledAt);
  const scheduled = list.filter((t) => Boolean(t.scheduledAt));
  return [...unscheduled, ...scheduled];
}

export function groupPanelTasks(input: {
  /** Live tasks (position-sorted; deleted already filtered by the hook). */
  tasks: Task[];
  /** My queue, already in line-up order. */
  queuedTasks: Task[];
  query?: string;
  now?: Date;
  backlogCap?: number;
}): PanelGroups {
  const now = input.now ?? new Date();
  const query = (input.query ?? "").trim().toLowerCase();
  const cap = input.backlogCap ?? BACKLOG_CAP;

  const horizonKey = localDayKey(addDays(now, 7));

  const queue = input.queuedTasks.filter((t) => isOpen(t) && (!query || matches(t, query)));
  const inQueue = new Set(queue.map((t) => t.id));
  // Queued-but-filtered-out rows must not resurface in other groups.
  for (const t of input.queuedTasks) inQueue.add(t.id);

  const dueSoon: Task[] = [];
  const backlog: Task[] = [];
  for (const t of input.tasks) {
    if (!isOpen(t) || inQueue.has(t.id)) continue;
    if (t.parentId) continue; // subtasks stay under their parent, not here
    if (query && !matches(t, query)) continue;
    const due = dueDayKey(t);
    // OVERDUE open tasks count as due-soon too (graceful slippage: the
    // most-urgent rows must never fall off the panel into a capped backlog).
    if (due && due <= horizonKey) {
      dueSoon.push(t);
      continue;
    }
    if (!t.scheduledAt) backlog.push(t);
  }

  const grouped = {
    queue: scheduledLast(queue),
    dueSoon: scheduledLast(dueSoon),
    backlog: backlog.slice(0, cap),
  };
  const total = grouped.queue.length + grouped.dueSoon.length + grouped.backlog.length;
  return { ...grouped, emptyBySearch: query !== "" && total === 0 };
}
