// The Focus screen's rules as pure functions (TV-F7, specs/tasks-v3.md §7;
// REPLAN 61–66, 62a, 63, 65a): what the Now card holds, how Up next reads,
// what the timer pill says, today's scheduled rows of the empty state, and the
// done line. The screen itself is `ui/focus-view.tsx`.

import { isBacklogTask, isClosedTask, isOpenTask } from "@contracts/vocabularies";

import { formatDuration } from "../../lib/time-format";
import { formatFocusClock } from "../focus/clock";
import { estimateOf, type Task, type TaskSession } from "./model";

/** The Now card's task and the rest of the line-up. */
export type FocusLineup = {
  /** What the card shows: the session's task, else the head of Up next. */
  now: Task | null;
  /** My open queued tasks after Now, in line-up order. */
  upNext: Task[];
};

/**
 * Now is the task the session is on (a session can move off the head of Up
 * next: a reorder never moves the clock), else the first open task lined up.
 * Up next is every other open queued task, in order. A task still saving
 * (`tmp-`) is listed but never Now: it has no id to time yet.
 */
export function focusLineup(queued: readonly Task[], sessionTask: Task | null): FocusLineup {
  const open = queued.filter((t) => isOpenTask(t));
  const live = sessionTask && isOpenTask(sessionTask) ? sessionTask : null;
  const now = live ?? open.find((t) => !t.id.startsWith("tmp-")) ?? null;
  return { now, upNext: open.filter((t) => t.id !== now?.id) };
}

/** One line of Up next: a project divider or a task (numbered from 1). */
export type UpNextLine =
  | { kind: "divider"; key: string; projectId: string }
  | { kind: "task"; key: string; task: Task; number: number };

/**
 * Up next keeps the line-up's order and marks where the project changes
 * (REPLAN 62: "project dividers"), so a switch is visible before you make it.
 * A line-up in one project has no dividers: the card already names it.
 */
export function upNextLines(upNext: readonly Task[]): UpNextLine[] {
  const projects = new Set(upNext.map((t) => t.bucketId));
  const divided = projects.size > 1;
  const out: UpNextLine[] = [];
  let last: string | null = null;
  upNext.forEach((task, i) => {
    if (divided && task.bucketId !== last) {
      out.push({ kind: "divider", key: `div-${i}-${task.bucketId}`, projectId: task.bucketId });
    }
    last = task.bucketId;
    out.push({ kind: "task", key: task.id, task, number: i + 1 });
  });
  return out;
}

/** "· 4 · ~1h": how many, and the estimates that are there. */
export function upNextSummary(upNext: readonly Task[]): string {
  if (upNext.length === 0) return "";
  const minutes = upNext.reduce((sum, t) => sum + (estimateOf(t) ?? 0), 0);
  return minutes > 0 ? `· ${upNext.length} · ~${formatDuration(minutes)}` : `· ${upNext.length}`;
}

/** What the Per task pill says next to its clock (REPLAN 62, 62a, 63). */
export type PillReading = {
  /** "18:02", or the countdown "26:58", or "+2:10" past it. */
  clock: string;
  /** "of ~45m", "~12m left", "+5m"; null with no estimate. */
  note: string | null;
  /** Past the estimate: still neutral (never red), only the words change. */
  over: boolean;
};

/**
 * The Per task pill. The clock is this sitting on the task (F6-4: the same
 * number the top-bar timer shows); the note compares everything tracked on the
 * task with its estimate:
 *  - nothing tracked before this sitting: "of ~45m";
 *  - some tracked before: "~12m left" (the estimate minus all of it);
 *  - past the estimate: "+5m", neutral.
 * "Count down the estimate" turns the clock into what's left of the estimate,
 * then "+m:ss" past it; with no estimate it counts up (63).
 */
export function pillReading(input: {
  /** Seconds on the task this sitting (`taskSeconds`). */
  sitting: number;
  /** Everything tracked on the task: its saved total plus what isn't saved yet. */
  total: number;
  estimateMinutes: number | null;
  countdown: boolean;
}): PillReading {
  const sitting = Math.max(0, Math.floor(input.sitting));
  const total = Math.max(sitting, Math.floor(input.total));
  const est = input.estimateMinutes && input.estimateMinutes > 0 ? input.estimateMinutes * 60 : 0;
  if (!est) return { clock: formatFocusClock(sitting), note: null, over: false };
  const left = est - total;
  if (input.countdown) {
    return left > 0
      ? { clock: formatFocusClock(left), note: "left", over: false }
      : { clock: `+${formatFocusClock(-left)}`, note: null, over: true };
  }
  if (left < 0) {
    return {
      clock: formatFocusClock(sitting),
      note: `+${formatDuration(Math.ceil(-left / 60))}`,
      over: true,
    };
  }
  const before = total - sitting;
  return {
    clock: formatFocusClock(sitting),
    note:
      before >= 60
        ? `~${formatDuration(Math.ceil(left / 60))} left`
        : `of ~${formatDuration(est / 60)}`,
    over: false,
  };
}

/** One of today's scheduled tasks on the empty state (call 66). */
export type ScheduledToday = { task: Task; at: number };

/**
 * "Or start from what's scheduled today" (call 66): my open tasks with a work
 * session today (or, for a task no session is known for, its scheduled time
 * today), in time order, each once, at its first time today. Tasks already in
 * Up next and Backlog stay out; a session belongs to me or to nobody.
 */
export function scheduledToday(input: {
  tasks: readonly Task[];
  sessions: readonly Pick<TaskSession, "taskId" | "userId" | "startsAt">[];
  me: string | null;
  now: Date;
  queuedIds: ReadonlySet<string>;
}): ScheduledToday[] {
  const { tasks, sessions, me, now, queuedIds } = input;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const today = (ms: number) => !Number.isNaN(ms) && ms >= start && ms < end;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const first = new Map<string, number>();
  const take = (taskId: string, at: number) => {
    const prev = first.get(taskId);
    if (prev === undefined || at < prev) first.set(taskId, at);
  };
  const withSessions = new Set<string>();
  for (const s of sessions) {
    withSessions.add(s.taskId);
    if (s.userId && s.userId !== me) continue;
    const at = Date.parse(s.startsAt);
    if (today(at)) take(s.taskId, at);
  }
  for (const t of tasks) {
    if (!t.scheduledAt || withSessions.has(t.id)) continue;
    if (t.assigneeId && t.assigneeId !== me) continue;
    const at = Date.parse(t.scheduledAt);
    if (today(at)) take(t.id, at);
  }
  const out: ScheduledToday[] = [];
  for (const [id, at] of first) {
    const task = byId.get(id);
    if (!task || task.deletedAt || queuedIds.has(id)) continue;
    if (isClosedTask(task) || isBacklogTask(task) || id.startsWith("tmp-")) continue;
    out.push({ task, at });
  }
  return out.sort((a, b) => a.at - b.at || a.task.title.localeCompare(b.task.title));
}

/**
 * The done line (REPLAN 62a: "2 done · 1h 12m"): how many this session and the
 * focused time; under Off just the count, since nothing was timed (63).
 */
export function doneLineText(input: { done: number; seconds: number; timed: boolean }): string {
  const count = `${input.done} done`;
  if (!input.timed || input.seconds < 60) return count;
  return `${count} · ${formatDuration(Math.floor(input.seconds / 60))}`;
}
