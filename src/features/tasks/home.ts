// Home's Tasks widgets (TV-H1, tasks-v3 §18, REPLAN ❓12, Chat's CH70): the
// pure rules behind the Tasks widget (Focus, else Open), the time widget (your
// tracked task time this week), the Team widget (each person's load) and the
// Upcoming widget. Everything reads the workspace's shared store, which holds
// only what the reader can see, so no count ever includes a hidden task. Pure:
// no React, no IO.

import { isOpenTask, taskCategoryOf } from "@contracts/vocabularies";

import { focusLineup } from "./focus-screen";
import { type TaskGroup, todayStr } from "./helpers";
import { estimateOf, type Task, type TaskQueueEntry, type TimeReportRow } from "./model";
import { queueEntriesOf } from "./queue";
import { isOtherTeamsWork, isUnclaimed } from "./teams";
import { inUpcoming, orderUpcoming, type UpcomingCoverage, upcomingGroups } from "./upcoming";

const bytewise = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const live = (t: Task) => !t.deletedAt;

// ── the Tasks widget ────────────────────────────────────────────────────────

export type FocusOrOpen = {
  rows: Task[];
  /** "Focus" (my line-up) or, when nothing is lined up, "Open". */
  heading: "Focus" | "Open";
  /** The row Focus would show as Now (the session's task, else the head). */
  nowId: string | null;
};

/**
 * The Home Tasks widget's rows (tasks-v2 decision 17, renamed by call 61):
 * my Focus line-up in Focus's own order — Now first (the task a session is on,
 * else the head of Up next), then Up next — headed "Focus"; when nothing is
 * lined up, the open tasks in list order, headed "Open", without unassigned
 * work routed to a team I'm not in (Upcoming's rule, default t).
 * `projectIds` narrows both to the widget's chosen projects (empty = all).
 */
export function focusOrOpen(input: {
  tasks: readonly Task[];
  queue: readonly TaskQueueEntry[];
  userId: string | null;
  projectIds?: readonly string[];
  /** The task a Focus session in this workspace is on, if any. */
  sessionTaskId?: string | null;
  myTeams?: ReadonlySet<string>;
}): FocusOrOpen {
  const projects = input.projectIds ?? [];
  const open = input.tasks.filter(
    (t) => live(t) && isOpenTask(t) && (projects.length === 0 || projects.includes(t.bucketId)),
  );
  const byId = new Map(open.map((t) => [t.id, t]));
  const queued = queueEntriesOf([...input.queue], input.userId)
    .map((e) => byId.get(e.taskId))
    .filter((t): t is Task => t !== undefined);
  const sessionTask = input.sessionTaskId ? (byId.get(input.sessionTaskId) ?? null) : null;
  const lineup = focusLineup(queued, sessionTask);
  const rows = lineup.now ? [lineup.now, ...lineup.upNext] : lineup.upNext;
  if (rows.length > 0) return { rows, heading: "Focus", nowId: lineup.now?.id ?? null };
  const myTeams = input.myTeams ?? new Set<string>();
  return {
    rows: open
      .filter((t) => !isOtherTeamsWork(t, myTeams))
      .sort((a, b) => bytewise(a.position, b.position)),
    heading: "Open",
    nowId: null,
  };
}

/**
 * Call 87 (TV-U13): finishing a task finishes its open subtasks too. The ones
 * a finishing parent takes along: its subtasks that are still to do (Backlog
 * included) and already saved. A subtask has none of its own, and a repeating
 * parent keeps its subtasks open (TV-D12 resets them per cycle); a parent
 * that's already finished takes nothing. The module's check-offs and Home's
 * Tasks widget share this rule.
 */
export function subtasksToFinish(
  parent: Pick<Task, "id" | "parentId" | "recurrence" | "status" | "statusCategory">,
  tasks: readonly Task[],
): Task[] {
  if (parent.parentId || parent.recurrence) return [];
  const category = taskCategoryOf(parent);
  if (category === "done" || category === "wont_do") return [];
  return tasks.filter((t) => {
    if (t.parentId !== parent.id || t.deletedAt || t.id.startsWith("tmp-")) return false;
    const c = taskCategoryOf(t);
    return c !== "done" && c !== "wont_do";
  });
}

// ── the time widget ─────────────────────────────────────────────────────────

export type WeekTimeLine = {
  taskId: string;
  title: string;
  /** Null when the reader can't see the project ("Private project"). */
  project: string | null;
  seconds: number;
};

export type WeekTime = {
  /** Your tracked time this week (each task's line, never below zero). */
  weekSeconds: number;
  /** Of it, today's. */
  todaySeconds: number;
  /** Your tasks with time this week, the most first. */
  lines: WeekTimeLine[];
};

/**
 * What the time widget shows, from the week's report rows (TV-D14's
 * `tasks_time_report`): only your own entries, even for the workspace owner
 * (whose report also carries teammates who share — decision 12 keeps
 * per-person time off Home). Each task sums its entries (a give-back nets
 * out) and never goes below zero, as the report sheet does (D14-7).
 */
export function weekTime(rows: readonly TimeReportRow[], today: string): WeekTime {
  const byTask = new Map<string, WeekTimeLine>();
  const todayByTask = new Map<string, number>();
  for (const row of rows) {
    if (!row.isMine) continue;
    const line = byTask.get(row.taskId);
    if (line) line.seconds += row.seconds;
    else
      byTask.set(row.taskId, {
        taskId: row.taskId,
        title: row.taskTitle,
        project: row.projectIsInbox ? "Inbox" : row.projectName,
        seconds: row.seconds,
      });
    if (row.day === today)
      todayByTask.set(row.taskId, (todayByTask.get(row.taskId) ?? 0) + row.seconds);
  }
  const lines = [...byTask.values()]
    .map((l) => ({ ...l, seconds: Math.max(0, l.seconds) }))
    .filter((l) => l.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
  const weekSeconds = lines.reduce((sum, l) => sum + l.seconds, 0);
  let todaySeconds = 0;
  // A task's day never counts more than its week (a give-back earlier in the
  // week nets today's time down with it).
  for (const [taskId, s] of todayByTask) {
    const week = byTask.get(taskId)?.seconds ?? 0;
    todaySeconds += Math.max(0, Math.min(s, week));
  }
  return { weekSeconds, todaySeconds, lines };
}

// ── the Team widget ─────────────────────────────────────────────────────────

/** A workspace member as the Team widget reads them. */
export type TeamPerson = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  /** Can take tasks (Tasks edit); a viewer is listed only with load. */
  canTakeTasks: boolean;
};

/** One person's load (decision 12): ownership, never time or runs. */
export type TeamLoadRow = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  isMe: boolean;
  /** Open tasks lined up in their Focus. */
  focus: number;
  /** The estimates of those, in minutes (planned time, never tracked). */
  focusMinutes: number;
  /** Assigned to them, In progress. */
  inProgress: number;
  /** Assigned to them, open, waiting on something. */
  waiting: number;
  /** Assigned to them, open, due by the end of this week (late ones too). */
  dueThisWeek: number;
};

export type TeamUnclaimed = { teamId: string; count: number };

export type TeamLoad = { rows: TeamLoadRow[]; unclaimed: TeamUnclaimed[] };

const hasLoad = (r: TeamLoadRow) =>
  r.focus > 0 || r.inProgress > 0 || r.waiting > 0 || r.dueThisWeek > 0;

/** A task's due day ("2026-10-16"), or null. */
function dueDayOf(task: Pick<Task, "dueOn" | "dueDate">): string | null {
  if (task.dueOn) return task.dueOn;
  if (!task.dueDate) return null;
  const d = new Date(task.dueDate);
  return Number.isNaN(d.getTime()) ? null : todayStr(d);
}

/**
 * The Team widget's rows (decision 12, CH70): one per person — the members
 * who can take tasks, plus anyone else who has load — me first, then by
 * name. With `teamId`, only that team's members, and its unclaimed count;
 * without, every team with unclaimed work. Counts are over the tasks given
 * (the reader's copy: only what they can see), open ones only (Backlog is
 * parked); a queue row whose task isn't in the copy counts for nothing.
 */
export function teamLoad(input: {
  tasks: readonly Task[];
  queue: readonly TaskQueueEntry[];
  waitingTaskIds: ReadonlySet<string>;
  people: readonly TeamPerson[];
  teamMembers: readonly { teamId: string; userId: string }[];
  /** The teams there are (an unknown `teamId` falls back to everyone). */
  teamIds: readonly string[];
  teamId?: string | null;
  me: string | null;
  /** The last day of this week ("2026-10-18"), Time & region's week. */
  weekEnd: string;
}): TeamLoad {
  const open = input.tasks.filter((t) => live(t) && isOpenTask(t));
  const openById = new Map(open.map((t) => [t.id, t]));
  const team = input.teamId && input.teamIds.includes(input.teamId) ? input.teamId : null;
  const inTeam = team
    ? new Set(input.teamMembers.filter((m) => m.teamId === team).map((m) => m.userId))
    : null;

  const rowOf = new Map<string, TeamLoadRow>();
  for (const p of input.people) {
    if (inTeam && !inTeam.has(p.userId)) continue;
    rowOf.set(p.userId, {
      userId: p.userId,
      name: p.name,
      avatarUrl: p.avatarUrl,
      isMe: p.userId === input.me,
      focus: 0,
      focusMinutes: 0,
      inProgress: 0,
      waiting: 0,
      dueThisWeek: 0,
    });
  }

  const counted = new Set<string>();
  for (const e of input.queue) {
    const row = rowOf.get(e.userId);
    const task = openById.get(e.taskId);
    // One person's row per task (a queue holds a task once).
    const key = `${e.userId}:${e.taskId}`;
    if (!row || !task || counted.has(key)) continue;
    counted.add(key);
    row.focus += 1;
    row.focusMinutes += Math.max(0, estimateOf(task) ?? 0);
  }
  for (const task of open) {
    const row = task.assigneeId ? rowOf.get(task.assigneeId) : undefined;
    if (!row) continue;
    if (taskCategoryOf(task) === "in_progress") row.inProgress += 1;
    if (input.waitingTaskIds.has(task.id)) row.waiting += 1;
    const due = dueDayOf(task);
    if (due && due <= input.weekEnd) row.dueThisWeek += 1;
  }

  const canTake = new Set(input.people.filter((p) => p.canTakeTasks).map((p) => p.userId));
  const rows = [...rowOf.values()]
    .filter((r) => canTake.has(r.userId) || hasLoad(r))
    .sort(
      (a, b) =>
        Number(b.isMe) - Number(a.isMe) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        bytewise(a.userId, b.userId),
    );

  const unclaimedCount = new Map<string, number>();
  for (const task of open) {
    if (!isUnclaimed(task)) continue;
    const id = task.teamId as string;
    if (team && id !== team) continue;
    unclaimedCount.set(id, (unclaimedCount.get(id) ?? 0) + 1);
  }
  const unclaimed = input.teamIds
    .filter((id) => unclaimedCount.has(id))
    .map((teamId) => ({ teamId, count: unclaimedCount.get(teamId) ?? 0 }));

  return { rows, unclaimed };
}

/**
 * A person's load as one quiet line: "Focus 3 · ~2h · 1 in progress ·
 * 1 waiting · 2 due this week". Zeros drop out; nothing at all reads "Nothing
 * lined up".
 */
export function loadLine(row: TeamLoadRow, formatMinutes: (m: number) => string): string {
  const parts: string[] = [];
  if (row.focus > 0) {
    parts.push(`Focus ${row.focus}`);
    if (row.focusMinutes > 0) parts.push(`~${formatMinutes(row.focusMinutes)}`);
  }
  if (row.inProgress > 0) parts.push(`${row.inProgress} in progress`);
  if (row.waiting > 0) parts.push(`${row.waiting} waiting`);
  if (row.dueThisWeek > 0) parts.push(`${row.dueThisWeek} due this week`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing lined up";
}

// ── the Upcoming widget ─────────────────────────────────────────────────────

/**
 * The Upcoming widget's groups: Upcoming's own coverage, order and day groups
 * (TV-U15), open tasks only, and only the days that hold work (a glance, not
 * a drop target).
 */
export function upcomingForHome(
  tasks: readonly Task[],
  coverage: UpcomingCoverage,
  now: Date,
  projectRank: (bucketId: string) => number,
): TaskGroup[] {
  const scope = tasks.filter((t) => isOpenTask(t) && inUpcoming(t, coverage, now));
  return upcomingGroups(orderUpcoming(scope, projectRank), now).filter((g) => g.tasks.length > 0);
}
