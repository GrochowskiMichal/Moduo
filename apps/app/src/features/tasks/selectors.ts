// The Tasks data every surface derives from the shared store's snapshot
// (TV-D11a), as pure selectors. Each is cached on the identity of its inputs:
// the store keeps an unchanged table's array between snapshots, so a write to
// one task recomputes only what reads the tasks, and five pages that show the
// same workspace share one result instead of each building their own maps.
//
// Cached in a WeakMap keyed by the first input (a row array or a map), so a
// workspace's results go when its arrays do; the second input (a user id, a
// day, a second array) is compared by identity against the last call.

import { isOpenTask } from "@contracts/vocabularies";
import type { StoreSnapshot } from "../../lib/sync/store";
import { blockedTaskIds, frontierTasks, subtaskProgress, subtasksByParent } from "./helpers";
import {
  type Area,
  type Bucket,
  isDrifted,
  type ProjectStatus,
  type Task,
  type TaskQueueEntry,
  type TaskRelation,
} from "./model";
import { claimsByTask, openQueueCount, queueEntriesOf, queueTasks } from "./queue";
import { statusSetFor } from "./statuses";
import { nowOn } from "./use-today";

type Bundle = StoreSnapshot["bundle"];

/** One empty list for every absent collection (a stable identity). */
const NO_ROWS: never[] = [];

function cached<A extends object, R>(fn: (a: A) => R): (a: A) => R {
  const memo = new WeakMap<A, R>();
  return (a) => {
    if (memo.has(a)) return memo.get(a) as R;
    const result = fn(a);
    memo.set(a, result);
    return result;
  };
}

function cached2<A extends object, B, R>(fn: (a: A, b: B) => R): (a: A, b: B) => R {
  const memo = new WeakMap<A, { b: B; result: R }>();
  return (a, b) => {
    const hit = memo.get(a);
    if (hit && Object.is(hit.b, b)) return hit.result;
    const result = fn(a, b);
    memo.set(a, { b, result });
    return result;
  };
}

function cached3<A extends object, B, C, R>(fn: (a: A, b: B, c: C) => R): (a: A, b: B, c: C) => R {
  const memo = new WeakMap<A, { b: B; c: C; result: R }>();
  return (a, b, c) => {
    const hit = memo.get(a);
    if (hit && Object.is(hit.b, b) && Object.is(hit.c, c)) return hit.result;
    const result = fn(a, b, c);
    memo.set(a, { b, c, result });
    return result;
  };
}

function byPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

const livePositioned = <T extends { position: string; deletedAt?: string | null }>(rows: T[]) =>
  rows.filter((r) => !r.deletedAt).sort(byPosition);

// ── rows ─────────────────────────────────────────────────────────────────────

/** Visible and archived buckets together: an archive's Undo edits rows still archived. */
export const allBucketsOf = (bundle: Bundle): Bucket[] =>
  joinArchived(bundle.buckets, bundle.archivedBuckets);
/** Visible and archived tasks together, for lookups that must see both. */
export const allTasksOf = (bundle: Bundle): Task[] =>
  joinArchived(bundle.tasks, bundle.archivedTasks);

const joinArchived = cached2(<T>(rows: T[], archived: T[] | undefined): T[] =>
  archived?.length ? [...rows, ...archived] : rows,
) as <T>(rows: T[], archived: T[] | undefined) => T[];

/** Live (not deleted) buckets, in the store's order: the Inbox included. */
export const liveBucketsOf = cached((buckets: Bucket[]) => buckets.filter((b) => !b.deletedAt));

/** Your own Inbox (a teammate's may be visible too, so prefer yours). */
export const inboxOf = cached2((buckets: Bucket[], userId: string | null): Bucket | null => {
  const live = liveBucketsOf(buckets);
  return (
    live.find((b) => b.isSystem && b.ownerId === userId) ?? live.find((b) => b.isSystem) ?? null
  );
});

/** User buckets (the Inbox excluded: the rail pins it), position-sorted. */
export const userBucketsOf = cached((buckets: Bucket[]) =>
  liveBucketsOf(buckets)
    .filter((b) => !b.isSystem)
    .sort(byPosition),
);

/** Live tasks, position-sorted. */
export const liveTasksOf = cached((tasks: Task[]) => livePositioned(tasks));

/** Archived projects, position-sorted (Archived projects, TV-U6). */
export const archivedBucketsOf = cached((rows: Bucket[]) => livePositioned(rows));

/** Tasks of archived projects: only an opened archived project and search show them. */
export const archivedTasksOf = cached((rows: Task[]) => livePositioned(rows));

/** The workspace's areas you can see, in sidebar order (TV-D10). */
export const areasOf = cached((areas: Area[]) =>
  areas.slice().sort((a, b) => a.position - b.position),
);

export const areasOfBundle = (bundle: Bundle): Area[] => areasOf(bundle.areas ?? NO_ROWS);
export const statusesOfBundle = (bundle: Bundle): ProjectStatus[] => bundle.statuses ?? NO_ROWS;

// ── lookups ──────────────────────────────────────────────────────────────────

/** Any rows by id. Shared, so the views stop building their own. */
export const byIdOf = cached(
  <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r])),
) as <T extends { id: string }>(rows: T[]) => Map<string, T>;

export const statusByIdOf = (statuses: ProjectStatus[]) => byIdOf(statuses);

/** The statuses a project's tasks use (the Inbox: the workspace default). */
export function statusesForBucketOf(
  statuses: ProjectStatus[],
  allBuckets: Bucket[],
  bucketId: string,
): ProjectStatus[] {
  return statusSetFor(statuses, byIdOf(allBuckets).get(bucketId));
}

// ── counts ───────────────────────────────────────────────────────────────────

function countBy(tasks: Task[], keep: (t: Task) => boolean): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (keep(t)) counts.set(t.bucketId, (counts.get(t.bucketId) ?? 0) + 1);
  }
  return counts;
}

/** Open (To do / In progress) tasks per project: the sidebar counts. Backlog sits out (TV-D9). */
export const openTaskCountByBucketOf = cached((liveTasks: Task[]) =>
  countBy(liveTasks, isOpenTask),
);

/** Every task a bucket's own list shows (open + done, not archived): the delete confirm's count. */
export const taskCountByBucketOf = cached((liveTasks: Task[]) =>
  countBy(liveTasks, (t) => t.status !== "archived"),
);

/**
 * Soft per-bucket drift counts (scheduled and passed, still open). Keyed by
 * `today` so it rolls over at midnight (`useToday`), not only on the next write.
 */
export const driftCountByBucketOf = cached2((liveTasks: Task[], today: string) => {
  const now = nowOn(today);
  return countBy(liveTasks, (t) => isDrifted(t, now));
});

// ── subtasks and blockers ────────────────────────────────────────────────────

/**
 * Live, non-archived children keyed by parent id (position order). Archived is
 * terminal; an unresolvable parent reads as top-level (children are never lost).
 */
export const subtasksByParentOf = cached((liveTasks: Task[]) =>
  subtasksByParent(liveTasks.filter((t) => t.status !== "archived")),
);

/** Quiet n/m per parent: the progress mirror on rows, cards and the panel. */
export const subtaskProgressByTaskOf = cached((liveTasks: Task[]) => {
  const map = new Map<string, { done: number; total: number }>();
  for (const [parentId, children] of subtasksByParentOf(liveTasks)) {
    map.set(parentId, subtaskProgress(children));
  }
  return map;
});

/** Tasks with at least one live, open blocker (spec §5c). */
export const blockedTaskIdsOf = cached2((liveTasks: Task[], relations: TaskRelation[]) =>
  blockedTaskIds(liveTasks, relations),
);

function edgesBy(
  liveTasks: Task[],
  relations: TaskRelation[],
  from: (r: TaskRelation) => string,
  to: (r: TaskRelation) => string,
): Map<string, Task[]> {
  const byId = byIdOf(liveTasks);
  const map = new Map<string, Task[]>();
  for (const rel of relations) {
    const task = byId.get(to(rel));
    if (!task) continue; // inert edge: that task was deleted
    const key = from(rel);
    const list = map.get(key);
    if (list) list.push(task);
    else map.set(key, [task]);
  }
  return map;
}

/** Live blocker tasks per blocked task (the detail panel's "Blocked by"). */
export const blockersByTaskOf = cached2((liveTasks: Task[], relations: TaskRelation[]) =>
  edgesBy(
    liveTasks,
    relations,
    (r) => r.blockedTaskId,
    (r) => r.blockerTaskId,
  ),
);

/** Live dependent tasks per blocker (the read-only "Blocks" list). */
export const dependentsByTaskOf = cached2((liveTasks: Task[], relations: TaskRelation[]) =>
  edgesBy(
    liveTasks,
    relations,
    (r) => r.blockerTaskId,
    (r) => r.blockedTaskId,
  ),
);

/** The unblocked frontier of a task: "what's actually next" (spec §5c). */
export const frontierOf = (liveTasks: Task[], relations: TaskRelation[], taskId: string): Task[] =>
  frontierTasks(taskId, liveTasks, relations);

// ── personal queues (TV-D4) ──────────────────────────────────────────────────

/** Queue rows of this workspace only (the store keeps one workspace's, but rows may lag a switch). */
export const workspaceQueueRowsOf = cached2((rows: TaskQueueEntry[], workspaceId: string | null) =>
  rows.filter((e) => e.workspaceId === workspaceId),
);

/** My line-up, in order: what the server holds, plus optimistic edits. */
export const myQueueEntriesOf = cached2((rows: TaskQueueEntry[], userId: string | null) =>
  queueEntriesOf(rows, userId),
);

export const queuedTaskIdsOf = cached(
  (mine: TaskQueueEntry[]) => new Set(mine.map((e) => e.taskId)),
);

/** Who else has each task queued (user ids, earliest first). */
export const queueClaimsOf = cached2((rows: TaskQueueEntry[], userId: string | null) =>
  claimsByTask(rows, userId),
);

/** My queue's tasks in order, with the ones I just completed still in place. */
export const queuedTasksOf = cached3(
  (mine: TaskQueueEntry[], kept: TaskQueueEntry[], liveTasks: Task[]) =>
    queueTasks(mine, kept, liveTasks),
);

/** The rail's Queue count: my open queued tasks. */
export const queueCountOf = cached((queued: Task[]) => openQueueCount(queued));

// ── one snapshot's Tasks data ────────────────────────────────────────────────

/**
 * Everything the Tasks hook shows and its commands read, from one snapshot.
 * Only cached selectors, so it costs a few lookups; cached on the snapshot
 * too, so a render and a command reading the same snapshot share one object.
 * Archived projects and their tasks ride apart in the bundle (TV-U6): `all*`
 * see both (an archive's Undo edits rows still archived), the rest don't.
 */
export const tasksDataOf = cached3(
  (snap: StoreSnapshot, userId: string | null, workspaceId: string | null) => {
    const bundle = snap.bundle;
    const liveTasks = liveTasksOf(bundle.tasks);
    const statuses = statusesOfBundle(bundle);
    // Each person has their own Queue (TV-D4); rows of other people are claims.
    const queueRows = workspaceQueueRowsOf(snap.queue, workspaceId);
    const myQueueEntries = myQueueEntriesOf(queueRows, userId);
    const queuedTasks = queuedTasksOf(
      myQueueEntries,
      workspaceQueueRowsOf(snap.kept, workspaceId),
      liveTasks,
    );
    return {
      bundle,
      /** Visible and archived projects together. */
      allBuckets: allBucketsOf(bundle),
      /** Visible and archived tasks together. */
      allTasks: allTasksOf(bundle),
      liveBuckets: liveBucketsOf(bundle.buckets),
      /** Your own Inbox (a teammate's may be visible too). */
      inbox: inboxOf(bundle.buckets, userId),
      liveTasks,
      archivedBuckets: archivedBucketsOf(bundle.archivedBuckets ?? NO_ROWS),
      archivedTasks: archivedTasksOf(bundle.archivedTasks ?? NO_ROWS),
      /** User buckets (Inbox excluded — the rail pins it), position-sorted. */
      buckets: userBucketsOf(bundle.buckets),
      areas: areasOfBundle(bundle),
      sections: bundle.sections ?? NO_ROWS,
      statuses,
      statusById: statusByIdOf(statuses),
      openTaskCountByBucket: openTaskCountByBucketOf(liveTasks),
      taskCountByBucket: taskCountByBucketOf(liveTasks),
      subtasksByParent: subtasksByParentOf(liveTasks),
      subtaskProgressByTask: subtaskProgressByTaskOf(liveTasks),
      blockedIds: blockedTaskIdsOf(liveTasks, bundle.taskRelations),
      blockersByTask: blockersByTaskOf(liveTasks, bundle.taskRelations),
      dependentsByTask: dependentsByTaskOf(liveTasks, bundle.taskRelations),
      /** Every queue row I can see (TV-D2), any workspace's: what a status change takes out. */
      allQueueRows: snap.queue,
      /** My line-up, in order (what the server holds, plus optimistic edits). */
      myQueueEntries,
      queuedTaskIds: queuedTaskIdsOf(myQueueEntries),
      queueClaims: queueClaimsOf(queueRows, userId),
      queuedTasks,
      queueCount: queueCountOf(queuedTasks),
      /** Your own reminders (TV-D12). */
      reminders: snap.reminders,
      offline: snap.offline,
    };
  },
);

export type TasksData = ReturnType<typeof tasksDataOf>;
