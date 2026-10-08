// Data hook for the Tasks module. Loads the workspace bundle and exposes
// optimistic CRUD over buckets and tasks. Mutations update local state first for
// snappy, keyboard-driven editing; on error they reload from the source of truth
// and surface a toast. Drift is computed client-side via isDrifted().

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { pickTagColor } from "../../../components/tag-colors";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { editableTaskFields } from "../../../lib/task-rows";
import { UNDO_TOAST_MS, undoToast } from "../../../lib/undo-toast";
import { formatAwaySpan } from "../../focus/away-copy";
import type { FocusSaveContext } from "../../focus/engine";
import { readSavedFocusTotal, writeSavedFocusTotal } from "../../focus/saved-totals";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { setBucketTimeBlock } from "../default-view";
import { writeTaskTimeTotal } from "../focus-time-write";
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
  type TagLink,
  type Task,
  type TaskQueueEntry,
  type TaskRelation,
  type TaskStatus,
  type TasksCatchUpItem,
  type TasksModuleBundle,
  type TimeBlockMap,
  type TimeBlockSlot,
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

function dropFailedTag<
  P extends { tags: { id: string }[]; tagLinks: { id: string; tagId: string }[] },
>(prev: P, ids: { tempTagId: string; tempLinkId: string; orphanId: string | null }): P {
  const { tempTagId, tempLinkId, orphanId } = ids;
  return {
    ...prev,
    tags: prev.tags.filter((t) => t.id !== tempTagId && t.id !== orphanId),
    tagLinks: prev.tagLinks.filter(
      (l) => l.id !== tempLinkId && l.tagId !== tempTagId && l.tagId !== orphanId,
    ),
  };
}

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
  /** Only the newest queue op's answer is applied (each returns my whole queue). */
  const queueSeq = useRef(0);
  const [timeBlocks, setTimeBlocksState] = useState<TimeBlockMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);
  /** Bumped on every successful load — the recurrence catch-up trigger. */
  const [loadStamp, setLoadStamp] = useState(0);
  /** Which workspace the loaded bundle is, when its request started, and which
   *  tasks the server had then. The focus sink judges freshness and "gone" by
   *  it; it's set with the bundle so a render sees both. */
  const [loadedFrom, setLoadedFrom] = useState<{
    workspaceId: string;
    at: number;
    taskIds: ReadonlySet<string>;
  } | null>(null);
  /** The ownership the focus sink last reloaded for, and when (one reload per
   *  takeover, then at most one a minute while loads keep failing). */
  const focusReload = useRef({ ownedSince: 0, at: 0 });

  const load = useCallback(async () => {
    if (!runtime || !userId || !workspaceId || !canRead) {
      setBundle(EMPTY_BUNDLE);
      setQueueRows([]);
      setKeptRows([]);
      setLoadedFrom(null);
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
        setLoadedFrom({
          workspaceId,
          at: startedAt,
          taskIds: new Set(next.tasks.map((t) => t.id)),
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
  const liveTags = useMemo(
    () =>
      bundle.tags
        .filter((t) => !t.deletedAt)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [bundle.tags],
  );

  /** Tags attached to each task (entityType "task"), name-sorted. */
  const tagsByTask = useMemo(() => {
    const byId = new Map(liveTags.map((t) => [t.id, t]));
    const map = new Map<string, Tag[]>();
    for (const link of bundle.tagLinks) {
      if (link.entityType !== "task") continue;
      const tag = byId.get(link.tagId);
      if (!tag) continue;
      const list = map.get(link.entityId);
      if (list) list.push(tag);
      else map.set(link.entityId, [tag]);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [bundle.tagLinks, liveTags]);

  /** Open-task count per tag — drives the filter menu (counts, hides empties). */
  const openTaskCountByTag = useMemo(() => {
    const openIds = new Set(
      liveTasks.filter((t) => t.status !== "done" && t.status !== "archived").map((t) => t.id),
    );
    const counts = new Map<string, number>();
    for (const link of bundle.tagLinks) {
      if (link.entityType !== "task" || !openIds.has(link.entityId)) continue;
      counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
    }
    return counts;
  }, [bundle.tagLinks, liveTasks]);

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
  const createTask = useCallback(
    (fields: Omit<NewTaskFields, "workspaceId" | "position">) => {
      if (!runtime || !workspaceId || !canEdit) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return;
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
      void runtime.tasks
        .upsertTask({ ...optimistic, id: "" })
        .then((saved) => {
          setBundle((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === tempId ? saved : t)),
          }));
        })
        .catch((e) => {
          setBundle((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== tempId) }));
          toast.error(e instanceof Error ? e.message : "Couldn't create task.");
        });
    },
    [runtime, workspaceId, canEdit, liveTasks, userId],
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
      const ws = workspaceId;
      const me = userId;
      const seq = ++queueSeq.current;
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
      void op(runtime, ws)
        .then((own) => {
          if (queueSeq.current === seq) setQueueRows((prev) => withOwnQueue(prev, ws, me, own));
          setActivityStamp((s) => s + 1);
        })
        .catch((e) => {
          toast.error(e instanceof Error ? e.message : "Couldn't update your queue.");
          void load();
        });
      return true;
    },
    [runtime, workspaceId, canEdit, userId, load],
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
          const seq = ++queueSeq.current;
          rt.tasks
            .opQueueAdd({ workspaceId: ws, taskId: saved.id })
            .then((own) => {
              if (queueSeq.current === seq) setQueueRows((prev) => withOwnQueue(prev, ws, me, own));
              setActivityStamp((s) => s + 1);
            })
            .catch((e) => {
              // The task exists; only queuing it failed.
              toast.error(e instanceof Error ? e.message : "Couldn't add the task to your queue.");
              void load();
            });
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
      load,
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

  /**
   * Lightweight time-tracking: fold an elapsed work delta (seconds) into the
   * task's persisted total through the normal save path. Reads the current
   * total from the source of truth so repeated flushes accumulate cleanly.
   * A NEGATIVE delta subtracts (the Calendar "took longer" undo) — reading the
   * live total means it removes exactly its own contribution, never clobbering
   * time accrued in between (the result still floors at 0).
   */
  const addTimeSpent = useCallback(
    (id: string, deltaSeconds: number): boolean => {
      if (!Number.isFinite(deltaSeconds) || Math.abs(deltaSeconds) < 1) return true; // nothing to persist
      const t = bundle.tasks.find((x) => x.id === id);
      // Not in the local bundle (e.g. the app-level Focus sink drained on a
      // /tasks remount before load() resolved). Report "not persisted" so the
      // caller RETAINS the delta and retries once the bundle is loaded — else
      // time accrued while /tasks was unmounted is silently lost (DF-11).
      if (!t) return false;
      patchTask(id, {
        timeSpentSeconds: Math.max(0, (t.timeSpentSeconds ?? 0) + Math.round(deltaSeconds)),
      });
      return true;
    },
    [bundle.tasks, patchTask],
  );

  /**
   * The Focus engine's flush sink (TV-F1): fold `seconds` of tracked work into
   * the task's saved total and report what happened, so the engine keeps the
   * seconds and retries ("not saved yet", F1-7) instead of losing them. It
   * writes only the time total (`writeTaskTimeTotal`), never the rest of the row.
   *  - `false` right away: not now. The list is loading, was requested before
   *    this tab took the clock (reload first: the other tab may have changed the
   *    total), is another workspace's for a render, is capped, or doesn't have
   *    the task yet.
   *  - `"gone"`: the server's list for the task's workspace, requested after the
   *    time was tracked, doesn't have it — deleted or no longer shared. The
   *    seconds are dropped and the person is told.
   *  - a promise: the write, `false` when it failed (the optimistic total is
   *    put back) or when there's no edit access, so it shows as not saved.
   * The total is absolute, so it builds on the fresher of this bundle's row and
   * the last save any tab on this device made.
   */
  const persistFocusTime = useCallback(
    (
      id: string,
      seconds: number,
      context: FocusSaveContext,
    ): boolean | "gone" | Promise<boolean> => {
      if (!Number.isFinite(seconds) || seconds < 1) return true;
      if (loading || !runtime || !workspaceId || isTempId(id)) return false;
      if (!loadedFrom || loadedFrom.workspaceId !== workspaceId) return false;
      if (loadedFrom.at < context.ownedSince) {
        const last = focusReload.current;
        if (last.ownedSince !== context.ownedSince || Date.now() - last.at > 60_000) {
          focusReload.current = { ownedSince: context.ownedSince, at: Date.now() };
          void load();
        }
        return false;
      }
      const task = bundle.tasks.find((t) => t.id === id);
      if (!task || task.workspaceId !== workspaceId) {
        const complete = !bundle.truncated.some((t) => t.scope === "tasks");
        const goneFromServer = complete && !loadedFrom.taskIds.has(id);
        if (!goneFromServer || loadedFrom.at <= context.earnedAt) return false;
        toast(`${formatAwaySpan(seconds)} of focus time couldn't be saved`, {
          description: "The task it was tracked on was deleted or isn't shared with you any more.",
        });
        return "gone";
      }
      if (!canEdit) return Promise.resolve(false);
      const lastSave = userId ? readSavedFocusTotal(userId, id) : null;
      const base =
        lastSave && !(Date.parse(task.updatedAt) >= lastSave.at)
          ? lastSave.total
          : (task.timeSpentSeconds ?? 0);
      const total = Math.max(0, base + Math.round(seconds));
      patchTaskLocal(id, { timeSpentSeconds: total });
      return writeTaskTimeTotal(id, workspaceId, total)
        .then((saved) => {
          if (!saved) {
            // No visible row (hard-deleted, no longer shared): reload, bounded
            // like the takeover reload, so the next try can say "gone".
            if (Date.now() - focusReload.current.at > 60_000) {
              focusReload.current = { ...focusReload.current, at: Date.now() };
              void load();
            }
            throw new Error("task not found");
          }
          if (userId) {
            writeSavedFocusTotal(userId, id, saved.timeSpentSeconds, Date.parse(saved.updatedAt));
          }
          setBundle((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === id
                ? { ...t, timeSpentSeconds: saved.timeSpentSeconds, updatedAt: saved.updatedAt }
                : t,
            ),
          }));
          return true;
        })
        .catch(() => {
          // Put back exactly what this write added, unless something else has
          // changed the total since.
          setBundle((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === id && t.timeSpentSeconds === total
                ? { ...t, timeSpentSeconds: Math.max(0, base) }
                : t,
            ),
          }));
          return false;
        });
    },
    [
      loading,
      loadedFrom,
      load,
      bundle.tasks,
      bundle.truncated,
      runtime,
      workspaceId,
      userId,
      canEdit,
      patchTaskLocal,
    ],
  );

  /** Set the tracked total to an absolute value (manual "edit the value"). */
  const setTimeSpent = useCallback(
    (id: string, seconds: number) => {
      if (!Number.isFinite(seconds)) return;
      patchTask(id, { timeSpentSeconds: Math.max(0, Math.round(seconds)) });
    },
    [patchTask],
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

  // ── tag mutations (optimistic) ───────────────────────────────────────────────

  /** Attach or detach an existing tag on a task. */
  const toggleTaskTag = useCallback(
    (taskId: string, tagId: string) => {
      if (!runtime || !workspaceId || !canEdit) {
        toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      // The tag is still being created (its id is a temp placeholder) — sending
      // it to a uuid column would error. The create flow finishes in a beat.
      if (isTempId(tagId)) {
        toast.error("Still saving that tag — try again in a moment.");
        return;
      }
      const rt = runtime;
      const wsId = workspaceId;
      const existing = bundle.tagLinks.find(
        (l) => l.entityType === "task" && l.entityId === taskId && l.tagId === tagId,
      );
      if (existing) {
        setBundle((prev) => ({
          ...prev,
          tagLinks: prev.tagLinks.filter((l) => l.id !== existing.id),
        }));
        void rt.tasks
          .detachTag({ workspaceId: wsId, tagId, entityType: "task", entityId: taskId })
          .catch((e) => {
            toast.error(e instanceof Error ? e.message : "Couldn't remove tag.");
            void load();
          });
        return;
      }
      const tempId = `tmp-${crypto.randomUUID()}`;
      const optimistic: TagLink = {
        id: tempId,
        workspaceId: wsId,
        tagId,
        entityType: "task",
        entityId: taskId,
        createdAt: new Date().toISOString(),
      };
      setBundle((prev) => ({ ...prev, tagLinks: [...prev.tagLinks, optimistic] }));
      void rt.tasks
        .attachTag({ workspaceId: wsId, tagId, entityType: "task", entityId: taskId })
        .then((saved) =>
          setBundle((prev) => ({
            ...prev,
            tagLinks: prev.tagLinks.map((l) => (l.id === tempId ? saved : l)),
          })),
        )
        .catch((e) => {
          setBundle((prev) => ({
            ...prev,
            tagLinks: prev.tagLinks.filter((l) => l.id !== tempId),
          }));
          toast.error(e instanceof Error ? e.message : "Couldn't add tag.");
        });
    },
    [runtime, workspaceId, canEdit, bundle.tagLinks, load],
  );

  /**
   * Create a workspace tag (auto-colored) and attach it to a task. If a tag with
   * the same name already exists, attach that one instead of duplicating.
   */
  const createTagForTask = useCallback(
    (name: string, taskId: string) => {
      const trimmed = name.trim();
      if (!trimmed || !runtime || !workspaceId || !canEdit) {
        if (!canEdit) toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      const rt = runtime;
      const wsId = workspaceId;
      const dupe = bundle.tags.find(
        (t) => !t.deletedAt && t.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (dupe) {
        const linked = bundle.tagLinks.some(
          (l) => l.entityType === "task" && l.entityId === taskId && l.tagId === dupe.id,
        );
        if (!linked) toggleTaskTag(taskId, dupe.id);
        return;
      }
      const now = new Date().toISOString();
      const color = pickTagColor(bundle.tags.filter((t) => !t.deletedAt));
      const tempTagId = `tmp-${crypto.randomUUID()}`;
      const tempLinkId = `tmp-${crypto.randomUUID()}`;
      const optimisticTag: Tag = {
        id: tempTagId,
        workspaceId: wsId,
        ownerId: userId ?? "",
        name: trimmed,
        color,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const optimisticLink: TagLink = {
        id: tempLinkId,
        workspaceId: wsId,
        tagId: tempTagId,
        entityType: "task",
        entityId: taskId,
        createdAt: now,
      };
      setBundle((prev) => ({
        ...prev,
        tags: [...prev.tags, optimisticTag],
        tagLinks: [...prev.tagLinks, optimisticLink],
      }));
      void (async () => {
        // Track the saved tag id so a failure *after* the tag is created (but
        // before/at attach) rolls back the now-orphan tag too — by then the temp
        // id has been swapped out, so filtering by tempTagId alone would miss it.
        let savedTagId: string | null = null;
        try {
          const savedTag = await rt.tasks.upsertTag({ ...optimisticTag, id: "" });
          savedTagId = savedTag.id;
          setBundle((prev) => ({
            ...prev,
            tags: prev.tags.map((t) => (t.id === tempTagId ? savedTag : t)),
            tagLinks: prev.tagLinks.map((l) =>
              l.tagId === tempTagId ? { ...l, tagId: savedTag.id } : l,
            ),
          }));
          const savedLink = await rt.tasks.attachTag({
            workspaceId: wsId,
            tagId: savedTag.id,
            entityType: "task",
            entityId: taskId,
          });
          setBundle((prev) => ({
            ...prev,
            tagLinks: prev.tagLinks.map((l) => (l.id === tempLinkId ? savedLink : l)),
          }));
        } catch (e) {
          setBundle((prev) => dropFailedTag(prev, { tempTagId, tempLinkId, orphanId: savedTagId }));
          // The tag was created but attaching failed — delete the orphan server-side.
          if (savedTagId) {
            void rt.tasks.deleteTag({ workspaceId: wsId, tagId: savedTagId }).catch(() => {});
          }
          toast.error(e instanceof Error ? e.message : "Couldn't create tag.");
        }
      })();
    },
    [runtime, workspaceId, canEdit, bundle.tags, bundle.tagLinks, userId, toggleTaskTag],
  );

  /** Recolor a workspace tag (label-palette hue name). */
  const setTagColor = useCallback(
    (tagId: string, color: string) => {
      if (isTempId(tagId)) {
        toast.error("Still saving that tag — try again in a moment.");
        return;
      }
      const existing = bundle.tags.find((t) => t.id === tagId);
      if (!existing || existing.color === color) return;
      const updated = { ...existing, color, updatedAt: new Date().toISOString() };
      setBundle((prev) => ({
        ...prev,
        tags: prev.tags.map((t) => (t.id === tagId ? updated : t)),
      }));
      guard(async () => {
        const saved = await runtime!.tasks.upsertTag(updated);
        setBundle((prev) => ({
          ...prev,
          tags: prev.tags.map((t) => (t.id === tagId ? saved : t)),
        }));
      });
    },
    [bundle.tags, guard, runtime],
  );

  /** Delete a workspace tag — soft-deletes the tag and drops all its links. */
  const deleteTag = useCallback(
    (tagId: string) => {
      if (isTempId(tagId)) {
        toast.error("Still saving that tag — try again in a moment.");
        return;
      }
      const existing = bundle.tags.find((t) => t.id === tagId);
      if (!existing) return;
      // Snapshot before the optimistic removal so Undo restores locally with
      // zero network (the server was never touched — see below).
      const prevTags = bundle.tags;
      const prevTagLinks = bundle.tagLinks;
      setBundle((prev) => ({
        ...prev,
        tags: prev.tags.filter((t) => t.id !== tagId),
        tagLinks: prev.tagLinks.filter((l) => l.tagId !== tagId),
      }));
      // Deferred commit (the email-triage pattern, DF-5): the server delete
      // hard-drops every attachment, so it only fires once the undo window
      // closes — Undo just cancels it and puts the local snapshot back.
      let undone = false;
      window.setTimeout(() => {
        if (undone) return;
        guard(async () => {
          await runtime!.tasks.deleteTag({ workspaceId: workspaceId!, tagId });
        });
      }, UNDO_TOAST_MS);
      undoToast("Tag deleted", {
        description: `“${existing.name}” comes off everything it was tagged on.`,
        onUndo: () => {
          undone = true;
          setBundle((prev) => ({ ...prev, tags: prevTags, tagLinks: prevTagLinks }));
        },
      });
    },
    [bundle.tags, bundle.tagLinks, guard, runtime, workspaceId],
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
