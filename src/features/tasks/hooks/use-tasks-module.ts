// Data hook for the Tasks module. Reads the workspace's shared store (TV-D11a,
// `src/lib/sync/`) — the one copy every surface shares, opened from the device
// and kept live — and exposes optimistic CRUD over buckets and tasks. Each
// mutation is a write on the store: shown at once, sent through the server
// op, and on a refusal only that write's fields go back (with a toast);
// nothing reloads. Offline, captures and check-offs wait on the device and
// every other edit says "Offline". Drift is computed client-side via isDrifted().

import {
  isBacklogTask,
  isOpenTask,
  legacyTaskStatus,
  normalizeTaskStatusCategory,
  type TaskStatusCategory,
  taskCategoryOf,
  taskStatusWord,
} from "@contracts/vocabularies";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { isNetworkError } from "../../../lib/sync/network";
import { useStoreSnapshot, useWorkspaceStore } from "../../../lib/sync/react";
import type { OverlayChange, PendingWrite } from "../../../lib/sync/store";
import { editableTaskFields } from "../../../lib/task-rows";
import { undoToast } from "../../../lib/undo-toast";
import { formatAwaySpan } from "../../focus/away-copy";
import type { FocusSaveContext } from "../../focus/engine";
import { FOCUS_TIME_SAVED_EVENT, type FocusTimeSaved } from "../../focus/time-sink";
import {
  createOrAttachByName,
  deleteTag as deleteWorkspaceTag,
  recolorTag,
  type TagContext,
  toggleTag,
  useTagView,
} from "../../tags/store";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { setBucketTimeBlock } from "../default-view";
import { type TaskDropWrite, undoWrite } from "../dnd/drop-write";
import { bucketEndPosition } from "../dnd/rail-drop";
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
  type ProjectStatus,
  type QueuePlacement,
  type RecurrenceRule,
  type Tag,
  type Task,
  type TaskQueueEntry,
  type TaskRelation,
  type TaskStatus,
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
} from "../queue";
import { recurrenceOnStatusChange, skipOccurrencePatch } from "../recurrence-engine";
import {
  CATEGORY_LABELS,
  optimisticStatus,
  type StatusTarget,
  statusKeyCategory,
  statusSetFor,
} from "../statuses";

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

function byPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/** Optimistic placeholder id, not yet a real server uuid. */
const isTempId = (id: string) => id.startsWith("tmp-");

const NO_EDIT = "You don't have edit access to Tasks in this workspace.";
const STILL_SAVING = "Still saving that task — try again in a moment.";

/** A change that can't wait for the network (default g): said once, never queued. */
function sayOffline(): void {
  toast("Offline", {
    description:
      "This change needs a connection. Captures and check-offs wait on this device and sync when you're back.",
  });
}

/** One field write of a task, as an overlay change. */
const patchOf = (id: string, fields: Partial<Task>): OverlayChange => ({
  table: "tasks",
  patch: { id, fields: fields as Record<string, unknown> },
});

export function useTasksModule(baseRuntime: ModuoRuntime | null, params: Params) {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  // The shared store (TV-D11a): one per workspace, shared by every surface
  // that shows tasks. It reads, keeps the copy live (Realtime, TV-D5) and
  // holds every write until the server answers.
  const store = useWorkspaceStore(baseRuntime, userId, workspaceId, canRead);
  const snap = useStoreSnapshot(store);
  const runtime = baseRuntime;
  const bundle = snap.bundle;

  // ── drops (TV-U4) ───────────────────────────────────────────────────────────
  /** The rows as they are now, for a save or an Undo that runs later. */
  const tasksRef = useRef(bundle.tasks);
  tasksRef.current = bundle.tasks;
  /** Every queue row I can see here (TV-D2): my line-up and others' claims. */
  const queueRows = snap.queue;
  const queueRowsRef = useRef(queueRows);
  queueRowsRef.current = queueRows;
  /** My rows for tasks completed this session: the server has dropped them,
   *  but the Queue keeps showing them, done, where they were (§6). */
  const keptRows = snap.kept;
  /** Queue ops go to the server one at a time, in the order they were made,
   *  so each answer (my whole queue) includes every earlier op; the line-up
   *  shown is the newest op's until it answers (the store's line-up). */
  const queueSeq = useRef(0);
  const queueChain = useRef<Promise<unknown>>(Promise.resolve());

  const [timeBlocks, setTimeBlocksState] = useState<TimeBlockMap>({});
  /** The first answer is in (the device copy or the server): before it, views
   *  show a skeleton, never "empty" (TV-P0). Later reads keep the rows on screen. */
  const loaded = !!store && snap.loaded;
  const loading = !!store && !snap.loaded;
  const error = store ? snap.error : null;

  // Time-blocks are one small row per workspace, outside the store; a failed
  // read just means the default view skips the time-block step.
  useEffect(() => {
    if (!runtime || !workspaceId || !canRead) {
      setTimeBlocksState({});
      return;
    }
    let live = true;
    void runtime.tasks
      .getTimeBlocks(workspaceId)
      .catch((): TimeBlockMap => ({}))
      .then((blocks) => {
        if (live) setTimeBlocksState(blocks);
      });
    return () => {
      live = false;
    };
  }, [runtime, workspaceId, canRead]);

  /** Read again now (a Retry): the store asks the server for what changed. */
  const load = useCallback(async () => {
    await store?.reload();
  }, [store]);

  /** A quiet read once things settle (after an op whose answer isn't the task). */
  const requestRefresh = useCallback(() => store?.requestSync("reconnect"), [store]);

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

  // ── statuses (TV-D9) ─────────────────────────────────────────────────────────
  /** Every status this reader can see: the workspace default set and each
   *  visible project's (REPLAN 53a). */
  const statuses = useMemo(() => bundle.statuses ?? [], [bundle.statuses]);
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const bucketById = useMemo(() => new Map(bundle.buckets.map((b) => [b.id, b])), [bundle.buckets]);
  /** The statuses a project's tasks use (the Inbox: the workspace default). */
  const statusesForBucket = useCallback(
    (bucketId: string): ProjectStatus[] => statusSetFor(statuses, bucketById.get(bucketId)),
    [statuses, bucketById],
  );

  /** Open (To do / In progress) tasks per project: the sidebar counts. Backlog
   *  sits out (TV-D9). */
  const openTaskCountByBucket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of liveTasks) {
      if (!isOpenTask(t)) continue;
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
  // Read from the shared workspace tag store (TV-T1), which the shared store
  // seeds: every surface that hosts a task shows the same tags at once.
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
    const openIds = new Set(liveTasks.filter((t) => isOpenTask(t)).map((t) => t.id));
    const counts = new Map<string, number>();
    for (const link of tagView.links) {
      if (link.entityType !== "task" || !openIds.has(link.entityId)) continue;
      counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
    }
    return counts;
  }, [tagView, liveTasks]);

  // ── personal queues (TV-D4) ─────────────────────────────────────────────────
  // Each person has their own Queue, not tied to a date (tasks-v2 §2). Rows of
  // other people are claims ("In Mike's queue"). The store keeps one
  // workspace's rows, so another workspace's never show here.
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
  /** My line-up as it is now, for a queue op called later than its render
   *  (a drop's Undo runs seconds after the drop's closure was made). */
  const myQueueRef = useRef(myQueueEntries);
  myQueueRef.current = myQueueEntries;
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

  /**
   * Mirror the server: done, archived, backlog or deleted leaves every queue
   * (TV-D2, TV-D9). Returns the overlay changes that take the task out of the
   * queues shown (the write that changes its status carries them, so a refusal
   * puts them back), and the queue rows the server will have dropped. A done
   * task of mine stays on show (kept) until the next reload; reopening drops it.
   */
  const queueFollowStatus = useCallback(
    (
      taskId: string,
      status: TaskStatus | TaskStatusCategory | "deleted",
    ): { changes: OverlayChange[]; rowIds: string[] } => {
      if (status === "todo" || status === "in_progress") {
        store?.unkeep(taskId);
        return { changes: [], rowIds: [] };
      }
      const mine = myQueueRef.current.find((e) => e.taskId === taskId);
      if (status === "done" && mine) store?.keep(mine);
      const rows = queueRowsRef.current.filter((e) => e.taskId === taskId);
      return {
        changes: rows.map((e) => ({ table: "queue", remove: e.id }) as OverlayChange),
        rowIds: rows.map((e) => e.id),
      };
    },
    [store],
  );

  // ── helpers ──────────────────────────────────────────────────────────────────
  /** Why an edit can't start now (said once), or null when it can. */
  const editBlocked = useCallback((): boolean => {
    if (!runtime || !workspaceId || !canEdit || !store) {
      toast.error(NO_EDIT);
      return true;
    }
    if (store.isOffline()) {
      sayOffline();
      return true;
    }
    return false;
  }, [runtime, workspaceId, canEdit, store]);

  /** A write the server refused: its fields are back to the server's, and it says why. */
  const refused = useCallback((write: PendingWrite, e: unknown, fallback = "Something went wrong.") => {
    write.fail();
    toast.error(e instanceof Error ? e.message : fallback);
  }, []);

  /** A backlog task's move to To do (queuing or scheduling it, REPLAN 53), for
   *  showing it before the server's own move comes back. Null otherwise. */
  const backlogToTodo = useCallback(
    (task: Task): Partial<Task> | null =>
      isBacklogTask(task)
        ? optimisticStatus(task, { category: "todo" }, statusesForBucket(task.bucketId))
        : null,
    [statusesForBucket],
  );

  // ── intent ops (docs/moduo-module-contract.md) ──────────────────────────────
  /** Bumped after every successful op — the detail panel's trail refetch cue. */
  const [activityStamp, setActivityStamp] = useState(0);

  /**
   * Run a single-task intent op: shown at once, then the RPC (which checks
   * permission, enforces invariants, and logs attributed activity in one
   * transaction); the returned row becomes the copy. A refusal puts back only
   * what this op changed. `extra` rides in the same write (queue rows a
   * status change takes out). A status op (a check-off) that can't reach the
   * server waits on the device instead (`offline`).
   */
  const applyOp = useCallback(
    (
      id: string,
      optimistic: Partial<Task>,
      op: () => Promise<Task>,
      opts: {
        extra?: OverlayChange[];
        /** Rows the server drops with this op (queue rows of a closed task). */
        forget?: string[];
        offline?: { status: string; recurrence?: RecurrenceRule | null };
      } = {},
    ) => {
      if (!runtime || !workspaceId || !canEdit || !store) {
        toast.error(NO_EDIT);
        return;
      }
      if (isTempId(id)) {
        toast.error(STILL_SAVING);
        return;
      }
      const current = tasksRef.current.find((t) => t.id === id);
      const toTodo =
        current && optimistic.scheduledAt && optimistic.statusCategory === undefined
          ? backlogToTodo(current)
          : null;
      const shown = { ...optimistic, ...toTodo, updatedAt: new Date().toISOString() };
      const queueing = opts.offline;
      // Offline (or a capture still waiting to sync): a check-off waits on the
      // device, behind the capture; anything else says "Offline".
      if (store.isOffline() || store.isQueuedCreate(id)) {
        if (!queueing) {
          if (store.isOffline()) sayOffline();
          else toast.error(STILL_SAVING);
          return;
        }
        store.enqueue({
          kind: "status",
          id: crypto.randomUUID(),
          taskId: id,
          status: queueing.status,
          recurrence: queueing.recurrence,
          fields: shown,
        });
        return;
      }
      const write = store.begin([patchOf(id, shown), ...(opts.extra ?? [])]);
      void op()
        .then((saved) => {
          write.settle({ tasks: [saved] });
          if (opts.forget?.length) store.forget("queue", opts.forget);
          setActivityStamp((s) => s + 1);
        })
        .catch((e) => {
          if (queueing && isNetworkError(e)) {
            // The connection went: the check-off waits on the device (the
            // server takes a repeated status as a no-op).
            write.fail();
            store.wentOffline();
            store.enqueue({
              kind: "status",
              id: crypto.randomUUID(),
              taskId: id,
              status: queueing.status,
              recurrence: queueing.recurrence,
              fields: shown,
            });
            return;
          }
          refused(write, e);
        });
    },
    [runtime, workspaceId, canEdit, store, backlogToTodo, refused],
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
   * Send a new task (shown at once under a `tmp-` id, sent under its own id):
   * resolves to the saved task, or null. Offline, or when the connection goes
   * while it's on its way, it waits on the device under that id and resolves
   * null (it isn't saved yet): a resend never makes a second task.
   */
  const sendNewTask = useCallback(
    (optimistic: Task, opts: { queue?: boolean } = {}): Promise<Task | null> => {
      if (!runtime || !store) return Promise.resolve(null);
      const rt = runtime;
      const clientId = optimistic.id.replace(/^tmp-/, "");
      const queued = () =>
        store.enqueue({
          kind: "create",
          id: crypto.randomUUID(),
          task: { ...optimistic, id: clientId },
          queue: opts.queue,
        });
      if (store.isOffline()) {
        queued();
        return Promise.resolve(null);
      }
      const write = store.begin([{ table: "tasks", insert: optimistic }]);
      // A runtime with `createTask` creates under the client's id (idempotent);
      // the older path lets the server pick it.
      const send = rt.tasks.createTask
        ? rt.tasks.createTask({ ...optimistic, id: clientId })
        : rt.tasks.upsertTask({ ...optimistic, id: "" });
      return send.then(
        (saved) => {
          write.settle({ tasks: [saved] });
          return saved;
        },
        (e) => {
          write.fail();
          if (rt.tasks.createTask && isNetworkError(e)) {
            store.wentOffline();
            queued();
            return null;
          }
          toast.error(e instanceof Error ? e.message : "Couldn't create task.");
          return null;
        },
      );
    },
    [runtime, store],
  );

  /**
   * Create a task (shown at once). Resolves to the saved task, or null if it
   * wasn't created (or waits offline) — what `createTagForTask` takes to tag it
   * before it exists.
   */
  const createTask = useCallback(
    (fields: Omit<NewTaskFields, "workspaceId" | "position">): Promise<Task | null> => {
      if (!runtime || !workspaceId || !canEdit || !store) {
        toast.error(NO_EDIT);
        return Promise.resolve(null);
      }
      const bucketTasks = liveTasks.filter((t) => t.bucketId === fields.bucketId);
      const position = endPosition(bucketTasks);
      const optimistic = makeTask({ ...fields, workspaceId, position });
      // Shown right away; the server records the same creator. An assignee
      // left unchosen is the creator (as before TV-D1).
      optimistic.creatorId = userId ?? "";
      if (optimistic.assigneeId === "") optimistic.assigneeId = userId;
      optimistic.id = `tmp-${crypto.randomUUID()}`;
      return sendNewTask(optimistic);
    },
    [runtime, workspaceId, canEdit, store, liveTasks, userId, sendNewTask],
  );

  /** Send one queue op after the ones before it; its answer (my whole queue) becomes the copy. */
  const sendQueueOp = useCallback(
    (seq: number, op: () => Promise<TaskQueueEntry[]>, onSaved?: () => void) => {
      if (!store) return;
      const run = queueChain.current.then(op);
      queueChain.current = run.catch(() => {});
      void run
        .then((own) => {
          store.lineupAnswered(seq, own);
          setActivityStamp((s) => s + 1);
          onSaved?.();
        })
        .catch((e) => {
          // Only the shown line-up goes; the copy holds the server's.
          store.lineupFailed(seq);
          toast.error(e instanceof Error ? e.message : "Couldn't update your queue.");
        });
    },
    [store],
  );

  /**
   * Run a queue op (TV-D2): show `optimistic(my line-up)` at once, then the
   * RPC, which answers with my whole queue in order. The newest op's line-up
   * shows until it answers, so two quick toggles can't put back an older
   * line-up. On error: toast, and my line-up is the server's again. Returns
   * false when it couldn't start (no access, offline). `onSaved` runs once the
   * server has taken it (a drop's Undo toast).
   */
  const runQueueOp = useCallback(
    (
      optimistic: (mine: TaskQueueEntry[]) => TaskQueueEntry[],
      op: (rt: ModuoRuntime, ws: string) => Promise<TaskQueueEntry[]>,
      onSaved?: () => void,
    ): boolean => {
      if (!userId || editBlocked()) return false;
      if (!runtime || !workspaceId || !store) return false;
      const rt = runtime;
      const ws = workspaceId;
      const seq = ++queueSeq.current;
      store.setLineup(seq, optimistic(queueEntriesOf(queueRowsRef.current, userId)));
      sendQueueOp(seq, () => op(rt, ws), onSaved);
      return true;
    },
    [runtime, workspaceId, userId, store, editBlocked, sendQueueOp],
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
   * `onSaved` runs once the server has it queued (the rail drop's Undo).
   */
  const addToQueue = useCallback(
    (id: string, at: QueuePlacement = "end", onSaved?: () => void) => {
      const task = liveTasks.find((t) => t.id === id);
      if (!task) return;
      if (isTempId(id)) {
        toast.error(STILL_SAVING);
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
      // Queuing a backlog task moves it to To do (the server does it in the
      // same transaction); show it at once, until the quiet read below.
      const toTodo = canEdit && store && !store.isOffline() ? backlogToTodo(task) : null;
      const shownTodo = toTodo ? store?.begin([patchOf(id, toTodo)]) : undefined;
      const started = runQueueOp(
        (mine) => {
          const rest = mine.filter((e) => e.taskId !== id);
          const position =
            at === "top" ? betweenPositions(null, rest[0]?.position ?? null) : endOfQueue(rest);
          return [...rest, optimisticEntry(id, position)];
        },
        (rt, ws) =>
          rt.tasks.opQueueAdd({ workspaceId: ws, taskId: id, at }).catch((e) => {
            shownTodo?.fail();
            throw e;
          }),
        // The queue op answers with the queue, not the task: a quiet read then
        // settles the task's status (the server moves it only when you can
        // edit the task, which this list can't tell).
        shownTodo
          ? () => {
              onSaved?.();
              void store?.syncNow().finally(() => shownTodo.settle());
            }
          : onSaved,
      );
      if (!started) shownTodo?.fail();
      const others = queueClaims.get(id) ?? [];
      if (started && others.length > 0) toast(alsoInLabel(others.map(memberName)));
    },
    [
      liveTasks,
      queuedTaskIds,
      runQueueOp,
      optimisticEntry,
      queueClaims,
      memberName,
      canEdit,
      store,
      backlogToTodo,
    ],
  );

  const removeFromQueue = useCallback(
    (id: string) => {
      // The line-up as it is now: a drop's Undo calls this long after its render.
      if (!myQueueRef.current.some((e) => e.taskId === id)) return;
      if (isTempId(id)) {
        toast.error(STILL_SAVING);
        return;
      }
      runQueueOp(
        (mine) => mine.filter((e) => e.taskId !== id),
        (rt, ws) => rt.tasks.opQueueRemove({ workspaceId: ws, taskId: id }),
      );
    },
    [runQueueOp],
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
        toast.error(STILL_SAVING);
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
   * `onSaved` runs once the server has the new order (the drop's Undo).
   */
  const reorderQueue = useCallback(
    (orderedIds: string[], onSaved?: () => void) => {
      if (!canEdit) return;
      // The line-up as it is now: a drop's Undo calls this long after its render.
      const move = queueMove(
        myQueueRef.current.map((e) => e.taskId),
        orderedIds,
      );
      if (!move) return;
      if (isTempId(move.taskId) || (move.afterTaskId && isTempId(move.afterTaskId))) {
        toast.error(STILL_SAVING);
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
        onSaved,
      );
    },
    [canEdit, runQueueOp],
  );

  /**
   * Create a task and line it up at the end of my queue, in one gesture: shown
   * queued at once; once the server has the task, it's added to the end of my
   * queue (behind earlier queue ops). New in Focus or the Queue lands in Up next
   * this way (TV-P0, AC1.9). An assignee left unchosen is me. Resolves to the
   * saved task, or null, like `createTask` (so a capture can tag it). Offline
   * it waits on the device and is queued once it's sent.
   */
  const createQueuedTask = useCallback(
    (fields: Omit<NewTaskFields, "workspaceId" | "position">): Promise<Task | null> => {
      if (!fields.title.trim()) return Promise.resolve(null);
      if (!runtime || !workspaceId || !canEdit || !userId || !store) {
        if (!canEdit) toast.error(NO_EDIT);
        return Promise.resolve(null);
      }
      const rt = runtime;
      const ws = workspaceId;
      const me = userId;
      const position = endPosition(liveTasks.filter((t) => t.bucketId === fields.bucketId));
      const optimistic = makeTask({ ...fields, workspaceId: ws, position });
      optimistic.creatorId = me;
      if (optimistic.assigneeId === "") optimistic.assigneeId = me;
      const tempId = `tmp-${crypto.randomUUID()}`;
      optimistic.id = tempId;
      if (store.isOffline()) return sendNewTask(optimistic, { queue: true });
      const placeholder = optimisticEntry(tempId, endOfQueue(myQueueEntries));
      const seq = ++queueSeq.current;
      store.setLineup(seq, [...queueEntriesOf(queueRowsRef.current, me), placeholder]);
      return sendNewTask(optimistic, { queue: true }).then((saved): Task | null => {
        const next = ++queueSeq.current;
        const mine = queueEntriesOf(queueRowsRef.current, me);
        if (!saved) {
          // Not created (or waiting offline, queued once it's sent): the placeholder goes.
          store.setLineup(
            next,
            mine.filter((e) => e.id !== placeholder.id),
          );
          store.lineupFailed(next);
          return null;
        }
        store.setLineup(
          next,
          mine.map((e) => (e.taskId === tempId ? { ...e, taskId: saved.id } : e)),
        );
        // The task exists now; queuing it waits behind earlier queue ops.
        sendQueueOp(next, () => rt.tasks.opQueueAdd({ workspaceId: ws, taskId: saved.id }));
        return saved;
      });
    },
    [
      runtime,
      workspaceId,
      canEdit,
      userId,
      store,
      liveTasks,
      myQueueEntries,
      optimisticEntry,
      sendNewTask,
      sendQueueOp,
    ],
  );

  /**
   * Capture a new task straight into my queue (Focus's empty-queue affordance,
   * DF-11): in the Inbox, assigned to me, queued at the end.
   */
  const captureToQueue = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (!inbox) {
        if (!canEdit) toast.error(NO_EDIT);
        return;
      }
      void createQueuedTask({ bucketId: inbox.id, title: trimmed, assigneeId: userId });
    },
    [inbox, userId, canEdit, createQueuedTask],
  );

  /** "Still in Backlog · Move to To do": the offer after assigning a backlog
   *  task or giving it a due date. */
  const offerMoveToTodoRef = useRef<(task: Task) => void>(() => {});
  const offerMoveToTodo = useCallback((task: Task) => offerMoveToTodoRef.current(task), []);

  const patchTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      // A status by category (or a legacy value: the checkbox, Won't do)
      // shows the project's status for it at once (TV-D9); the server is told
      // the category, and picks the same one (or keeps one already in it).
      const explicitStatusId = patch.statusId;
      if ((patch.status || patch.statusCategory) && explicitStatusId === undefined) {
        patch = {
          ...patch,
          ...optimisticStatus(
            existing,
            { category: patch.statusCategory ?? normalizeTaskStatusCategory(patch.status) },
            statusesForBucket(existing.bucketId),
          ),
        };
      }
      // Assigning a backlog task or giving it a due date offers to plan it
      // (REPLAN 53): it stays in Backlog unless you say so.
      if (
        canEdit &&
        isBacklogTask(existing) &&
        patch.statusCategory === undefined &&
        ((patch.assigneeId != null && patch.assigneeId !== existing.assigneeId) ||
          (patch.dueDate != null && patch.dueDate !== existing.dueDate))
      ) {
        offerMoveToTodo(existing);
      }
      // Advance-on-done (spec §5d): a status change on a recurring task keeps
      // the stored nextOccurrence pointer fresh — unless the caller already
      // patched the rule itself (catch-up / skip pass it explicitly).
      if (patch.status && patch.recurrence === undefined) {
        const advanced = recurrenceOnStatusChange(existing, patch.status, new Date());
        if (advanced) {
          patch = { ...patch, recurrence: advanced };
          if (patch.status === "done" && advanced.nextOccurrence) {
            // Quiet, factual mirror — when this comes back (never a wall).
            // "Done — next: Tomorrow, 9:00 AM" (the one grammar reads "Tomorrow").
            toast(`Done — next: ${formatScheduled(advanced.nextOccurrence)}`);
          }
        }
      }
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
        if (Object.keys(rest).length === 0 || !canEdit || store?.isOffline()) return;
        patch = rest;
      }
      // Status changes are an intent op (tasks.set_status): the RPC enforces
      // the invariants server-side and logs attributed activity. Only the
      // status cluster (status / recurrence ride-along / board position) goes
      // that way — plain field edits below are field-level writes (contract §1).
      // A check-off is the one edit that waits on the device when offline.
      if (
        patch.status &&
        Object.keys(patch).every(
          (k) =>
            k === "status" ||
            k === "statusId" ||
            k === "statusCategory" ||
            k === "recurrence" ||
            k === "position",
        )
      ) {
        // By id when the change names a project status, else by category word
        // (the server keeps a status already in that category).
        const status =
          explicitStatusId ??
          (patch.statusCategory ? taskStatusWord(patch.statusCategory) : patch.status);
        const recurrence = patch.recurrence;
        const position = patch.position;
        // Done, archived or backlog leaves every queue on the server (TV-D2);
        // the same write takes it out of the queues shown.
        const follow =
          canEdit && !isTempId(id)
            ? queueFollowStatus(id, patch.statusCategory ?? patch.status)
            : { changes: [], rowIds: [] };
        applyOp(
          id,
          patch,
          () =>
            runtime!.tasks.opSetStatus({
              workspaceId: workspaceId!,
              taskId: id,
              status,
              recurrence,
              position,
            }),
          {
            extra: follow.changes,
            forget: follow.rowIds,
            offline: { status, recurrence },
          },
        );
        return;
      }
      // A scheduled time on its own is an intent op (tasks.reschedule /
      // tasks.unschedule), so setting it from a row, the panel or a menu lands
      // in the task's trail (TV-P0). The server op checks access and logs.
      if (Object.keys(patch).length === 1 && "scheduledAt" in patch) {
        const scheduledAt = patch.scheduledAt ?? null;
        if ((existing.scheduledAt ?? null) === scheduledAt) return;
        applyOp(id, { scheduledAt }, () =>
          scheduledAt
            ? runtime!.tasks.opReschedule({ workspaceId: workspaceId!, taskId: id, scheduledAt })
            : runtime!.tasks.opUnschedule({ workspaceId: workspaceId!, taskId: id }),
        );
        return;
      }
      // Field-level save (TV-D1): only the changed columns go to the server,
      // so this edit can't put back a field a teammate changed meanwhile.
      // A status shown by category goes to the server as the category (the
      // id picked here is only what shows meanwhile).
      const fields = editableTaskFields(
        explicitStatusId === undefined ? { ...patch, statusId: undefined } : patch,
      );
      if (Object.keys(fields).length === 0) return;
      if (isTempId(id)) {
        toast.error(STILL_SAVING);
        return;
      }
      if (editBlocked() || !store) return;
      // Moving a parent takes its subtasks along (TV-P0): shown at once for
      // every subtask, then settled by the server, which carries the ones you
      // can edit (TV-D8). `bundle.tasks` has the real buckets.
      const movedChildren =
        fields.bucketId !== undefined && fields.bucketId !== existing.bucketId
          ? bundle.tasks.filter(
              (t) =>
                t.parentId === id &&
                !t.deletedAt &&
                !isTempId(t.id) &&
                t.bucketId !== fields.bucketId,
            )
          : [];
      const stamp = new Date().toISOString();
      const write = store.begin([
        patchOf(id, { ...fields, updatedAt: stamp }),
        ...movedChildren.map((child) => patchOf(child.id, { bucketId: fields.bucketId })),
      ]);
      const moving = fields.bucketId !== undefined && fields.bucketId !== existing.bucketId;
      void (async () => {
        // A move is one op (TV-D8): the server moves the subtasks with their
        // parent in the same transaction and answers with every row it
        // changed, so each ends on the server's own row. A subtask it didn't
        // carry (one you can't edit) shows where the server has it once this
        // write's own fields go. Any other edit answers with the task alone.
        const saved = moving
          ? await runtime!.tasks.opUpdateTask({
              workspaceId: workspaceId!,
              taskId: id,
              patch: fields,
            })
          : [
              await runtime!.tasks.updateTask({
                workspaceId: workspaceId!,
                taskId: id,
                patch: fields,
              }),
            ];
        write.settle({ tasks: saved });
        // Every edit is in the trail now (TV-D8): refresh it.
        setActivityStamp((s) => s + 1);
      })().catch((e) => refused(write, e));
    },
    [
      bundle.tasks,
      runtime,
      workspaceId,
      store,
      applyOp,
      canEdit,
      queueFollowStatus,
      statusesForBucket,
      offerMoveToTodo,
      editBlocked,
      refused,
    ],
  );

  /**
   * Set a task's status (TV-D9): one of its project's statuses by id, or a
   * category (the project's first status of it, unless the task is already in
   * that category). The repeat pointer and the queue follow as for any status
   * change.
   */
  const setTaskStatus = useCallback(
    (id: string, target: StatusTarget) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      if ("statusId" in target) {
        const s = statusesForBucket(existing.bucketId).find((x) => x.id === target.statusId);
        if (!s || s.id === existing.statusId) return;
        patchTask(id, {
          statusId: s.id,
          statusCategory: s.category,
          status: legacyTaskStatus(s.category),
        });
        return;
      }
      if (taskCategoryOf(existing) === target.category) return;
      patchTask(id, { statusCategory: target.category, status: legacyTaskStatus(target.category) });
    },
    [bundle.tasks, statusesForBucket, patchTask],
  );

  offerMoveToTodoRef.current = (task: Task) => {
    const title = task.title.trim() || "This task";
    toast(`${title} is still in Backlog`, {
      description: "Backlog tasks stay out of My tasks, Upcoming and Focus.",
      action: {
        label: "Move to To do",
        onClick: () => setTaskStatus(task.id, { category: "todo" }),
      },
    });
  };

  // ── editing statuses (TV-D9) ─────────────────────────────────────────────────
  /** Run a status op and take the set it answers (project, or the default when
   *  `projectId` is null). Errors show and nothing changes. */
  const runStatusOp = useCallback(
    async (projectId: string | null, op: () => Promise<ProjectStatus[]>): Promise<boolean> => {
      if (editBlocked() || !store) return false;
      try {
        const set = await op();
        // The answer is the whole set: what's not in it is gone.
        const kept = new Set(set.map((s) => s.id));
        const gone = (store.getSnapshot().bundle.statuses ?? [])
          .filter((s) => s.projectId === projectId && !kept.has(s.id))
          .map((s) => s.id);
        store.answer({ statuses: set });
        store.forget("statuses", gone);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong.");
        return false;
      }
    },
    [editBlocked, store],
  );

  const createStatus = useCallback(
    (projectId: string | null, category: TaskStatusCategory, name: string) =>
      runStatusOp(projectId, () =>
        runtime!.tasks.createStatus({ workspaceId: workspaceId!, projectId, category, name }),
      ),
    [runStatusOp, runtime, workspaceId],
  );

  const updateStatus = useCallback(
    (status: ProjectStatus, patch: { name?: string; hidden?: boolean; after?: string | null }) =>
      runStatusOp(status.projectId, () =>
        runtime!.tasks.updateStatus({ workspaceId: workspaceId!, statusId: status.id, patch }),
      ),
    [runStatusOp, runtime, workspaceId],
  );

  /** Delete a status: its tasks move to the first other status of its
   *  category, and a toast says how many. */
  const deleteStatus = useCallback(
    async (status: ProjectStatus): Promise<boolean> => {
      if (editBlocked() || !runtime || !workspaceId || !store) return false;
      try {
        const answer = await runtime.tasks.deleteStatus({ workspaceId, statusId: status.id });
        store.forget("statuses", [status.id]);
        // The server moved its tasks; their rows follow live. Show it now.
        if (answer.movedTo) {
          for (const t of tasksRef.current) {
            if (t.statusId === status.id) {
              store.patchCopy("tasks", t.id, { statusId: answer.movedTo });
            }
          }
        }
        const to = answer.movedToName ?? CATEGORY_LABELS[status.category];
        toast(
          answer.moved > 0
            ? `Deleted “${status.name}” · ${answer.moved === 1 ? "1 task" : `${answer.moved} tasks`} moved to ${to}`
            : `Deleted “${status.name}”`,
        );
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong.");
        return false;
      }
    },
    [editBlocked, runtime, workspaceId, store],
  );

  // ── recurrence roll-over (TV-D8) ─────────────────────────────────────────────
  // Repeats come back on the server: at their assignee's midnight (pg_cron),
  // never on the day they were done. After the session's first read that
  // reaches the server (or a Retry; a quiet re-read on focus or reconnect
  // doesn't count), the app asks the server to roll this workspace over now,
  // so a repeat due today is back without waiting for the next 15-minute run,
  // and applies what it answers. The store hands each load to one surface
  // only. View-only sessions skip it, and so does a workspace without repeats.
  const loadStamp = snap.loadStamp;
  useEffect(() => {
    if (!canEdit || !runtime || !workspaceId || !store) return;
    if (!store.claimCatchUp(loadStamp)) return;
    if (!tasksRef.current.some((t) => t.recurrence)) return;
    void runtime.tasks
      .opCatchUp({ workspaceId, items: [] })
      .then((saved) => {
        if (saved.length === 0) return;
        store.answer({ tasks: saved });
        setActivityStamp((s) => s + 1);
      })
      .catch(() => {
        // A quiet read, never a reload: a reload asks again, and a call that
        // keeps failing (offline, a database before TV-D8's migration) would
        // loop. The next reload asks again.
        void store.syncNow();
      });
  }, [loadStamp, canEdit, runtime, workspaceId, store]);

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
   * write fails or the task is gone, the shown total goes back.
   */
  const writeTime = useCallback(
    (id: string, delta: number, input: TrackTimeInput): Promise<TaskTimeResult> => {
      if (!runtime || !store) return Promise.reject(new Error("Not signed in."));
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
      const before = tasksRef.current.find((t) => t.id === id)?.timeSpentSeconds;
      const shown = before === undefined ? undefined : Math.max(0, before + Math.round(delta));
      const write = store.begin(
        before !== undefined && shown !== before ? [patchOf(id, { timeSpentSeconds: shown })] : [],
      );
      return sent.then(
        (result) => {
          if (result.totalSeconds === null) write.fail();
          else {
            store.patchCopy("tasks", id, { timeSpentSeconds: result.totalSeconds });
            write.settle();
          }
          return result;
        },
        (e) => {
          write.fail();
          throw e;
        },
      );
    },
    [runtime, store],
  );

  // Focus time is saved by the app shell's sink, from any page (TV-P0): show
  // each saved total here as it lands.
  useEffect(() => {
    if (!workspaceId || !store) return;
    const onSaved = (event: Event) => {
      const saved = (event as CustomEvent<FocusTimeSaved>).detail;
      if (!saved || saved.workspaceId !== workspaceId) return;
      store.patchCopy("tasks", saved.taskId, { timeSpentSeconds: saved.totalSeconds });
    };
    window.addEventListener(FOCUS_TIME_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(FOCUS_TIME_SAVED_EVENT, onSaved);
  }, [workspaceId, store]);

  /** Why a time write can't be sent right now, or null. */
  const timeWriteBlocked = useCallback(
    (id: string): string | null => {
      if (!runtime || !workspaceId || !canEdit) return NO_EDIT;
      if (isTempId(id)) return STILL_SAVING;
      if (store?.isOffline()) return "You're offline — time saves once you're back.";
      return null;
    },
    [runtime, workspaceId, canEdit, store],
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
   * The module's own Focus sink (TV-F1, saving through time entries since
   * TV-D3). Since TV-P0 the engine saves through the app shell's sink
   * (features/focus/time-sink.ts) so time saves from any page; this one is no
   * longer registered and stays, with its tests, until TV-F6's one time engine
   * replaces both. It records `seconds` of focus that ended at `earnedAt` as one stretch,
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
      const before = tasksRef.current.find((t) => t.id === id)?.timeSpentSeconds ?? total;
      void writeTime(id, total - before, {
        workspaceId,
        taskId: id,
        action: "set_total",
        seconds: total,
      }).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save the time."));
    },
    [timeWriteBlocked, workspaceId, writeTime],
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
      if (store?.isOffline()) {
        sayOffline();
        return;
      }
      applyOp(id, patch, () =>
        runtime!.tasks.opSkipOccurrence({
          workspaceId: workspaceId!,
          taskId: id,
          scheduledAt,
          recurrence,
          releaseCommit: "committedFor" in patch,
        }),
      );
      toast(`Skipped — next: ${formatScheduled(scheduledAt)}`);
    },
    [bundle.tasks, applyOp, runtime, workspaceId, store],
  );

  const deleteTask = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      if (editBlocked() || !store) return;
      // Snapshot the children BEFORE the optimistic promotion — Undo re-attaches
      // them (their snapshot rows still carry parentId = id).
      const children = bundle.tasks.filter((t) => t.parentId === id && !t.deletedAt);
      // A deleted task leaves every queue; Undo doesn't put it back (TV-D2).
      const follow = queueFollowStatus(id, "deleted");
      // Deleting a parent promotes its subtasks to top-level (the server does
      // it in the same op) so they stay visible — work is never silently lost.
      const write = store.begin([
        { table: "tasks", remove: id },
        ...children.map((c) => patchOf(c.id, { parentId: null })),
        ...follow.changes,
      ]);
      void runtime!.tasks
        .deleteTask({ workspaceId: workspaceId!, taskId: id })
        .then((deleted) => {
          write.settle({ tasks: [deleted] });
          for (const c of children) store.patchCopy("tasks", c.id, { parentId: null });
          store.forget("queue", follow.rowIds);
          // Same guarantee as deleting the task from a note (DF-5): soft delete =
          // a stamp; Undo clears it and re-attaches the subtasks. Only those two
          // fields are written back, so edits made meanwhile survive (TV-D1).
          undoToast("Task deleted", {
            onUndo: () => {
              void (async () => {
                const restored = await runtime!.tasks.updateTask({
                  workspaceId: workspaceId!,
                  taskId: id,
                  patch: { deletedAt: null },
                });
                const reattached = await Promise.all(
                  children.map((c) =>
                    runtime!.tasks.updateTask({
                      workspaceId: workspaceId!,
                      taskId: c.id,
                      patch: { parentId: id },
                    }),
                  ),
                );
                store.answer({ tasks: [restored, ...reattached] });
              })().catch(() => toast.error("Couldn't restore the task."));
            },
          });
        })
        .catch((e) => refused(write, e));
    },
    [bundle.tasks, editBlocked, store, runtime, workspaceId, queueFollowStatus, refused],
  );

  // ── subtask mutations (one level — spec §11) ─────────────────────────────────

  /** Create a new subtask under `parentId`, in the parent's bucket. */
  const addSubtask = useCallback(
    (parentId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (isTempId(parentId)) {
        toast.error(STILL_SAVING);
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
          toast.error(STILL_SAVING);
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
   * Save one task's drop writes (`TaskDropWrite`): shown at once, then sent
   * in order, each after the one before has landed — the field-level write
   * (parent, project with every subtask following, Won't do and done ones
   * too; place; priority), then the status op (with the place, when it
   * rides), then the assign op. Resolves to the saved row, or null when
   * anything failed: then it has said so, and the drop's fields show the
   * server's again. `recurrence` replaces the advance a status change would
   * make (Undo puts the rule back).
   */
  const saveTaskWrite = useCallback(
    async (
      write: TaskDropWrite,
      opts: { recurrence?: RecurrenceRule | null } = {},
    ): Promise<Task | null> => {
      if (editBlocked() || !runtime || !workspaceId || !store) return null;
      const { taskId, status, assigneeId } = write;
      if (isTempId(taskId)) {
        toast.error(STILL_SAVING);
        return null;
      }
      const existing = tasksRef.current.find((t) => t.id === taskId);
      if (!existing) return null;
      const rt = runtime;
      const ws = workspaceId;
      const fields = editableTaskFields({
        parentId: write.parentId,
        bucketId: write.bucketId,
        priority: write.priority,
        // The place rides with the status op when there is one.
        position: status === undefined ? write.position : undefined,
      });
      const now = new Date();
      // A status key (Backlog is its own) is saved as its category (TV-D9).
      const category = status === undefined ? undefined : statusKeyCategory(status);
      const recurrence =
        category === undefined
          ? undefined
          : opts.recurrence !== undefined
            ? opts.recurrence
            : (recurrenceOnStatusChange(existing, legacyTaskStatus(category), now) ?? undefined);
      const followers =
        write.bucketId !== undefined && write.bucketId !== existing.bucketId
          ? tasksRef.current.filter(
              (t) =>
                t.parentId === taskId &&
                !t.deletedAt &&
                !isTempId(t.id) &&
                t.bucketId !== write.bucketId,
            )
          : [];

      const stamp = now.toISOString();
      const follow =
        category !== undefined ? queueFollowStatus(taskId, category) : { changes: [], rowIds: [] };
      const shown = store.begin([
        patchOf(taskId, {
          ...fields,
          ...(write.position !== undefined ? { position: write.position } : {}),
          ...(category !== undefined
            ? optimisticStatus(
                existing,
                write.statusId ? { statusId: write.statusId } : { category },
                statusesForBucket(write.bucketId ?? existing.bucketId),
              )
            : {}),
          ...(recurrence !== undefined ? { recurrence } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          updatedAt: stamp,
        }),
        ...followers.map((child) => patchOf(child.id, { bucketId: write.bucketId })),
        ...follow.changes,
      ]);

      try {
        const saved: Task[] = [];
        if (Object.keys(fields).length > 0) {
          const row = await rt.tasks.updateTask({ workspaceId: ws, taskId, patch: fields });
          saved.push(row);
          // Subtasks follow the project the parent really landed in.
          saved.push(
            ...(await Promise.all(
              followers.map((child) =>
                rt.tasks.updateTask({
                  workspaceId: ws,
                  taskId: child.id,
                  patch: { bucketId: row.bucketId },
                }),
              ),
            )),
          );
        }
        if (category !== undefined) {
          saved.push(
            await rt.tasks.opSetStatus({
              workspaceId: ws,
              taskId,
              // By id when Undo puts a named status back, else the word.
              status: write.statusId ?? taskStatusWord(category),
              recurrence,
              position: write.position,
            }),
          );
        }
        if (assigneeId !== undefined) {
          saved.push(await rt.tasks.opAssign({ workspaceId: ws, taskId, assigneeId }));
        }
        // The last answer for a row is the newest.
        const byId = new Map(saved.map((t) => [t.id, t]));
        shown.settle({ tasks: [...byId.values()] });
        store.forget("queue", follow.rowIds);
        setActivityStamp((s) => s + 1);
        if (status === "done" && opts.recurrence === undefined && recurrence?.nextOccurrence) {
          toast(`Done — next: ${formatScheduled(recurrence.nextOccurrence)}`);
        }
        return byId.get(taskId) ?? null;
      } catch (e) {
        // What already saved stays; the rest shows the server's again.
        refused(shown, e);
        if (category !== undefined) store.unkeep(taskId);
        return null;
      }
    },
    [
      editBlocked,
      runtime,
      workspaceId,
      store,
      queueFollowStatus,
      statusesForBucket,
      refused,
    ],
  );

  /**
   * Put a task back in my queue where it was before a drop closed it (TV-U4's
   * gap: Done, then Undo): after the queued task it followed then, or the
   * nearest earlier one still queued, or at the top.
   */
  const restoreQueuePlace = useCallback(
    (taskId: string, lineupBefore: string[]) => {
      if (myQueueRef.current.some((e) => e.taskId === taskId)) return;
      const queuedNow = new Set(myQueueRef.current.map((e) => e.taskId));
      const at = lineupBefore.indexOf(taskId);
      let afterTaskId: string | null = null;
      for (let i = at - 1; i >= 0; i -= 1) {
        if (queuedNow.has(lineupBefore[i])) {
          afterTaskId = lineupBefore[i];
          break;
        }
      }
      runQueueOp(
        (mine) => {
          const index = afterTaskId ? mine.findIndex((e) => e.taskId === afterTaskId) : -1;
          const prev = index >= 0 ? mine[index].position : null;
          const next = mine[index + 1]?.position ?? null;
          return [...mine, optimisticEntry(taskId, betweenPositions(prev, next))];
        },
        async (rt, ws) => {
          await rt.tasks.opQueueAdd({ workspaceId: ws, taskId, at: "end" });
          return rt.tasks.opQueueReorder({ workspaceId: ws, taskId, afterTaskId });
        },
      );
    },
    [runQueueOp, optimisticEntry],
  );

  /**
   * A drop, or a move key (TV-U4): save `write` (`saveTaskWrite`), and once
   * the server has taken all of it, say `label` with an 8 s Undo (call a). A
   * move into another project that didn't place the task sends it to that
   * project's end. Undo puts back each field the drop changed, unless it
   * changed again since: it never overwrites a newer change, and says so. A
   * drop that closed a queued task (Done) puts it back in my queue where it
   * was. Resolves to whether the drop saved; a failed one shows no Undo.
   */
  const dropTask = useCallback(
    async (write: TaskDropWrite, label: string): Promise<boolean> => {
      const before = tasksRef.current.find((t) => t.id === write.taskId);
      if (!before) return false;
      // My line-up before the drop: a drop that closes the task takes it out.
      const lineupBefore = myQueueRef.current.map((e) => e.taskId);
      const wasQueued = lineupBefore.includes(write.taskId);
      const moving =
        write.bucketId !== undefined &&
        write.bucketId !== before.bucketId &&
        write.position === undefined;
      const saving: TaskDropWrite = moving
        ? {
            ...write,
            position: bucketEndPosition({
              moving: new Set([
                write.taskId,
                ...tasksRef.current.filter((t) => t.parentId === write.taskId).map((t) => t.id),
              ]),
              bucketId: write.bucketId as string,
              allByPosition: liveTasks,
            }),
          }
        : write;
      const after = await saveTaskWrite(saving);
      if (!after) return false;
      undoToast(label, {
        onUndo: () => {
          const current = tasksRef.current.find((t) => t.id === write.taskId);
          const title = `“${before.title || "Untitled"}”`;
          if (!current || current.deletedAt) {
            toast(`${title} is gone, so there’s nothing to undo.`);
            return;
          }
          const undo = undoWrite({ write: saving, before, after, current });
          const keptNote = () => {
            if (undo.kept.length > 0) toast(`Undo kept a newer change to ${title}.`);
          };
          if (!undo.write) {
            keptNote();
            return;
          }
          // A status going back takes its repeat rule back too: the one before
          // the drop, unless the rule was edited since (then it stays as is).
          const ruleUntouched =
            JSON.stringify(current.recurrence) === JSON.stringify(after.recurrence);
          void saveTaskWrite(undo.write, {
            recurrence:
              undo.write.status === undefined
                ? undefined
                : ruleUntouched
                  ? before.recurrence
                  : current.recurrence,
          }).then((saved) => {
            if (!saved) return;
            keptNote();
            // Back to open from a drop that closed it: its queue place too.
            if (wasQueued && isOpenTask(saved)) restoreQueuePlace(saved.id, lineupBefore);
          });
        },
      });
      return true;
    },
    [liveTasks, saveTaskWrite, restoreQueuePlace],
  );

  // ── blocked-by mutations (edges, not statuses — spec §5c) ────────────────────

  /** Add a blocker → task edge. Cycle-checked here; the DB trigger backstops. */
  const addBlocker = useCallback(
    (taskId: string, blockerId: string) => {
      if (editBlocked() || !runtime || !workspaceId || !store) return;
      if (isTempId(taskId) || isTempId(blockerId)) {
        toast.error(STILL_SAVING);
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
      const optimistic: TaskRelation = {
        id: `tmp-${crypto.randomUUID()}`,
        workspaceId,
        blockerTaskId: blockerId,
        blockedTaskId: taskId,
        createdAt: new Date().toISOString(),
      };
      const write = store.begin([{ table: "relations", insert: optimistic }]);
      void runtime.tasks
        .createTaskRelation({ workspaceId, blockerTaskId: blockerId, blockedTaskId: taskId })
        .then((saved) => write.settle({ relations: [saved] }))
        .catch((e) => refused(write, e, "Couldn't add the dependency."));
    },
    [editBlocked, runtime, workspaceId, store, bundle.taskRelations, refused],
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
      if (editBlocked() || !store) return;
      const write = store.begin([{ table: "relations", remove: existing.id }]);
      void runtime!.tasks
        .deleteTaskRelation({ workspaceId: workspaceId!, relationId: existing.id })
        .then(() => {
          store.forget("relations", [existing.id]);
          write.settle();
        })
        .catch((e) => refused(write, e));
    },
    [bundle.taskRelations, editBlocked, store, runtime, workspaceId, refused],
  );

  // ── bucket mutations ─────────────────────────────────────────────────────────
  const createBucket = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (editBlocked() || !runtime || !workspaceId || !store) return;
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
      const write = store.begin([{ table: "buckets", insert: optimistic }]);
      void runtime.tasks
        .upsertBucket({ ...optimistic, id: "" })
        .then((saved) => write.settle({ buckets: [saved] }))
        .catch((e) => refused(write, e, "Couldn't create bucket."));
    },
    [editBlocked, runtime, workspaceId, store, bundle.buckets, userId, refused],
  );

  /** Save a bucket's edited fields (rename, section): shown at once, settled by the server's row. */
  const saveBucket = useCallback(
    (existing: Bucket, fields: Partial<Bucket>) => {
      if (editBlocked() || !store) return;
      const updated = { ...existing, ...fields, updatedAt: new Date().toISOString() };
      const write = store.begin([
        { table: "buckets", patch: { id: existing.id, fields: fields as Record<string, unknown> } },
      ]);
      void runtime!.tasks
        .upsertBucket(updated)
        .then((saved) => write.settle({ buckets: [saved] }))
        .catch((e) => refused(write, e));
    },
    [editBlocked, store, runtime, refused],
  );

  const renameBucket = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      const existing = bundle.buckets.find((b) => b.id === id);
      if (!existing || !trimmed || trimmed === existing.name) return;
      saveBucket(existing, { name: trimmed });
    },
    [bundle.buckets, saveBucket],
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
      saveBucket(existing, { group: next });
    },
    [bundle.buckets, saveBucket],
  );

  /**
   * Assign a bucket to a time-of-day slot (or clear it with `slot = null`).
   * Optimistic; persisted per-workspace via the runtime (spec §9).
   */
  const setTimeBlock = useCallback(
    (bucketId: string, slot: TimeBlockSlot | null) => {
      if (editBlocked()) return;
      const before = timeBlocks;
      const next = setBucketTimeBlock(timeBlocks, bucketId, slot);
      setTimeBlocksState(next);
      void runtime!.tasks
        .setTimeBlocks({ workspaceId: workspaceId!, blocks: next })
        .catch((e) => {
          setTimeBlocksState((now) => (now === next ? before : now));
          toast.error(e instanceof Error ? e.message : "Something went wrong.");
        });
    },
    [timeBlocks, editBlocked, runtime, workspaceId],
  );

  /**
   * Delete a user bucket; its tasks move to Inbox. The rail confirms first
   * (tasks-v2 Q1-4). Deferred commit, like `deleteTag`: the bucket is hidden at
   * once (hidden-buckets.ts — every task surface agrees, and its tasks show in
   * Inbox), the server delete waits until the Undo toast closes, and Undo
   * un-hides it. The copy itself is never touched, so saves made meanwhile
   * still write the task's real bucket, and Undo has nothing to restore.
   */
  const deleteBucket = useCallback(
    (id: string) => {
      if (editBlocked() || !runtime || !workspaceId) return;
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
            // Its tasks moved on the server: read what changed.
            .then(() => store?.syncNow())
            .catch((e) => {
              unhideBucket(id);
              toast.error(e instanceof Error ? e.message : "Couldn't delete the bucket.");
            });
        },
      });
    },
    [editBlocked, runtime, workspaceId, liveBuckets, taskCountByBucket, store],
  );

  // ── tag mutations (through the shared workspace tag store, TV-T1) ────────────

  /** Where tag writes go, or null (with a toast) when this person can't edit Tasks. */
  const tagContext = useCallback((): TagContext | null => {
    if (editBlocked() || !runtime || !workspaceId) return null;
    return { runtime, workspaceId, userId };
  }, [editBlocked, runtime, workspaceId, userId]);

  /** Attach or detach an existing tag on a task. */
  const toggleTaskTag = useCallback(
    (taskId: string, tagId: string) => {
      const ctx = tagContext();
      if (!ctx) return;
      if (isTempId(taskId)) {
        toast.error(STILL_SAVING);
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
        toast.error(STILL_SAVING);
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
    loaded,
    error,
    canRead,
    canEdit,
    /** Offline: reading the device copy; captures and check-offs wait (TV-D11a). */
    offline: !!store && snap.offline,
    /** Captures and check-offs waiting to sync ("2 waiting to sync"). */
    pendingSync: store ? snap.pending : 0,
    /** Done, Won't do and Backlog tasks have arrived (they load after the open ones). */
    restLoaded: !!store && snap.restLoaded,
    /** Live comments per task (TV-D11a; TV-D5's promised counts). */
    commentCounts: snap.commentCounts,
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
    /** Every status this reader can see (TV-D9). */
    statuses,
    statusById,
    statusesForBucket,
    setTaskStatus,
    createStatus,
    updateStatus,
    deleteStatus,
    createTask,
    createQueuedTask,
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
    dropTask,
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
