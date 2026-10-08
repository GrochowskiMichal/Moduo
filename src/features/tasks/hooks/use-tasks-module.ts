// Data hook for the Tasks module. Loads the workspace bundle and exposes
// optimistic CRUD over buckets and tasks. Mutations update local state first for
// snappy, keyboard-driven editing; on error they reload from the source of truth
// and surface a toast. Drift is computed client-side via isDrifted().

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TAG_LINKS_SCOPE } from "../../../lib/paged-select";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { editableTaskFields } from "../../../lib/task-rows";
import { undoToast } from "../../../lib/undo-toast";
import { formatAwaySpan } from "../../focus/away-copy";
import type { FocusSaveContext } from "../../focus/engine";
import {
  createOrAttachByName,
  deleteTag as deleteWorkspaceTag,
  recolorTag,
  seedTags,
  type TagContext,
  toggleTag,
  useTagView,
} from "../../tags/store";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { setBucketTimeBlock } from "../default-view";
import { bucketMovePatches } from "../dnd/rail-drop";
import {
  betweenPositions,
  blockedTaskIds as computeBlockedTaskIds,
  subtasksByParent as computeSubtasksByParent,
  endPosition,
  formatScheduled,
  frontierTasks,
  makeTask,
  type NewTaskFields,
  subtaskProgress,
  wouldCreateCycle,
} from "../helpers";
import { hideBucket, unhideBucket, useHiddenBuckets } from "../hidden-buckets";
import {
  type ActivityEntry,
  type Bucket,
  INBOX_BUCKET_NAME,
  isDrifted,
  type QueuePlacement,
  type RecurrenceRule,
  type Tag,
  type Task,
  type TaskQueueEntry,
  type TaskRelation,
  type TaskStatus,
  type TasksCatchUpItem,
  type TasksModuleBundle,
  type TaskTimeResult,
  type TimeBlockMap,
  type TimeBlockSlot,
  type TrackTimeInput,
} from "../model";
import {
  alsoInLabel,
  claimsByTask,
  endOfQueue,
  movedPosition,
  openQueueCount,
  queueEntriesOf,
  queueMove,
  queueTasks,
  withOwnQueue,
  withoutTask,
} from "../queue";
import {
  catchUpItem,
  catchUpPatch,
  recurrenceOnStatusChange,
  skipOccurrencePatch,
} from "../recurrence-engine";

/** An adjustment `logTimeAdjustment` recorded, as its Undo needs it. */
export type TimeAdjustment = {
  /** The entry to remove; null on a database without time entries yet. */
  entryId: string | null;
  seconds: number;
};

type Params = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
};

const EMPTY_BUNDLE: TasksModuleBundle = {
  buckets: [],
  tasks: [],
  tags: [],
  tagLinks: [],
  taskRelations: [],
  truncated: [],
};

function byPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/** Optimistic placeholder id, not yet a real server uuid. */
const isTempId = (id: string) => id.startsWith("tmp-");

export function useTasksModule(runtime: ModuoRuntime | null, params: Params) {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [bundle, setBundle] = useState<TasksModuleBundle>(EMPTY_BUNDLE);
  /** Every queue row I can see here (TV-D2): my line-up and others' claims. */
  const [queueRows, setQueueRows] = useState<TaskQueueEntry[]>([]);
  /** My rows for tasks completed since the last load: the server has dropped
   *  them, but the Queue keeps showing them, done, where they were (§6). */
  const [keptRows, setKeptRows] = useState<TaskQueueEntry[]>([]);
  /** Queue ops go to the server one at a time, in the order they were made,
   *  so each answer (my whole queue) includes every earlier op; only the newest
   *  answer is applied, so pending optimistic edits aren't put back meanwhile. */
  const queueSeq = useRef(0);
  const queueChain = useRef<Promise<unknown>>(Promise.resolve());
  const [timeBlocks, setTimeBlocksState] = useState<TimeBlockMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);
  /** Bumped on every successful load — the recurrence catch-up trigger. */
  const [loadStamp, setLoadStamp] = useState(0);

  const load = useCallback(async () => {
    if (!runtime || !userId || !workspaceId || !canRead) {
      setBundle(EMPTY_BUNDLE);
      setQueueRows([]);
      setKeptRows([]);
      setTimeBlocksState({});
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    const startedAt = Date.now();
    setLoading(true);
    try {
      // Time-blocks ride along with the bundle but never block it — a failed
      // read just means the default view skips the time-block step. The
      // queues are part of the list: a failed read fails the load.
      const [next, queue, blocks] = await Promise.all([
        runtime.tasks.list(workspaceId),
        runtime.tasks.listQueue(workspaceId),
        runtime.tasks.getTimeBlocks(workspaceId).catch((): TimeBlockMap => ({})),
      ]);
      if (reqRef.current === req) {
        setBundle(next);
        setQueueRows(queue);
        setKeptRows([]);
        // Tags live in the workspace tag store, shared by every surface (TV-T1).
        seedTags(workspaceId, {
          tags: next.tags,
          links: next.tagLinks,
          scope: { kind: "all" },
          at: startedAt,
          complete: !next.truncated.some((t) => t.scope === TAG_LINKS_SCOPE),
        });
        setTimeBlocksState(blocks);
        setError(null);
        setLoadStamp((s) => s + 1); // triggers the recurrence catch-up pass
      }
    } catch (e) {
      if (reqRef.current === req) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqRef.current === req) setLoading(false);
    }
  }, [runtime, userId, workspaceId, canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── derived ────────────────────────────────────────────────────────────────
  // Buckets deleted this session drop out here, and their tasks show in Inbox,
  // before the server delete lands (see `deleteBucket` and hidden-buckets.ts).
  const hiddenBuckets = useHiddenBuckets();
  const liveBuckets = useMemo(
    () => bundle.buckets.filter((b) => !b.deletedAt && !hiddenBuckets.has(b.id)),
    [bundle.buckets, hiddenBuckets],
  );
  const inbox = useMemo(() => liveBuckets.find((b) => b.isSystem) ?? null, [liveBuckets]);
  const liveTasks = useMemo(() => {
    const live = bundle.tasks
      .filter((t) => !t.deletedAt)
      .slice()
      .sort(byPosition);
    const inboxId = inbox?.id;
    if (hiddenBuckets.size === 0 || !inboxId) return live;
    return live.map((t) => (hiddenBuckets.has(t.bucketId) ? { ...t, bucketId: inboxId } : t));
  }, [bundle.tasks, hiddenBuckets, inbox]);
  /** User buckets (Inbox excluded — the rail pins it), position-sorted. */
  const buckets = useMemo(
    () =>
      liveBuckets
        .filter((b) => !b.isSystem)
        .slice()
        .sort(byPosition),
    [liveBuckets],
  );

  const openTaskCountByBucket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of liveTasks) {
      if (t.status === "done" || t.status === "archived") continue;
      counts.set(t.bucketId, (counts.get(t.bucketId) ?? 0) + 1);
    }
    return counts;
  }, [liveTasks]);

  /** Every task a bucket's own list shows (open + done, not archived) — the
   * count the delete-bucket confirm and its toast quote. */
  const taskCountByBucket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of liveTasks) {
      if (t.status === "archived") continue;
      counts.set(t.bucketId, (counts.get(t.bucketId) ?? 0) + 1);
    }
    return counts;
  }, [liveTasks]);

  // ── subtasks (one level) ─────────────────────────────────────────────────────
  /** Live, non-archived children keyed by parent id (position order). Archived
   * is terminal — out of open lists and the n/m mirror. Unresolvable parents
   * are ignored — those tasks read as top-level (children are never lost). */
  const subtasksByParent = useMemo(
    () => computeSubtasksByParent(liveTasks.filter((t) => t.status !== "archived")),
    [liveTasks],
  );

  /** Quiet n/m per parent — the ambient progress mirror on rows/cards/panel. */
  const subtaskProgressByTask = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const [parentId, children] of subtasksByParent) {
      map.set(parentId, subtaskProgress(children));
    }
    return map;
  }, [subtasksByParent]);

  // ── blocked-by dependencies (spec §5c) ───────────────────────────────────────
  /** Computed blocked state (drift pattern): tasks with ≥1 live, open blocker. */
  const blockedIds = useMemo(
    () => computeBlockedTaskIds(liveTasks, bundle.taskRelations),
    [liveTasks, bundle.taskRelations],
  );

  /** Live blocker tasks per blocked task (the detail panel's "Blocked by"). */
  const blockersByTask = useMemo(() => {
    const byId = new Map(liveTasks.map((t) => [t.id, t]));
    const map = new Map<string, Task[]>();
    for (const rel of bundle.taskRelations) {
      const blocker = byId.get(rel.blockerTaskId);
      if (!blocker) continue; // inert edge — blocker deleted
      const list = map.get(rel.blockedTaskId);
      if (list) list.push(blocker);
      else map.set(rel.blockedTaskId, [blocker]);
    }
    return map;
  }, [liveTasks, bundle.taskRelations]);

  /** Live dependent tasks per blocker (the read-only "Blocks" reverse list). */
  const dependentsByTask = useMemo(() => {
    const byId = new Map(liveTasks.map((t) => [t.id, t]));
    const map = new Map<string, Task[]>();
    for (const rel of bundle.taskRelations) {
      const dependent = byId.get(rel.blockedTaskId);
      if (!dependent) continue;
      const list = map.get(rel.blockerTaskId);
      if (list) list.push(dependent);
      else map.set(rel.blockerTaskId, [dependent]);
    }
    return map;
  }, [liveTasks, bundle.taskRelations]);

  /** The unblocked frontier of a task — "what's actually next" (spec §5c). */
  const frontierFor = useCallback(
    (taskId: string) => frontierTasks(taskId, liveTasks, bundle.taskRelations),
    [liveTasks, bundle.taskRelations],
  );

  /** Soft, ambient per-bucket drift counts (scheduled-and-passed, still open). */
  const driftCountByBucket = useMemo(() => {
    const now = new Date();
    const counts = new Map<string, number>();
    for (const t of liveTasks) {
      if (isDrifted(t, now)) counts.set(t.bucketId, (counts.get(t.bucketId) ?? 0) + 1);
    }
    return counts;
  }, [liveTasks]);

  // ── tags (workspace-level, cross-cutting) ────────────────────────────────────
  // Read from the shared workspace tag store (TV-T1): every surface that hosts
  // a task (Tasks, Calendar, Notes, Email) shows the same tags at once.
  const tagView = useTagView(canRead ? workspaceId : null);
  /** Live workspace tags, name-sorted. */
  const liveTags = tagView.tags;

  /** Tags attached to each task (entityType "task"), name-sorted. */
  const tagsByTask = useMemo(() => {
    const map = new Map<string, Tag[]>();
    for (const [key, tags] of tagView.byEntity) {
      if (key.startsWith("task:")) map.set(key.slice("task:".length), tags);
    }
    return map;
  }, [tagView]);

  /** Open-task count per tag — drives the filter menu (counts, hides empties). */
  const openTaskCountByTag = useMemo(() => {
    const openIds = new Set(
      liveTasks.filter((t) => t.status !== "done" && t.status !== "archived").map((t) => t.id),
    );
    const counts = new Map<string, number>();
    for (const link of tagView.links) {
      if (link.entityType !== "task" || !openIds.has(link.entityId)) continue;
      counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
    }
    return counts;
  }, [tagView, liveTasks]);

  // ── personal queues (TV-D4) ─────────────────────────────────────────────────
  // Each person has their own Queue, not tied to a date (tasks-v2 §2). Rows of
  // other people are claims ("In Mike's queue"). Rows are read with the
  // workspace they belong to, so a late answer from the last workspace never
  // shows here.
  const liveQueueRows = useMemo(
    () => queueRows.filter((e) => e.workspaceId === workspaceId),
    [queueRows, workspaceId],
  );
  /** My line-up, in order (what the server holds, plus optimistic edits). */
  const myQueueEntries = useMemo(
    () => queueEntriesOf(liveQueueRows, userId),
    [liveQueueRows, userId],
  );
  const queuedTaskIds = useMemo(
    () => new Set(myQueueEntries.map((e) => e.taskId)),
    [myQueueEntries],
  );
  /** Who else has each task queued (user ids, earliest first). */
  const queueClaims = useMemo(() => claimsByTask(liveQueueRows, userId), [liveQueueRows, userId]);
  /** My queue's tasks in order, with the ones I just completed still in place. */
  const queuedTasks = useMemo(
    () =>
      queueTasks(
        myQueueEntries,
        keptRows.filter((e) => e.workspaceId === workspaceId),
        liveTasks,
      ),
    [myQueueEntries, keptRows, workspaceId, liveTasks],
  );
  /** The rail's Queue count: my open queued tasks. */
  const queueCount = useMemo(() => openQueueCount(queuedTasks), [queuedTasks]);

  // Names for the "Also in Mike's queue" note. Read without `useWorkspace` so
  // the hook still works where no workspace provider is mounted (tests).
  const members = useContext(WorkspaceContext)?.members;
  const memberName = useCallback(
    (id: string) => members?.find((m) => m.userId === id)?.displayName?.trim() || "a teammate",
    [members],
  );

  /** Mirror the server: done, archived or deleted leaves every queue. A done
   *  task of mine stays on show (kept) until the next load; reopening drops it. */
  const queueFollowStatus = useCallback(
    (taskId: string, status: TaskStatus | "deleted") => {
      if (status === "todo" || status === "in_progress") {
        setKeptRows((prev) => prev.filter((e) => e.taskId !== taskId));
        return;
      }
      const mine = myQueueEntries.find((e) => e.taskId === taskId);
      if (status === "done" && mine) {
        setKeptRows((prev) => [...prev.filter((e) => e.taskId !== taskId), mine]);
      }
      setQueueRows((prev) => withoutTask(prev, taskId));
    },
    [myQueueEntries],
  );

  // ── helpers ──────────────────────────────────────────────────────────────────
  const guard = useCallback(
    (fn: () => Promise<void>) => {
      if (!runtime || !workspaceId || !canEdit) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      void fn().catch((e) => {
        toast.error(e instanceof Error ? e.message : "Something went wrong.");
        void load();
      });
    },
    [runtime, workspaceId, canEdit, load],
  );

  const patchTaskLocal = useCallback((id: string, patch: Partial<Task>) => {
    setBundle((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  // ── intent ops (docs/moduo-module-contract.md) ──────────────────────────────
  /** Bumped after every successful op — the detail panel's trail refetch cue. */
  const [activityStamp, setActivityStamp] = useState(0);

  /**
   * Run a single-task intent op: optimistic local patch, then the RPC (which
   * checks permission, enforces invariants, and logs attributed activity in
   * one transaction); swap in the returned row, or reload on error.
   */
  const applyOp = useCallback(
    (id: string, optimistic: Partial<Task>, op: () => Promise<Task>) => {
      if (!runtime || !workspaceId || !canEdit) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      if (isTempId(id)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      patchTaskLocal(id, { ...optimistic, updatedAt: new Date().toISOString() });
      void op()
        .then((saved) => {
          setBundle((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === id ? saved : t)),
          }));
          setActivityStamp((s) => s + 1);
        })
        .catch((e) => {
          toast.error(e instanceof Error ? e.message : "Something went wrong.");
          void load();
        });
    },
    [runtime, workspaceId, canEdit, patchTaskLocal, load],
  );

  /** Fetch a task's quiet activity trail (newest first). */
  const loadActivity = useCallback(
    async (taskId: string): Promise<ActivityEntry[]> => {
      if (!runtime || !workspaceId || !canRead || isTempId(taskId)) return [];
      return runtime.tasks.listActivity({
        workspaceId,
        entityType: "task",
        entityId: taskId,
        limit: 50,
        module: "tasks",
      });
    },
    [runtime, workspaceId, canRead],
  );

  // ── task mutations ───────────────────────────────────────────────────────────
  /**
   * Create a task (shown at once). Resolves to the saved task, or null if it
   * wasn't created — what `createTagForTask` takes to tag it before it exists.
   */
  const createTask = useCallback(
    (fields: Omit<NewTaskFields, "workspaceId" | "position">): Promise<Task | null> => {
      if (!runtime || !workspaceId || !canEdit) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return Promise.resolve(null);
      }
      const bucketTasks = liveTasks.filter((t) => t.bucketId === fields.bucketId);
      const position = endPosition(bucketTasks);
      const optimistic = makeTask({ ...fields, workspaceId, position });
      // Shown right away; the server records the same creator. An assignee
      // left unchosen is the creator (as before TV-D1).
      optimistic.creatorId = userId ?? "";
      if (optimistic.assigneeId === "") optimistic.assigneeId = userId;
      const tempId = `tmp-${crypto.randomUUID()}`;
      optimistic.id = tempId;
      setBundle((prev) => ({ ...prev, tasks: [...prev.tasks, optimistic] }));
      return runtime.tasks
        .upsertTask({ ...optimistic, id: "" })
        .then((saved) => {
          setBundle((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === tempId ? saved : t)),
          }));
          return saved;
        })
        .catch((e) => {
          setBundle((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== tempId) }));
          toast.error(e instanceof Error ? e.message : "Couldn't create task.");
          return null;
        });
    },
    [runtime, workspaceId, canEdit, liveTasks, userId],
  );

  /** Send one queue op after the ones before it; apply its answer if it's the newest. */
  const sendQueueOp = useCallback(
    (ws: string, me: string, op: () => Promise<TaskQueueEntry[]>) => {
      const seq = ++queueSeq.current;
      const run = queueChain.current.then(op);
      queueChain.current = run.catch(() => {});
      void run
        .then((own) => {
          if (queueSeq.current === seq) setQueueRows((prev) => withOwnQueue(prev, ws, me, own));
          setActivityStamp((s) => s + 1);
        })
        .catch((e) => {
          toast.error(e instanceof Error ? e.message : "Couldn't update your queue.");
          void load();
        });
    },
    [load],
  );

  /**
   * Run a queue op (TV-D2): apply `optimistic` to my line-up at once, then the
   * RPC, which answers with my whole queue in order. Only the newest op's answer
   * is applied, so two quick toggles can't put back an older line-up. On error:
   * toast and reload. Returns false when it couldn't start (no access).
   */
  const runQueueOp = useCallback(
    (
      optimistic: (mine: TaskQueueEntry[]) => TaskQueueEntry[],
      op: (rt: ModuoRuntime, ws: string) => Promise<TaskQueueEntry[]>,
    ): boolean => {
      if (!runtime || !workspaceId || !canEdit || !userId) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return false;
      }
      const rt = runtime;
      const ws = workspaceId;
      const me = userId;
      setQueueRows((prev) =>
        withOwnQueue(
          prev,
          ws,
          me,
          optimistic(
            queueEntriesOf(
              prev.filter((e) => e.workspaceId === ws),
              me,
            ),
          ),
        ),
      );
      sendQueueOp(ws, me, () => op(rt, ws));
      return true;
    },
    [runtime, workspaceId, canEdit, userId, sendQueueOp],
  );

  /** A placeholder row for my queue until the server's answer replaces it. */
  const optimisticEntry = useCallback(
    (taskId: string, position: string): TaskQueueEntry => {
      const now = new Date().toISOString();
      return {
        id: `tmp-${crypto.randomUUID()}`,
        workspaceId: workspaceId ?? "",
        userId: userId ?? "",
        taskId,
        position,
        queuedAt: now,
        updatedAt: now,
      };
    },
    [workspaceId, userId],
  );

  /**
   * Add a task to my queue: the end, or the top (Calendar's "Start focus").
   * Queuing a task someone else has queued too is fine, with a quiet note.
   */
  const addToQueue = useCallback(
    (id: string, at: QueuePlacement = "end") => {
      const task = liveTasks.find((t) => t.id === id);
      if (!task) return;
      if (isTempId(id)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      if (task.status === "done" || task.status === "archived") {
        toast.error(
          task.status === "done"
            ? "Done tasks can't be queued."
            : "Archived tasks can't be queued.",
        );
        return;
      }
      if (queuedTaskIds.has(id) && at === "end") return;
      const started = runQueueOp(
        (mine) => {
          const rest = mine.filter((e) => e.taskId !== id);
          const position =
            at === "top" ? betweenPositions(null, rest[0]?.position ?? null) : endOfQueue(rest);
          return [...rest, optimisticEntry(id, position)];
        },
        (rt, ws) => rt.tasks.opQueueAdd({ workspaceId: ws, taskId: id, at }),
      );
      const others = queueClaims.get(id) ?? [];
      if (started && others.length > 0) toast(alsoInLabel(others.map(memberName)));
    },
    [liveTasks, queuedTaskIds, runQueueOp, optimisticEntry, queueClaims, memberName],
  );

  const removeFromQueue = useCallback(
    (id: string) => {
      if (!queuedTaskIds.has(id)) return;
      if (isTempId(id)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      runQueueOp(
        (mine) => mine.filter((e) => e.taskId !== id),
        (rt, ws) => rt.tasks.opQueueRemove({ workspaceId: ws, taskId: id }),
      );
    },
    [queuedTaskIds, runQueueOp],
  );

  /** In or out of my queue: the row/card toggle, `q`, the menus, the panel. */
  const toggleQueue = useCallback(
    (id: string) => {
      if (queuedTaskIds.has(id)) removeFromQueue(id);
      else addToQueue(id);
    },
    [queuedTaskIds, removeFromQueue, addToQueue],
  );

  /** Skip in Focus: the task goes to the end of my queue. Not a reschedule. */
  const moveQueuedToEnd = useCallback(
    (id: string) => {
      if (!queuedTaskIds.has(id)) return;
      if (isTempId(id)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      runQueueOp(
        (mine) => {
          const rest = mine.filter((e) => e.taskId !== id);
          const moved = mine.find((e) => e.taskId === id);
          return moved ? [...rest, { ...moved, position: endOfQueue(rest) }] : mine;
        },
        (rt, ws) => rt.tasks.opQueueMoveToEnd({ workspaceId: ws, taskId: id }),
      );
    },
    [queuedTaskIds, runQueueOp],
  );

  /**
   * A drag in the Queue: `orderedIds` is the list as it now looks. One task
   * moved; it goes right after the queued task it now follows (or to the top).
   */
  const reorderQueue = useCallback(
    (orderedIds: string[]) => {
      if (!canEdit) return;
      const move = queueMove(
        myQueueEntries.map((e) => e.taskId),
        orderedIds,
      );
      if (!move) return;
      if (isTempId(move.taskId) || (move.afterTaskId && isTempId(move.afterTaskId))) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      runQueueOp(
        (mine) =>
          mine.map((e) =>
            e.taskId === move.taskId
              ? { ...e, position: movedPosition(mine, move.taskId, move.afterTaskId) }
              : e,
          ),
        (rt, ws) =>
          rt.tasks.opQueueReorder({
            workspaceId: ws,
            taskId: move.taskId,
            afterTaskId: move.afterTaskId,
          }),
      );
    },
    [canEdit, myQueueEntries, runQueueOp],
  );

  /**
   * Capture a new task straight into my queue (Focus's empty-queue affordance,
   * DF-11). Created in the Inbox, assigned to me, shown queued at once; once
   * the server has it, it's added to the end of my queue.
   */
  const captureToQueue = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (!runtime || !workspaceId || !canEdit || !inbox || !userId) {
        if (!canEdit) toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      const rt = runtime;
      const ws = workspaceId;
      const me = userId;
      const bucketId = inbox.id;
      const position = endPosition(liveTasks.filter((t) => t.bucketId === bucketId));
      const optimistic = makeTask({
        bucketId,
        title: trimmed,
        workspaceId: ws,
        position,
        assigneeId: me,
      });
      optimistic.creatorId = me;
      const tempId = `tmp-${crypto.randomUUID()}`;
      optimistic.id = tempId;
      const placeholder = optimisticEntry(tempId, endOfQueue(myQueueEntries));
      setBundle((prev) => ({ ...prev, tasks: [...prev.tasks, optimistic] }));
      setQueueRows((prev) => [...prev, placeholder]);
      void rt.tasks.upsertTask({ ...optimistic, id: "" }).then(
        (saved) => {
          setBundle((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === tempId ? saved : t)),
          }));
          setQueueRows((prev) =>
            prev.map((e) => (e.taskId === tempId ? { ...e, taskId: saved.id } : e)),
          );
          // The task exists now; queuing it waits behind earlier queue ops.
          sendQueueOp(ws, me, () => rt.tasks.opQueueAdd({ workspaceId: ws, taskId: saved.id }));
        },
        (e) => {
          setBundle((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== tempId) }));
          setQueueRows((prev) => prev.filter((row) => row.id !== placeholder.id));
          toast.error(e instanceof Error ? e.message : "Couldn't create task.");
        },
      );
    },
    [
      runtime,
      workspaceId,
      canEdit,
      inbox,
      userId,
      liveTasks,
      myQueueEntries,
      optimisticEntry,
      sendQueueOp,
    ],
  );

  const patchTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      // Advance-on-done (spec §5d): a status change on a recurring task keeps
      // the stored nextOccurrence pointer fresh — unless the caller already
      // patched the rule itself (catch-up / skip pass it explicitly).
      if (patch.status && patch.recurrence === undefined) {
        const advanced = recurrenceOnStatusChange(existing, patch.status, new Date());
        if (advanced) {
          patch = { ...patch, recurrence: advanced };
          if (patch.status === "done" && advanced.nextOccurrence) {
            // Quiet, factual mirror — when this comes back (never a wall).
            toast(`Done — next ${formatScheduled(advanced.nextOccurrence)}`);
          }
        }
      }
      // Done or archived leaves every queue on the server (TV-D2); follow it
      // here so the rail count and claims agree right away.
      if (patch.status && canEdit && !isTempId(id)) queueFollowStatus(id, patch.status);
      // Assignment is an intent op (tasks.assign): the RPC checks the person can
      // take tasks, and the server notifies them. The rest of the patch, if
      // any, saves as usual below.
      if (patch.assigneeId !== undefined) {
        const assigneeId = patch.assigneeId;
        applyOp(id, { assigneeId }, () =>
          runtime!.tasks.opAssign({ workspaceId: workspaceId!, taskId: id, assigneeId }),
        );
        const { assigneeId: _assigned, ...rest } = patch;
        // Without edit access applyOp has already said so; don't say it twice.
        if (Object.keys(rest).length === 0 || !canEdit) return;
        patch = rest;
      }
      // Status changes are an intent op (tasks.set_status): the RPC enforces
      // the invariants server-side and logs attributed activity. Only the
      // status cluster (status / recurrence ride-along / board position) goes
      // that way — plain field edits below are field-level writes (contract §1).
      if (
        patch.status &&
        Object.keys(patch).every((k) => k === "status" || k === "recurrence" || k === "position")
      ) {
        const status = patch.status;
        const recurrence = patch.recurrence;
        const position = patch.position;
        applyOp(id, patch, () =>
          runtime!.tasks.opSetStatus({
            workspaceId: workspaceId!,
            taskId: id,
            status,
            recurrence,
            position,
          }),
        );
        return;
      }
      // Field-level save (TV-D1): only the changed columns go to the server,
      // so this edit can't put back a field a teammate changed meanwhile.
      const fields = editableTaskFields(patch);
      if (Object.keys(fields).length === 0) return;
      if (isTempId(id)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      patchTaskLocal(id, { ...fields, updatedAt: new Date().toISOString() });
      guard(async () => {
        const saved = await runtime!.tasks.updateTask({
          workspaceId: workspaceId!,
          taskId: id,
          patch: fields,
        });
        setBundle((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === id ? saved : t)) }));
      });
    },
    [
      bundle.tasks,
      patchTaskLocal,
      guard,
      runtime,
      workspaceId,
      applyOp,
      canEdit,
      queueFollowStatus,
    ],
  );

  // ── recurrence catch-up (spec §5d) ──────────────────────────────────────────
  // One idempotent pass per successful load (app open / reload): reopen done
  // recurring tasks whose occurrence arrived; collapse missed occurrences
  // forward (no backfill — there is only the next occurrence). The stamp ref
  // keeps re-renders from re-running it; view-only sessions skip it (no write
  // access — stale rows just read as quiet drift).
  // The whole pass is one batched intent op (tasks.catch_up): optimistic local
  // patches, a single RPC that enforces structure + logs per-task activity,
  // then reconcile with the returned rows.
  const caughtUpRef = useRef(0);
  useEffect(() => {
    if (loadStamp === 0 || caughtUpRef.current === loadStamp || !canEdit) return;
    if (!runtime || !workspaceId) return;
    caughtUpRef.current = loadStamp;
    const now = new Date();
    const items: TasksCatchUpItem[] = [];
    for (const t of bundle.tasks) {
      if (isTempId(t.id)) continue;
      const patch = catchUpPatch(t, now);
      if (!patch) continue;
      items.push(catchUpItem(t, patch));
      patchTaskLocal(t.id, { ...patch, updatedAt: now.toISOString() });
    }
    if (items.length === 0) return;
    void runtime.tasks
      .opCatchUp({ workspaceId, items })
      .then((saved) => {
        const byId = new Map(saved.map((t) => [t.id, t]));
        setBundle((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => byId.get(t.id) ?? t),
        }));
        setActivityStamp((s) => s + 1);
      })
      .catch(() => {
        void load(); // quiet — catch-up retries on the next reload
      });
  }, [loadStamp, canEdit, runtime, workspaceId, bundle.tasks, patchTaskLocal, load]);

  const toggleDone = useCallback(
    (task: Task) => {
      patchTask(task.id, { status: task.status === "done" ? "todo" : "done" });
    },
    [patchTask],
  );

  const markDone = useCallback((id: string) => patchTask(id, { status: "done" }), [patchTask]);

  /** Archive a task — terminal, removes it from open lists (used by drift triage). */
  const archiveTask = useCallback(
    (id: string) => patchTask(id, { status: "archived" }),
    [patchTask],
  );

  /** Each task's time writes in flight, chained (see `writeTime`). */
  const timeChains = useRef(new Map<string, Promise<void>>());

  /**
   * Every time write (TV-D3): show it at once, send it through
   * `tasks_op_track_time`, then take the server's total, which already counts
   * everyone else's time. Only the task's time changes, never the rest of the
   * row. `delta` is what the write adds as far as this list can tell; if the
   * write fails or the task is gone, the shown total goes back (unless it
   * changed again meanwhile).
   */
  const writeTime = useCallback(
    (id: string, delta: number, input: TrackTimeInput): Promise<TaskTimeResult> => {
      if (!runtime) return Promise.reject(new Error("Not signed in."));
      // One task's time writes go one at a time, in order, so each answer's
      // total includes every earlier write and the last one shown is the latest.
      const previous = timeChains.current.get(id) ?? Promise.resolve();
      const sent = previous.then(() => runtime.tasks.trackTime(input));
      const settled = sent.then(
        () => undefined,
        () => undefined,
      );
      timeChains.current.set(id, settled);
      void settled.then(() => {
        if (timeChains.current.get(id) === settled) timeChains.current.delete(id);
      });
      const before = bundle.tasks.find((t) => t.id === id)?.timeSpentSeconds;
      const shown = before === undefined ? undefined : Math.max(0, before + Math.round(delta));
      if (before !== undefined && shown !== before) patchTaskLocal(id, { timeSpentSeconds: shown });
      const putBack = () =>
        setBundle((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === id && before !== undefined && t.timeSpentSeconds === shown
              ? { ...t, timeSpentSeconds: before }
              : t,
          ),
        }));
      return sent.then(
        (result) => {
          if (result.totalSeconds === null) putBack();
          else patchTaskLocal(id, { timeSpentSeconds: result.totalSeconds });
          return result;
        },
        (e) => {
          putBack();
          throw e;
        },
      );
    },
    [runtime, bundle.tasks, patchTaskLocal],
  );

  /** Why a time write can't be sent right now, or null. */
  const timeWriteBlocked = useCallback(
    (id: string): string | null => {
      if (!runtime || !workspaceId || !canEdit) {
        return "You don't have edit access to Tasks in this workspace.";
      }
      if (isTempId(id)) return "Still saving that task — try again in a moment.";
      return null;
    },
    [runtime, workspaceId, canEdit],
  );

  /**
   * Calendar's focus on a block (CAL-5) saving what it tracked, as a finished
   * focus stretch (a negative delta takes time away). Fire and forget; false
   * when it can't be sent now. Manual "+5m" and "Took longer" are adjustments:
   * `logTimeAdjustment`.
   */
  const addTimeSpent = useCallback(
    (id: string, deltaSeconds: number): boolean => {
      if (!Number.isFinite(deltaSeconds) || Math.abs(deltaSeconds) < 1) return true; // nothing to persist
      if (timeWriteBlocked(id) || !workspaceId) return false;
      const seconds = Math.round(deltaSeconds);
      void writeTime(
        id,
        seconds,
        seconds > 0
          ? { workspaceId, taskId: id, action: "focus", seconds }
          : { workspaceId, taskId: id, action: "adjust", seconds },
      ).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save the time."));
      return true;
    },
    [timeWriteBlocked, workspaceId, writeTime],
  );

  /**
   * Add (or take away) time as one adjustment, like Calendar's "Took longer".
   * Resolves to what `undoTimeAdjustment` needs to remove exactly that one, or
   * null when nothing was recorded.
   */
  const logTimeAdjustment = useCallback(
    (id: string, deltaSeconds: number): Promise<TimeAdjustment | null> => {
      const seconds = Math.round(deltaSeconds);
      if (!Number.isFinite(seconds) || seconds === 0) return Promise.resolve(null);
      const blocked = timeWriteBlocked(id);
      if (blocked || !workspaceId) {
        toast.error(blocked ?? "Couldn't save the time.");
        return Promise.resolve(null);
      }
      return writeTime(id, seconds, { workspaceId, taskId: id, action: "adjust", seconds }).then(
        (result) => (result.status === "saved" ? { entryId: result.entryId, seconds } : null),
        (e) => {
          toast.error(e instanceof Error ? e.message : "Couldn't save the time.");
          return null;
        },
      );
    },
    [timeWriteBlocked, workspaceId, writeTime],
  );

  /** Undo an adjustment `logTimeAdjustment` made: removes exactly that one. */
  const undoTimeAdjustment = useCallback(
    (id: string, adjustment: TimeAdjustment) => {
      if (timeWriteBlocked(id) || !workspaceId) return;
      void writeTime(id, -adjustment.seconds, {
        workspaceId,
        taskId: id,
        action: "undo",
        entryId: adjustment.entryId,
        seconds: adjustment.seconds,
      }).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't undo that."));
    },
    [timeWriteBlocked, workspaceId, writeTime],
  );

  /**
   * The Focus engine's flush sink (TV-F1, saving through time entries since
   * TV-D3): record `seconds` of focus that ended at `earnedAt` as one stretch,
   * under the save's key, so a resend after a reload or a lost answer counts
   * once. Only the task's time changes.
   *  - `false` right away: not now (no workspace yet, a task still being
   *    created, or another workspace's time handed over mid-switch).
   *  - a promise: `true` saved (or already saved), `false` failed or no edit
   *    access (kept, "not saved yet", retried with the same key), `"gone"` the
   *    task was deleted for good or isn't shared any more: the seconds are
   *    dropped and the person is told.
   */
  const persistFocusTime = useCallback(
    (
      id: string,
      seconds: number,
      context: FocusSaveContext,
    ): boolean | "gone" | Promise<boolean | "gone"> => {
      if (!Number.isFinite(seconds) || seconds < 1) return true;
      if (!runtime || !workspaceId || isTempId(id) || context.workspaceId !== workspaceId) {
        return false;
      }
      if (!canEdit) return Promise.resolve(false);
      return writeTime(id, seconds, {
        workspaceId,
        taskId: id,
        action: "focus",
        seconds: Math.round(seconds),
        endedAt: context.earnedAt > 0 ? new Date(context.earnedAt).toISOString() : null,
        key: context.key,
      }).then(
        (result) => {
          if (result.status !== "gone") return true;
          toast(`${formatAwaySpan(seconds)} of focus time couldn't be saved`, {
            description:
              "The task it was tracked on was deleted or isn't shared with you any more.",
          });
          return "gone" as const;
        },
        () => false,
      );
    },
    [runtime, workspaceId, canEdit, writeTime],
  );

  /** Set the tracked total to a typed value: one adjustment makes it exactly that. */
  const setTimeSpent = useCallback(
    (id: string, seconds: number) => {
      if (!Number.isFinite(seconds)) return;
      const blocked = timeWriteBlocked(id);
      if (blocked || !workspaceId) {
        toast.error(blocked ?? "Couldn't save the time.");
        return;
      }
      const total = Math.max(0, Math.round(seconds));
      const before = bundle.tasks.find((t) => t.id === id)?.timeSpentSeconds ?? total;
      void writeTime(id, total - before, {
        workspaceId,
        taskId: id,
        action: "set_total",
        seconds: total,
      }).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save the time."));
    },
    [timeWriteBlocked, workspaceId, bundle.tasks, writeTime],
  );

  /**
   * Push a scheduled task's time `days` into the future, preserving its clock
   * time. Clears the drift (drift = scheduled time in the past). No-op if the
   * task has no scheduled time.
   */
  const rescheduleScheduledAt = useCallback(
    (id: string, days: number, now: Date = new Date()) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing?.scheduledAt) return;
      const orig = new Date(existing.scheduledAt);
      const next = new Date(now);
      next.setDate(next.getDate() + days);
      next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
      const scheduledAt = next.toISOString();
      applyOp(id, { scheduledAt }, () =>
        runtime!.tasks.opReschedule({ workspaceId: workspaceId!, taskId: id, scheduledAt, days }),
      );
    },
    [bundle.tasks, applyOp, runtime, workspaceId],
  );

  /** Drift-triage Ignore: clear the stale scheduled time, keep the task. */
  const unscheduleTask = useCallback(
    (id: string) => {
      applyOp(id, { scheduledAt: null }, () =>
        runtime!.tasks.opUnschedule({ workspaceId: workspaceId!, taskId: id }),
      );
    },
    [applyOp, runtime, workspaceId],
  );

  /**
   * Move an already-scheduled task to an ABSOLUTE clock time via the attributed
   * reschedule op (writes `tasks.reschedule` activity) — the Calendar loop's
   * roll-forward path (Later today / Move to today). Distinct from
   * {@link rescheduleScheduledAt}, which is days-relative. The server op no-ops
   * if the task has nothing scheduled to move (a triage race).
   */
  const scheduleTaskAt = useCallback(
    (id: string, scheduledAt: string) => {
      applyOp(id, { scheduledAt }, () =>
        runtime!.tasks.opReschedule({
          workspaceId: workspaceId!,
          taskId: id,
          scheduledAt,
        }),
      );
    },
    [applyOp, runtime, workspaceId],
  );

  /**
   * Skip-occurrence (spec §5d): jump a recurring task to its next occurrence
   * without done-credit. Does NOT touch rescheduleCount — a skipped occurrence
   * is a decision, not a slip. Distinct from Execute's Skip (leave the queue).
   */
  const skipOccurrence = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      const patch = skipOccurrencePatch(existing, new Date());
      if (!patch?.scheduledAt || !patch.recurrence) return;
      const scheduledAt = patch.scheduledAt;
      const recurrence = patch.recurrence as RecurrenceRule;
      applyOp(id, patch, () =>
        runtime!.tasks.opSkipOccurrence({
          workspaceId: workspaceId!,
          taskId: id,
          scheduledAt,
          recurrence,
          releaseCommit: "committedFor" in patch,
        }),
      );
      toast(`Skipped — next ${formatScheduled(scheduledAt)}`);
    },
    [bundle.tasks, applyOp, runtime, workspaceId],
  );

  const deleteTask = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      // Snapshot the children BEFORE the optimistic promotion — Undo re-attaches
      // them (their snapshot rows still carry parentId = id).
      const children = bundle.tasks.filter((t) => t.parentId === id && !t.deletedAt);
      // Deleting a parent promotes its subtasks to top-level (mirrored in the
      // runtime) so they stay visible — work is never silently lost.
      setBundle((prev) => ({
        ...prev,
        tasks: prev.tasks
          .filter((t) => t.id !== id)
          .map((t) => (t.parentId === id ? { ...t, parentId: null } : t)),
      }));
      // A deleted task leaves every queue; Undo doesn't put it back (TV-D2).
      if (canEdit) queueFollowStatus(id, "deleted");
      guard(async () => {
        await runtime!.tasks.deleteTask({ workspaceId: workspaceId!, taskId: id });
        // Same guarantee as deleting the task from a note (DF-5): soft delete =
        // a stamp; Undo clears it and re-attaches the subtasks. Only those two
        // fields are written back, so edits made meanwhile survive (TV-D1).
        undoToast("Task deleted", {
          onUndo: () => {
            void (async () => {
              await runtime!.tasks.updateTask({
                workspaceId: workspaceId!,
                taskId: id,
                patch: { deletedAt: null },
              });
              await Promise.all(
                children.map((c) =>
                  runtime!.tasks.updateTask({
                    workspaceId: workspaceId!,
                    taskId: c.id,
                    patch: { parentId: id },
                  }),
                ),
              );
              await load();
            })().catch(() => toast.error("Couldn't restore the task."));
          },
        });
      });
    },
    [bundle.tasks, guard, runtime, workspaceId, load, canEdit, queueFollowStatus],
  );

  // ── subtask mutations (one level — spec §11) ─────────────────────────────────

  /** Create a new subtask under `parentId`, in the parent's bucket. */
  const addSubtask = useCallback(
    (parentId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (isTempId(parentId)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      const parent = liveTasks.find((t) => t.id === parentId);
      if (!parent) return;
      // One level: a task that is itself a subtask can't get children.
      if (parent.parentId && liveTasks.some((t) => t.id === parent.parentId)) {
        toast.error("Subtasks are one level — this task is already a subtask.");
        return;
      }
      // The parent's real bucket: a bucket delete still pending only shows its
      // tasks in Inbox (hidden-buckets.ts), and Undo must find both together.
      const bucketId = bundle.tasks.find((t) => t.id === parentId)?.bucketId ?? parent.bucketId;
      createTask({ bucketId, title: trimmed, parentId });
    },
    [liveTasks, bundle.tasks, createTask],
  );

  /**
   * Attach a task under a parent, or detach it (`parentId = null`, "promote to
   * task"). Enforces the one-level rule in both directions; the DB trigger is
   * the backstop.
   */
  const setTaskParent = useCallback(
    (id: string, parentId: string | null) => {
      const existing = liveTasks.find((t) => t.id === id);
      if (!existing) return;
      const next = parentId ?? null;
      if ((existing.parentId ?? null) === next) return;
      if (next) {
        if (isTempId(id) || isTempId(next)) {
          toast.error("Still saving that task — try again in a moment.");
          return;
        }
        if (next === id) return;
        const parent = liveTasks.find((t) => t.id === next);
        if (!parent) return;
        if (parent.parentId && liveTasks.some((t) => t.id === parent.parentId)) {
          toast.error("Subtasks are one level — that task is already a subtask.");
          return;
        }
        if ((subtasksByParent.get(id)?.length ?? 0) > 0) {
          toast.error("Subtasks are one level — this task has subtasks of its own.");
          return;
        }
      }
      patchTask(id, { parentId: next });
    },
    [liveTasks, subtasksByParent, patchTask],
  );

  /**
   * Move a task to another bucket by drag (tasks-v2 §8): its subtasks follow
   * it, and it goes to the end of that bucket's manual order unless the drop
   * placed it (`position`). `parentId` rides along when the drop also
   * changed it.
   */
  const moveTaskToBucket = useCallback(
    (id: string, bucketId: string, opts: { position?: string; parentId?: string | null } = {}) => {
      const task = liveTasks.find((t) => t.id === id);
      if (!task) return;
      const patches = bucketMovePatches({
        task,
        subtasks: subtasksByParent.get(id) ?? [],
        bucketId,
        allByPosition: liveTasks,
        position: opts.position,
      });
      for (const { id: taskId, patch } of patches) {
        patchTask(
          taskId,
          taskId === id && opts.parentId !== undefined
            ? { ...patch, parentId: opts.parentId }
            : patch,
        );
      }
    },
    [liveTasks, subtasksByParent, patchTask],
  );

  // ── blocked-by mutations (edges, not statuses — spec §5c) ────────────────────

  /** Add a blocker → task edge. Cycle-checked here; the DB trigger backstops. */
  const addBlocker = useCallback(
    (taskId: string, blockerId: string) => {
      if (!runtime || !workspaceId || !canEdit) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      if (isTempId(taskId) || isTempId(blockerId)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      if (taskId === blockerId) return;
      const exists = bundle.taskRelations.some(
        (r) => r.blockerTaskId === blockerId && r.blockedTaskId === taskId,
      );
      if (exists) return;
      if (wouldCreateCycle(blockerId, taskId, bundle.taskRelations)) {
        toast.error("That would create a cycle — these tasks already depend on each other.");
        return;
      }
      const rt = runtime;
      const wsId = workspaceId;
      const tempId = `tmp-${crypto.randomUUID()}`;
      const optimistic: TaskRelation = {
        id: tempId,
        workspaceId: wsId,
        blockerTaskId: blockerId,
        blockedTaskId: taskId,
        createdAt: new Date().toISOString(),
      };
      setBundle((prev) => ({ ...prev, taskRelations: [...prev.taskRelations, optimistic] }));
      void rt.tasks
        .createTaskRelation({ workspaceId: wsId, blockerTaskId: blockerId, blockedTaskId: taskId })
        .then((saved) =>
          setBundle((prev) => ({
            ...prev,
            taskRelations: prev.taskRelations.map((r) => (r.id === tempId ? saved : r)),
          })),
        )
        .catch((e) => {
          setBundle((prev) => ({
            ...prev,
            taskRelations: prev.taskRelations.filter((r) => r.id !== tempId),
          }));
          toast.error(e instanceof Error ? e.message : "Couldn't add the dependency.");
        });
    },
    [runtime, workspaceId, canEdit, bundle.taskRelations],
  );

  /** Remove the blocker → task edge (removes the dependency, not the task). */
  const removeBlocker = useCallback(
    (taskId: string, blockerId: string) => {
      const existing = bundle.taskRelations.find(
        (r) => r.blockerTaskId === blockerId && r.blockedTaskId === taskId,
      );
      if (!existing) return;
      if (isTempId(existing.id)) {
        toast.error("Still saving that dependency — try again in a moment.");
        return;
      }
      setBundle((prev) => ({
        ...prev,
        taskRelations: prev.taskRelations.filter((r) => r.id !== existing.id),
      }));
      guard(async () => {
        await runtime!.tasks.deleteTaskRelation({
          workspaceId: workspaceId!,
          relationId: existing.id,
        });
      });
    },
    [bundle.taskRelations, guard, runtime, workspaceId],
  );

  // ── bucket mutations ─────────────────────────────────────────────────────────
  const createBucket = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || !runtime || !workspaceId || !canEdit) {
        if (!canEdit) toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      // Past every bucket the server still has, including one whose delete is
      // pending (hidden-buckets.ts) — Undo would otherwise tie their positions.
      const position = endPosition(bundle.buckets.filter((b) => !b.deletedAt));
      const optimistic: Bucket = {
        id: `tmp-${crypto.randomUUID()}`,
        workspaceId,
        ownerId: userId ?? "",
        name: trimmed,
        isSystem: false,
        group: null,
        position,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      const tempId = optimistic.id;
      setBundle((prev) => ({ ...prev, buckets: [...prev.buckets, optimistic] }));
      void runtime.tasks
        .upsertBucket({ ...optimistic, id: "" })
        .then((saved) => {
          setBundle((prev) => ({
            ...prev,
            buckets: prev.buckets.map((b) => (b.id === tempId ? saved : b)),
          }));
        })
        .catch((e) => {
          setBundle((prev) => ({ ...prev, buckets: prev.buckets.filter((b) => b.id !== tempId) }));
          toast.error(e instanceof Error ? e.message : "Couldn't create bucket.");
        });
    },
    [runtime, workspaceId, canEdit, bundle.buckets, userId],
  );

  const renameBucket = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      const existing = bundle.buckets.find((b) => b.id === id);
      if (!existing || !trimmed || trimmed === existing.name) return;
      const updated = { ...existing, name: trimmed, updatedAt: new Date().toISOString() };
      setBundle((prev) => ({
        ...prev,
        buckets: prev.buckets.map((b) => (b.id === id ? updated : b)),
      }));
      guard(async () => {
        const saved = await runtime!.tasks.upsertBucket(updated);
        setBundle((prev) => ({
          ...prev,
          buckets: prev.buckets.map((b) => (b.id === id ? saved : b)),
        }));
      });
    },
    [bundle.buckets, guard, runtime],
  );

  /**
   * Assign a bucket to a presentational section (or clear it with `group = null`).
   * Presentational only — capture and task→bucket assignment are untouched
   * (Session 4). Optimistic; persisted on the bucket row.
   */
  const setBucketGroup = useCallback(
    (id: string, group: string | null) => {
      const existing = bundle.buckets.find((b) => b.id === id);
      if (!existing) return;
      const next = group?.trim() ? group.trim() : null;
      if (next === (existing.group ?? null)) return;
      const updated = { ...existing, group: next, updatedAt: new Date().toISOString() };
      setBundle((prev) => ({
        ...prev,
        buckets: prev.buckets.map((b) => (b.id === id ? updated : b)),
      }));
      guard(async () => {
        const saved = await runtime!.tasks.upsertBucket(updated);
        setBundle((prev) => ({
          ...prev,
          buckets: prev.buckets.map((b) => (b.id === id ? saved : b)),
        }));
      });
    },
    [bundle.buckets, guard, runtime],
  );

  /**
   * Assign a bucket to a time-of-day slot (or clear it with `slot = null`).
   * Optimistic; persisted per-workspace via the runtime (spec §9).
   */
  const setTimeBlock = useCallback(
    (bucketId: string, slot: TimeBlockSlot | null) => {
      const next = setBucketTimeBlock(timeBlocks, bucketId, slot);
      setTimeBlocksState(next);
      guard(async () => {
        await runtime!.tasks.setTimeBlocks({ workspaceId: workspaceId!, blocks: next });
      });
    },
    [timeBlocks, guard, runtime, workspaceId],
  );

  /**
   * Delete a user bucket; its tasks move to Inbox. The rail confirms first
   * (tasks-v2 Q1-4). Deferred commit, like `deleteTag`: the bucket is hidden at
   * once (hidden-buckets.ts — every task surface agrees, and its tasks show in
   * Inbox), the server delete waits until the Undo toast closes, and Undo
   * un-hides it. The bundle itself is never touched, so saves made meanwhile
   * still write the task's real bucket, and Undo has nothing to restore.
   */
  const deleteBucket = useCallback(
    (id: string) => {
      if (!runtime || !workspaceId || !canEdit) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      if (isTempId(id)) {
        toast.error("Still saving that bucket — try again in a moment.");
        return;
      }
      const existing = liveBuckets.find((b) => b.id === id);
      if (!existing || existing.isSystem) return;
      const count = taskCountByBucket.get(id) ?? 0;
      hideBucket(id);
      undoToast(`“${existing.name}” deleted`, {
        description:
          count === 0
            ? undefined
            : count === 1
              ? "Its task moved to Inbox."
              : `Its ${count} tasks moved to Inbox.`,
        onUndo: () => unhideBucket(id),
        onCommit: () => {
          void runtime.tasks
            .deleteBucket({ workspaceId, bucketId: id })
            .then(() => load())
            .catch((e) => {
              unhideBucket(id);
              toast.error(e instanceof Error ? e.message : "Couldn't delete the bucket.");
              void load();
            });
        },
      });
    },
    [runtime, workspaceId, canEdit, liveBuckets, taskCountByBucket, load],
  );

  // ── tag mutations (through the shared workspace tag store, TV-T1) ────────────

  /** Where tag writes go, or null (with a toast) when this person can't edit Tasks. */
  const tagContext = useCallback((): TagContext | null => {
    if (!runtime || !workspaceId || !canEdit) {
      toast.error("You don't have edit access to Tasks in this workspace.");
      return null;
    }
    return { runtime, workspaceId, userId };
  }, [runtime, workspaceId, canEdit, userId]);

  /** Attach or detach an existing tag on a task. */
  const toggleTaskTag = useCallback(
    (taskId: string, tagId: string) => {
      const ctx = tagContext();
      if (!ctx) return;
      if (isTempId(taskId)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      toggleTag(ctx, { entityType: "task", entityId: taskId }, tagId);
    },
    [tagContext],
  );

  /**
   * Attach the tag with this name, or create it (auto-coloured) and attach it,
   * in one step. `taskId` can be the promise `createTask` returns, so a task
   * still being created can be tagged (capture); a tag made for a task that
   * then fails to save is removed again.
   */
  const createTagForTask = useCallback(
    (name: string, taskId: string | PromiseLike<Task | null>) => {
      const ctx = tagContext();
      if (!ctx) return;
      if (typeof taskId === "string" && isTempId(taskId)) {
        toast.error("Still saving that task — try again in a moment.");
        return;
      }
      createOrAttachByName(ctx, name, {
        entityType: "task",
        entityId:
          typeof taskId === "string" ? taskId : Promise.resolve(taskId).then((t) => t?.id ?? null),
      });
    },
    [tagContext],
  );

  /** Recolor a workspace tag (label-palette hue name). */
  const setTagColor = useCallback(
    (tagId: string, color: string) => {
      const ctx = tagContext();
      if (ctx) recolorTag(ctx, tagId, color);
    },
    [tagContext],
  );

  /** Delete a workspace tag everywhere, with Undo (committed when the toast closes). */
  const deleteTag = useCallback(
    (tagId: string) => {
      const ctx = tagContext();
      if (ctx) deleteWorkspaceTag(ctx, tagId);
    },
    [tagContext],
  );

  return {
    loading,
    error,
    canRead,
    canEdit,
    buckets,
    inbox,
    tasks: liveTasks,
    tags: liveTags,
    tagsByTask,
    openTaskCountByTag,
    openTaskCountByBucket,
    taskCountByBucket,
    driftCountByBucket,
    timeBlocks,
    setTimeBlock,
    /** My queue's tasks in line-up order (TV-D4). */
    queuedTasks,
    /** Tasks in my queue (open ones; a task leaves queues when done). */
    queuedTaskIds,
    /** Who else has each task queued: task id → user ids (claims). */
    queueClaims,
    /** My open queued tasks — the rail's Queue count. */
    queueCount,
    reload: load,
    createTask,
    captureToQueue,
    patchTask,
    toggleDone,
    markDone,
    archiveTask,
    addTimeSpent,
    logTimeAdjustment,
    undoTimeAdjustment,
    persistFocusTime,
    setTimeSpent,
    rescheduleScheduledAt,
    unscheduleTask,
    scheduleTaskAt,
    toggleQueue,
    addToQueue,
    removeFromQueue,
    moveQueuedToEnd,
    skipOccurrence,
    reorderQueue,
    deleteTask,
    loadActivity,
    activityStamp,
    currentUserId: userId,
    subtasksByParent,
    subtaskProgressByTask,
    addSubtask,
    setTaskParent,
    moveTaskToBucket,
    blockedTaskIds: blockedIds,
    taskRelations: bundle.taskRelations,
    /** SCALE-1: collections the read had to cut — the page must show these. */
    truncated: bundle.truncated,
    blockersByTask,
    dependentsByTask,
    frontierFor,
    addBlocker,
    removeBlocker,
    createBucket,
    renameBucket,
    deleteBucket,
    setBucketGroup,
    toggleTaskTag,
    createTagForTask,
    setTagColor,
    deleteTag,
    INBOX_BUCKET_NAME,
  };
}

export type TasksModuleApi = ReturnType<typeof useTasksModule>;
