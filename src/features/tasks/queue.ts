// Personal queues in the app (TV-D4): the pure rules behind "my queue", the
// claims other people's queues put on a task, and how a drag in the Queue
// becomes one move. The rows come from `task_queue` (TV-D2): one per person and
// task, ordered by `position` within a person (bytewise, like every fractional
// key in the app). A task leaves every queue when it's done, archived or
// deleted; restoring it never puts it back.

import { isOpenTask } from "@contracts/vocabularies";
import { betweenPositions } from "./helpers";
import type { Task, TaskQueueEntry } from "./model";

const bytewise = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One person's line-up, in order. */
export function queueEntriesOf(entries: TaskQueueEntry[], userId: string | null): TaskQueueEntry[] {
  if (!userId) return [];
  return entries
    .filter((e) => e.userId === userId)
    .sort((a, b) => bytewise(a.position, b.position) || bytewise(a.id, b.id));
}

/**
 * Who else has each task queued (claims, "In Mike's queue"): task id → their
 * user ids, earliest queued first. My own rows are left out.
 */
export function claimsByTask(
  entries: TaskQueueEntry[],
  userId: string | null,
): Map<string, string[]> {
  const others = entries
    .filter((e) => e.userId !== userId)
    .sort((a, b) => bytewise(a.queuedAt, b.queuedAt) || bytewise(a.userId, b.userId));
  const map = new Map<string, string[]>();
  for (const e of others) {
    const list = map.get(e.taskId);
    if (!list) map.set(e.taskId, [e.userId]);
    else if (!list.includes(e.userId)) list.push(e.userId);
  }
  return map;
}

/**
 * The tasks of my queue in line-up order. `kept` are my rows for tasks
 * completed in this session: the server has dropped them, but the Queue keeps
 * showing them done, where they were, until the next load (tasks-v2 §6).
 * Tasks the list doesn't have (not loaded, no longer shared) are skipped, and
 * so are archived ones. A kept row goes once its task is no longer done (a
 * teammate reopened it live, TV-D5): the server no longer has it queued.
 */
export function queueTasks(mine: TaskQueueEntry[], kept: TaskQueueEntry[], tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stillDone = kept.filter((row) => byId.get(row.taskId)?.status === "done");
  const rows = [...mine, ...stillDone].sort(
    (a, b) => bytewise(a.position, b.position) || bytewise(a.id, b.id),
  );
  const out: Task[] = [];
  for (const row of rows) {
    if (seen.has(row.taskId)) continue;
    seen.add(row.taskId);
    const task = byId.get(row.taskId);
    if (task && task.status !== "archived") out.push(task);
  }
  return out;
}

/** My open queued tasks: the Queue row's count. */
export function openQueueCount(queued: Task[]): number {
  return queued.filter((t) => isOpenTask(t)).length;
}

/**
 * Replace my rows in a workspace with what a queue op returned (it answers
 * with my whole queue there).
 */
export function withOwnQueue(
  entries: TaskQueueEntry[],
  workspaceId: string,
  userId: string,
  own: TaskQueueEntry[],
): TaskQueueEntry[] {
  return [...entries.filter((e) => e.userId !== userId || e.workspaceId !== workspaceId), ...own];
}

/** Every person's row for a task goes (done, archived, deleted). */
export function withoutTask(entries: TaskQueueEntry[], taskId: string): TaskQueueEntry[] {
  return entries.some((e) => e.taskId === taskId)
    ? entries.filter((e) => e.taskId !== taskId)
    : entries;
}

/** A position after everything in my queue, for an optimistic add at the end. */
export function endOfQueue(mine: TaskQueueEntry[]): string {
  const last = mine[mine.length - 1];
  return betweenPositions(last?.position ?? null, null);
}

/**
 * A drag in the Queue reorders the visible ids; the server moves one task to
 * right after another (or to the top). Finds the task that moved and the
 * queued task it now follows. `queuedIds` is my queue on the server, in order;
 * ids in `orderedIds` that aren't in it (a task just checked off and still
 * showing) are skipped as anchors. Null when nothing queued moved.
 */
export function queueMove(
  queuedIds: string[],
  orderedIds: string[],
): { taskId: string; afterTaskId: string | null } | null {
  const queued = new Set(queuedIds);
  const next = orderedIds.filter((id) => queued.has(id));
  const prev = queuedIds.filter((id) => next.includes(id));
  if (next.length !== prev.length || next.every((id, i) => id === prev[i])) return null;
  // One item moved: it's the one whose removal makes both orders agree. With a
  // single drag that's the first index where they differ, on one side or the
  // other.
  const first = next.findIndex((id, i) => id !== prev[i]);
  const candidates = [next[first], prev[first]];
  for (const taskId of candidates) {
    const a = next.filter((id) => id !== taskId);
    const b = prev.filter((id) => id !== taskId);
    if (a.every((id, i) => id === b[i])) {
      const at = next.indexOf(taskId);
      return { taskId, afterTaskId: at > 0 ? next[at - 1] : null };
    }
  }
  return null;
}

/**
 * Where a moved row sits until the server answers: between the queued task it
 * now follows and the one after that.
 */
export function movedPosition(
  mine: TaskQueueEntry[],
  taskId: string,
  afterTaskId: string | null,
): string {
  const rest = mine.filter((e) => e.taskId !== taskId);
  const at = afterTaskId ? rest.findIndex((e) => e.taskId === afterTaskId) : -1;
  const before = at >= 0 ? rest[at].position : null;
  const after = rest[at + 1]?.position ?? null;
  return betweenPositions(before, after);
}

/**
 * The single moves (`opQueueReorder`'s shape) that turn `current` into
 * `target` (TV-F8's "Arrange by project", and its Undo): walking the target,
 * each task out of place moves right after the one before it. Ids in only one
 * of the two lists are left alone.
 */
export function queueMoves(
  current: readonly string[],
  target: readonly string[],
): { taskId: string; afterTaskId: string | null }[] {
  const shared = new Set(current);
  const goal = target.filter((id) => shared.has(id));
  const inGoal = new Set(goal);
  const order = current.filter((id) => inGoal.has(id));
  const moves: { taskId: string; afterTaskId: string | null }[] = [];
  goal.forEach((id, i) => {
    if (order[i] === id) return;
    order.splice(order.indexOf(id), 1);
    order.splice(i, 0, id);
    moves.push({ taskId: id, afterTaskId: i > 0 ? goal[i - 1] : null });
  });
  return moves;
}

/** My line-up after `moves`, each placed like a drag would place it (shown until the server answers). */
export function applyQueueMoves(
  mine: readonly TaskQueueEntry[],
  moves: readonly { taskId: string; afterTaskId: string | null }[],
): TaskQueueEntry[] {
  const byPosition = (a: TaskQueueEntry, b: TaskQueueEntry) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  let rows = [...mine].sort(byPosition);
  for (const m of moves) {
    const position = movedPosition(rows, m.taskId, m.afterTaskId);
    rows = rows.map((e) => (e.taskId === m.taskId ? { ...e, position } : e)).sort(byPosition);
  }
  return rows;
}

function possessive(name: string): string {
  return `${name}’s`;
}

/** "Mike's", "Mike's and Ola's", "Mike's, Ola's and Sam's". */
function possessives(names: string[]): string {
  const parts = names.map(possessive);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The claim marker's words: "In Mike's Focus" / "In Mike's and Ola's Focus"
 * (call 61: the Queue is called Focus; the data keeps "queue").
 */
export function claimLabel(names: string[]): string {
  if (names.length === 0) return "";
  return `In ${possessives(names)} Focus`;
}

/** The note after adding a task to Focus that someone else has too (D4-2). */
export function alsoInLabel(names: string[]): string {
  if (names.length === 0) return "";
  return `Also in ${possessives(names)} Focus`;
}

/**
 * The Home Tasks widget's rows (tasks-v2 decision 17): my queue's open tasks
 * in order, headed "Queue"; when that's empty, the open tasks in list order,
 * headed "Open". `bucketIds` narrows both to the widget's chosen buckets
 * (empty = all).
 */
export function queueOrOpen(
  tasks: Task[],
  entries: TaskQueueEntry[],
  userId: string | null,
  bucketIds: string[] = [],
): { rows: Task[]; heading: "Queue" | "Open" } {
  const open = tasks.filter(
    (t) =>
      !t.deletedAt && isOpenTask(t) && (bucketIds.length === 0 || bucketIds.includes(t.bucketId)),
  );
  const byId = new Map(open.map((t) => [t.id, t]));
  const queued = queueEntriesOf(entries, userId)
    .map((e) => byId.get(e.taskId))
    .filter((t): t is Task => t !== undefined);
  if (queued.length > 0) return { rows: queued, heading: "Queue" };
  return {
    rows: open.slice().sort((a, b) => bytewise(a.position, b.position)),
    heading: "Open",
  };
}
