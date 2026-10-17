// The Focus screen's rules as pure functions (TV-F7, specs/tasks-v3.md §7;
// REPLAN 61–66, 62a, 63, 65a): what the Now card holds, how Up next reads,
// what the timer pill says, today's scheduled rows of the empty state, and the
// done line. TV-F8 adds the meeting divider (64), "Arrange by project" (57),
// the along-the-way offer (57, 59a) and In flight (call 5's reshape of TV-F4).
// The screen itself is `ui/focus-view.tsx`.

import { isBacklogTask, isClosedTask, isOpenTask } from "@contracts/vocabularies";

import { formatDuration } from "../../lib/time-format";
import type { CalendarEventModel } from "../calendar/events";
import { expandEventOccurrences } from "../calendar/recurrence-expand";
import { formatFocusClock } from "../focus/clock";
import type { AgentSession } from "../spine/agent-session";
import {
  estimateOf,
  type Task,
  type TaskReminder,
  type TaskSession,
  type TaskWaitingEntry,
} from "./model";

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
 * (`tmp-`) is listed but never Now: it has no id to time yet. A lined-up task
 * that waits on someone or something (`inFlight`, TV-F8) sits in In flight
 * instead, until the wait clears; the session's own task stays Now.
 */
export function focusLineup(
  queued: readonly Task[],
  sessionTask: Task | null,
  inFlight: ReadonlySet<string> = NONE,
): FocusLineup {
  const open = queued.filter((t) => isOpenTask(t) && !inFlight.has(t.id));
  const live = sessionTask && isOpenTask(sessionTask) ? sessionTask : null;
  const now = live ?? open.find((t) => !t.id.startsWith("tmp-")) ?? null;
  return { now, upNext: open.filter((t) => t.id !== now?.id) };
}

const NONE: ReadonlySet<string> = new Set();

/** One line of Up next: a project divider, the next meeting, or a task (numbered from 1). */
export type UpNextLine =
  | { kind: "divider"; key: string; projectId: string }
  | { kind: "meeting"; key: string; title: string; startsAt: number }
  | { kind: "task"; key: string; task: Task; number: number };

/** The meeting divider's place in Up next (64): before the task at `index`. */
export type MeetingLine = { index: number; title: string; startsAt: number };

/**
 * Up next keeps the line-up's order and marks where the project changes
 * (REPLAN 62: "project dividers"), so a switch is visible before you make it.
 * A line-up in one project has no dividers: the card already names it. The
 * next meeting (64) sits where it falls, ahead of that place's project divider.
 */
export function upNextLines(upNext: readonly Task[], meeting?: MeetingLine | null): UpNextLine[] {
  const projects = new Set(upNext.map((t) => t.bucketId));
  const divided = projects.size > 1;
  const out: UpNextLine[] = [];
  const meetingLine: UpNextLine | null = meeting
    ? {
        kind: "meeting",
        key: `meeting-${meeting.startsAt}`,
        title: meeting.title,
        startsAt: meeting.startsAt,
      }
    : null;
  let last: string | null = null;
  upNext.forEach((task, i) => {
    if (meetingLine && meeting?.index === i) out.push(meetingLine);
    if (divided && task.bucketId !== last) {
      out.push({ kind: "divider", key: `div-${i}-${task.bucketId}`, projectId: task.bucketId });
    }
    last = task.bucketId;
    out.push({ kind: "task", key: task.id, task, number: i + 1 });
  });
  if (meetingLine && meeting && meeting.index >= upNext.length) out.push(meetingLine);
  return out;
}

/**
 * A move inside Up next as the whole line-up's new order, for `reorderQueue`
 * (which finds the one task that moved). Up next shows the line-up without
 * Now, and Now can sit anywhere in it while a session runs (a capture at the
 * top, a drag): so the moved task goes right after the Up next task it now
 * follows, or, moved to the top of Up next, right before the one it now
 * precedes. Everything else, Now included, keeps its place. Null when
 * nothing moved.
 */
export function upNextMove(
  queueIds: readonly string[],
  upNextIds: readonly string[],
  taskId: string,
  to: number,
): string[] | null {
  const from = upNextIds.indexOf(taskId);
  if (from < 0 || to < 0 || to >= upNextIds.length || from === to) return null;
  const order = upNextIds.filter((id) => id !== taskId);
  order.splice(to, 0, taskId);
  const rest = queueIds.filter((id) => id !== taskId);
  const anchor = to > 0 ? order[to - 1] : order[1];
  const at = anchor ? rest.indexOf(anchor) : -1;
  if (at < 0) return null;
  rest.splice(to > 0 ? at + 1 : at, 0, taskId);
  return rest;
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

// ── the next meeting (TV-F8, call 64) ───────────────────────────────────────

/** A meeting shows when it starts within two hours, or before the line-up runs out. */
export const MEETING_HORIZON_MS = 2 * 60 * 60_000;

/** The next meeting I'm attending: its title and start (epoch ms). */
export type NextMeeting = { title: string; startsAt: number };

type MeetingEvent = Pick<
  CalendarEventModel,
  "id" | "title" | "startsAt" | "endsAt" | "allDay" | "rrule" | "status" | "deletedAt" | "ownerId"
>;

/**
 * The next event you're attending (64): your own calendar's timed events (a
 * shared calendar's aren't yours to attend), not cancelled, starting after now
 * and within two hours, or within `horizonMs` when the line-up runs longer.
 * Recurring series are expanded. Null when there's none.
 */
export function nextMeeting(
  events: readonly MeetingEvent[],
  input: { me: string | null; nowMs: number; horizonMs?: number },
): NextMeeting | null {
  const { me, nowMs } = input;
  if (!me) return null;
  const until = nowMs + Math.max(input.horizonMs ?? 0, MEETING_HORIZON_MS);
  let best: NextMeeting | null = null;
  for (const e of events) {
    if (e.deletedAt || e.allDay || e.status === "cancelled" || e.ownerId !== me) continue;
    for (const occ of expandEventOccurrences(e, nowMs, until)) {
      if (occ.startMs <= nowMs || occ.startMs > until) continue;
      if (!best || occ.startMs < best.startsAt) {
        best = { title: e.title.trim() || "A meeting", startsAt: occ.startMs };
      }
    }
  }
  return best;
}

/**
 * Where the meeting divider goes (64): the tasks that fit before it, by their
 * estimates, sit above the line and the rest below; Now's remaining estimate
 * counts first. Without an estimate (Now's, or the next task's) nothing more
 * is known to fit, so the line goes there: at the top with none at all.
 * Returns the index in Up next the divider goes before (`upNext.length` =
 * after the last task).
 */
export function meetingSlot(
  upNext: readonly Task[],
  input: { nowMs: number; startsAt: number; hasNow: boolean; nowLeftMinutes: number | null },
): number {
  if (input.hasNow && input.nowLeftMinutes === null) return 0;
  let free = (input.startsAt - input.nowMs) / 60_000 - (input.nowLeftMinutes ?? 0);
  for (let i = 0; i < upNext.length; i++) {
    const est = estimateOf(upNext[i]);
    if (!est || est <= 0) return i;
    free -= est;
    if (free < 0) return i;
  }
  return upNext.length;
}

/** Minutes left of a task's estimate (its tracked time and unsaved seconds off); null without one. */
export function minutesLeft(task: Task, unsavedSeconds = 0): number | null {
  const est = estimateOf(task);
  if (!est || est <= 0) return null;
  return Math.max(0, est - (task.timeSpentSeconds + unsavedSeconds) / 60);
}

// ── Arrange by project (TV-F8, calls 57, 62) ────────────────────────────────

/** How many times a sequence changes project. */
export function projectSwitches(projectIds: readonly string[]): number {
  let n = 0;
  for (let i = 1; i < projectIds.length; i++) if (projectIds[i] !== projectIds[i - 1]) n++;
  return n;
}

/** Up next grouped by project, and how many switches that saves. */
export type Arrangement = { order: Task[]; saved: number };

/**
 * "Arrange by project" (57): Up next grouped by project, your order kept
 * inside each group. Now's project comes first (you're already in it), then
 * the projects holding a high-priority task, then the rest as they first
 * appear. `saved` counts switches from Now through the line-up, before minus
 * after; the header offers it only from two (62).
 */
export function arrangeByProject(now: Task | null, upNext: readonly Task[]): Arrangement {
  const groups = new Map<string, Task[]>();
  for (const t of upNext) {
    const list = groups.get(t.bucketId) ?? [];
    list.push(t);
    groups.set(t.bucketId, list);
  }
  const rank = (key: string, list: readonly Task[]) =>
    now && key === now.bucketId ? 0 : list.some((t) => t.priority === "high") ? 1 : 2;
  const order = [...groups.entries()]
    .map(([key, list], i) => ({ list, i, r: rank(key, list) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .flatMap(({ list }) => list);
  const head = now ? [now.bucketId] : [];
  const before = projectSwitches([...head, ...upNext.map((t) => t.bucketId)]);
  const after = projectSwitches([...head, ...order.map((t) => t.bucketId)]);
  return { order, saved: Math.max(0, before - after) };
}

/** The header offers "Arrange by project" only when it saves this many switches (62). */
export const ARRANGE_MIN_SAVED = 2;

/**
 * The whole line-up's order after arranging: the Up next tasks take the slots
 * Up next had, in their new order; Now and everything else keep their places.
 */
export function arrangedQueue(
  queueIds: readonly string[],
  upNextIds: readonly string[],
  arrangedIds: readonly string[],
): string[] {
  const moving = new Set(upNextIds);
  const next = [...arrangedIds];
  return queueIds.map((id) => (moving.has(id) ? (next.shift() ?? id) : id));
}

// ── the along-the-way offer (TV-F8, calls 57, 59a) ──────────────────────────

/** Quick tasks only: an estimate of this many minutes or less (57). */
export const ALONG_THE_WAY_MAX_MINUTES = 15;

/** After this many "Not now"s on one task, its offer becomes Shrink · Move · Let go (57). */
export const NOT_NOWS_TO_ASK = 3;

/**
 * The one quick task offered between two tasks (57, 59a): when the next task
 * is in another project, one open task from the project you're leaving, with
 * an estimate of 15 minutes or less, yours or nobody's, not lined up already,
 * not blocked and not waiting on anything. High priority first, then the
 * soonest due, then the smallest. Null when there's no project change, no next
 * task (the session is ending), or nothing fits.
 */
export function alongTheWayOffer(input: {
  leaving: Task;
  next: Task | null;
  tasks: readonly Task[];
  lineup: ReadonlySet<string>;
  me: string | null;
  blocked: ReadonlySet<string>;
  waiting: ReadonlySet<string>;
}): Task | null {
  const { leaving, next } = input;
  if (!next || next.bucketId === leaving.bucketId) return null;
  const fits = input.tasks.filter((t) => {
    if (t.bucketId !== leaving.bucketId || t.id === leaving.id) return false;
    if (t.parentId === leaving.id || t.deletedAt || t.id.startsWith("tmp-")) return false;
    if (!isOpenTask(t) || input.lineup.has(t.id)) return false;
    if (t.assigneeId && t.assigneeId !== input.me) return false;
    if (input.blocked.has(t.id) || input.waiting.has(t.id)) return false;
    const est = estimateOf(t);
    return !!est && est > 0 && est <= ALONG_THE_WAY_MAX_MINUTES;
  });
  const due = (t: Task) => t.dueDate ?? "9999-12-31";
  fits.sort(
    (a, b) =>
      Number(b.priority === "high") - Number(a.priority === "high") ||
      due(a).localeCompare(due(b)) ||
      (estimateOf(a) ?? 0) - (estimateOf(b) ?? 0) ||
      (a.position < b.position ? -1 : a.position > b.position ? 1 : 0),
  );
  return fits[0] ?? null;
}

// ── In flight (TV-F8; call 5's reshape of TV-F4) ────────────────────────────

/** One card of In flight: a hand-off, or my agent's work on a task. */
export type InFlightItem = {
  task: Task;
  /** Its live Waiting on… entries, oldest first. */
  waiting: TaskWaitingEntry[];
  /** My newest live agent session on it, if any. */
  agent: AgentSession | null;
  /** When the wait (or the agent's run) began. */
  since: string;
  /** My next check-back (epoch ms), if one is ahead. */
  nextCheckBack: number | null;
  /** A check-back passed with none ahead: time to look (the card brightens). */
  due: boolean;
  /** Due, or my agent needs me, is ready or failed. */
  attention: boolean;
};

/**
 * What's in flight for me (call 5: In flight is the run's view of hand-offs):
 * open tasks that wait on someone or something I put there, my lined-up tasks
 * that wait on anything, and tasks my own agent sessions are on. A check-back
 * is one of my reminders on the task timed after the wait began; it's due once
 * its time passed and no later one is set. Cards that need me come first, then
 * the longest-waiting.
 */
export function inFlightItems(input: {
  tasks: readonly Task[];
  waiting: readonly TaskWaitingEntry[];
  reminders: readonly TaskReminder[];
  agentSessions: readonly AgentSession[];
  lineup: ReadonlySet<string>;
  me: string | null;
  nowMs: number;
}): InFlightItem[] {
  const { me, nowMs } = input;
  if (!me) return [];
  const byTask = new Map<string, TaskWaitingEntry[]>();
  for (const w of input.waiting) {
    const list = byTask.get(w.taskId) ?? [];
    list.push(w);
    byTask.set(w.taskId, list);
  }
  const agents = new Map<string, AgentSession>();
  for (const s of input.agentSessions) {
    if (s.deletedAt || s.stoppedAt || s.userId !== me) continue;
    const prev = agents.get(s.taskId);
    if (!prev || s.updatedAt > prev.updatedAt) agents.set(s.taskId, s);
  }
  const out: InFlightItem[] = [];
  for (const task of input.tasks) {
    if (task.deletedAt || !isOpenTask(task) || task.id.startsWith("tmp-")) continue;
    const waits = [...(byTask.get(task.id) ?? [])].sort((a, b) => a.since.localeCompare(b.since));
    const mine = waits.some((w) => w.createdBy === me);
    const agent = agents.get(task.id) ?? null;
    if (!mine && !(waits.length > 0 && input.lineup.has(task.id)) && !agent) continue;
    const since = waits[0]?.since ?? agent?.startedAt ?? task.updatedAt;
    const sinceMs = Date.parse(since);
    let next: number | null = null;
    let passed = false;
    if (waits.length > 0) {
      for (const r of input.reminders) {
        if (r.taskId !== task.id || r.userId !== me || r.suspendedAt || !r.at) continue;
        const at = Date.parse(r.at);
        // A check-back is set for after the wait began (a minute's slack for clocks).
        if (Number.isNaN(at) || at < sinceMs - 60_000) continue;
        if (at <= nowMs) passed = true;
        else if (next === null || at < next) next = at;
      }
    }
    const due = passed && next === null;
    out.push({
      task,
      waiting: waits,
      agent,
      since,
      nextCheckBack: next,
      due,
      attention: due || (!!agent && agent.state !== "working"),
    });
  }
  return out.sort(
    (a, b) => Number(b.attention) - Number(a.attention) || a.since.localeCompare(b.since),
  );
}

/** The tasks that wait on anything: lined up, they're In flight, not Up next (TV-F8). */
export function waitingTaskIds(waiting: readonly Pick<TaskWaitingEntry, "taskId">[]): Set<string> {
  return new Set(waiting.map((w) => w.taskId));
}
