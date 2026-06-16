// Data hook for the Tasks module. Loads the workspace bundle and exposes
// optimistic CRUD over buckets and tasks. Mutations update local state first for
// snappy, keyboard-driven editing; on error they reload from the source of truth
// and surface a toast. Drift is computed client-side via isDrifted().

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { pickTagColor } from "../../../components/tag-colors";
import { setBucketTimeBlock } from "../default-view";
import {
  blockedTaskIds as computeBlockedTaskIds,
  endPosition,
  formatScheduled,
  frontierTasks,
  makeTask,
  subtaskProgress,
  subtasksByParent as computeSubtasksByParent,
  todayStr,
  wouldCreateCycle,
  type NewTaskFields,
} from "../helpers";
import {
  catchUpItem,
  catchUpPatch,
  recurrenceOnStatusChange,
  skipOccurrencePatch,
} from "../recurrence-engine";
import { commitOrderUpdates } from "../reorder";
import {
  INBOX_BUCKET_NAME,
  isDrifted,
  type ActivityEntry,
  type Bucket,
  type RecurrenceRule,
  type Tag,
  type TagLink,
  type Task,
  type TaskRelation,
  type TasksCatchUpItem,
  type TasksModuleBundle,
  type TimeBlockMap,
  type TimeBlockSlot,
} from "../model";

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
  const [timeBlocks, setTimeBlocksState] = useState<TimeBlockMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);
  /** Bumped on every successful load — the recurrence catch-up trigger. */
  const [loadStamp, setLoadStamp] = useState(0);

  const load = useCallback(async () => {
    if (!runtime || !userId || !workspaceId || !canRead) {
      setBundle(EMPTY_BUNDLE);
      setTimeBlocksState({});
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    try {
      // Time-blocks ride along with the bundle but never block it — a failed
      // read just means the default view skips the time-block step.
      const [next, blocks] = await Promise.all([
        runtime.tasks.list(workspaceId),
        runtime.tasks.getTimeBlocks(workspaceId).catch((): TimeBlockMap => ({})),
      ]);
      if (reqRef.current === req) {
        setBundle(next);
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
  const liveTasks = useMemo(
    () => bundle.tasks.filter((t) => !t.deletedAt).slice().sort(byPosition),
    [bundle.tasks],
  );
  const liveBuckets = useMemo(
    () => bundle.buckets.filter((b) => !b.deletedAt),
    [bundle.buckets],
  );
  const inbox = useMemo(
    () => liveBuckets.find((b) => b.isSystem) ?? null,
    [liveBuckets],
  );
  /** User buckets (Inbox excluded — the rail pins it), position-sorted. */
  const buckets = useMemo(
    () => liveBuckets.filter((b) => !b.isSystem).slice().sort(byPosition),
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

  // ── today's commit queue ─────────────────────────────────────────────────────
  const today = todayStr();
  /** Tasks committed for today, ordered by commitOrder (the Execute queue). */
  const committedTasks = useMemo(
    () =>
      liveTasks
        .filter((t) => t.committedFor === today && t.status !== "archived")
        .slice()
        .sort((a, b) => (a.commitOrder ?? 0) - (b.commitOrder ?? 0)),
    [liveTasks, today],
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
    [runtime, workspaceId, canEdit, liveTasks],
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
            toast.success(`Done — next ${formatScheduled(advanced.nextOccurrence)}`);
          }
        }
      }
      // Status changes are an intent op (tasks.set_status): the RPC enforces
      // the invariants server-side and logs attributed activity. Only the
      // status cluster (status / recurrence ride-along / board position) goes
      // that way — plain field edits below stay raw upserts (contract §1).
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
      const updated: Task = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      patchTaskLocal(id, { ...patch, updatedAt: updated.updatedAt });
      guard(async () => {
        const saved = await runtime!.tasks.upsertTask(updated);
        setBundle((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === id ? saved : t)) }));
      });
    },
    [bundle.tasks, patchTaskLocal, guard, runtime, workspaceId, applyOp],
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

  const markDone = useCallback(
    (id: string) => patchTask(id, { status: "done" }),
    [patchTask],
  );

  /** Archive a task — terminal, removes it from open lists (used by drift triage). */
  const archiveTask = useCallback(
    (id: string) => patchTask(id, { status: "archived" }),
    [patchTask],
  );

  /**
   * Lightweight time-tracking: fold an elapsed work delta (seconds) into the
   * task's persisted total through the normal save path. Reads the current
   * total from the source of truth so repeated flushes accumulate cleanly.
   */
  const addTimeSpent = useCallback(
    (id: string, deltaSeconds: number) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 1) return;
      const t = bundle.tasks.find((x) => x.id === id);
      if (!t) return;
      patchTask(id, { timeSpentSeconds: Math.max(0, (t.timeSpentSeconds ?? 0) + Math.round(deltaSeconds)) });
    },
    [bundle.tasks, patchTask],
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

  /** Toggle a task in/out of today's commit queue (commit = "doing this today"). */
  const toggleCommit = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      if (existing.committedFor === today) {
        applyOp(id, { committedFor: null, commitOrder: null }, () =>
          runtime!.tasks.opUncommit({ workspaceId: workspaceId!, taskId: id }),
        );
        return;
      }
      // Optimistic order; the op recomputes it under a row lock (race-safe).
      const maxOrder = committedTasks.reduce((m, t) => Math.max(m, t.commitOrder ?? 0), 0);
      applyOp(id, { committedFor: today, commitOrder: maxOrder + 1 }, () =>
        runtime!.tasks.opCommit({ workspaceId: workspaceId!, taskId: id, forDate: today }),
      );
    },
    [bundle.tasks, today, committedTasks, applyOp, runtime, workspaceId],
  );

  /** Skip: reschedule a committed task out of today — ambient count++ (no wall).
   * The op clears the commit and increments the counter atomically. */
  const rescheduleFromToday = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      applyOp(
        id,
        {
          committedFor: null,
          commitOrder: null,
          rescheduleCount: existing.rescheduleCount + 1,
        },
        () => runtime!.tasks.opSkipToday({ workspaceId: workspaceId!, taskId: id }),
      );
    },
    [bundle.tasks, applyOp, runtime, workspaceId],
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
      toast.success(`Skipped — next ${formatScheduled(scheduledAt)}`);
    },
    [bundle.tasks, applyOp, runtime, workspaceId],
  );

  /**
   * Reorder the committed queue to `orderedIds` (drag-to-reorder). Renumbers the
   * affected rows' commitOrder through the normal save path — only the rows whose
   * rank changed are written. Queue order rides the lightweight `commit_order`
   * column rather than an intent op: a high-frequency, low-stakes personal
   * ordering, the same call shape as the board's `position` drag.
   */
  const reorderQueue = useCallback(
    (orderedIds: string[]) => {
      if (!canEdit) return;
      for (const u of commitOrderUpdates(orderedIds, committedTasks)) {
        patchTask(u.id, { commitOrder: u.commitOrder });
      }
    },
    [canEdit, committedTasks, patchTask],
  );

  const deleteTask = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      // Deleting a parent promotes its subtasks to top-level (mirrored in the
      // runtime) so they stay visible — work is never silently lost.
      setBundle((prev) => ({
        ...prev,
        tasks: prev.tasks
          .filter((t) => t.id !== id)
          .map((t) => (t.parentId === id ? { ...t, parentId: null } : t)),
      }));
      guard(async () => {
        await runtime!.tasks.deleteTask({ workspaceId: workspaceId!, taskId: id });
      });
    },
    [bundle.tasks, guard, runtime, workspaceId],
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
      createTask({ bucketId: parent.bucketId, title: trimmed, parentId });
    },
    [liveTasks, createTask],
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
      const position = endPosition(liveBuckets);
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
    [runtime, workspaceId, canEdit, liveBuckets, userId],
  );

  const renameBucket = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      const existing = bundle.buckets.find((b) => b.id === id);
      if (!existing || !trimmed || trimmed === existing.name) return;
      const updated = { ...existing, name: trimmed, updatedAt: new Date().toISOString() };
      setBundle((prev) => ({ ...prev, buckets: prev.buckets.map((b) => (b.id === id ? updated : b)) }));
      guard(async () => {
        const saved = await runtime!.tasks.upsertBucket(updated);
        setBundle((prev) => ({ ...prev, buckets: prev.buckets.map((b) => (b.id === id ? saved : b)) }));
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
      setBundle((prev) => ({ ...prev, buckets: prev.buckets.map((b) => (b.id === id ? updated : b)) }));
      guard(async () => {
        const saved = await runtime!.tasks.upsertBucket(updated);
        setBundle((prev) => ({ ...prev, buckets: prev.buckets.map((b) => (b.id === id ? saved : b)) }));
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

  const deleteBucket = useCallback(
    (id: string) => {
      const existing = bundle.buckets.find((b) => b.id === id);
      if (!existing || existing.isSystem) return;
      const fallbackId = inbox?.id;
      // Optimistic: drop the bucket, reassign its tasks to Inbox locally.
      setBundle((prev) => ({
        ...prev,
        buckets: prev.buckets.filter((b) => b.id !== id),
        tasks: fallbackId
          ? prev.tasks.map((t) => (t.bucketId === id ? { ...t, bucketId: fallbackId } : t))
          : prev.tasks,
      }));
      guard(async () => {
        await runtime!.tasks.deleteBucket({ workspaceId: workspaceId!, bucketId: id });
        await load();
      });
    },
    [bundle.buckets, inbox, guard, runtime, workspaceId, load],
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
        setBundle((prev) => ({ ...prev, tagLinks: prev.tagLinks.filter((l) => l.id !== existing.id) }));
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
          setBundle((prev) => ({ ...prev, tagLinks: prev.tagLinks.filter((l) => l.id !== tempId) }));
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
          const orphanId = savedTagId;
          setBundle((prev) => ({
            ...prev,
            tags: prev.tags.filter((t) => t.id !== tempTagId && t.id !== orphanId),
            tagLinks: prev.tagLinks.filter(
              (l) => l.id !== tempLinkId && l.tagId !== tempTagId && l.tagId !== orphanId,
            ),
          }));
          // The tag was created but attaching failed — delete the orphan server-side.
          if (orphanId) {
            void rt.tasks.deleteTag({ workspaceId: wsId, tagId: orphanId }).catch(() => {});
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
      setBundle((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === tagId ? updated : t)) }));
      guard(async () => {
        const saved = await runtime!.tasks.upsertTag(updated);
        setBundle((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === tagId ? saved : t)) }));
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
      setBundle((prev) => ({
        ...prev,
        tags: prev.tags.filter((t) => t.id !== tagId),
        tagLinks: prev.tagLinks.filter((l) => l.tagId !== tagId),
      }));
      guard(async () => {
        await runtime!.tasks.deleteTag({ workspaceId: workspaceId!, tagId });
      });
    },
    [bundle.tags, guard, runtime, workspaceId],
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
    driftCountByBucket,
    timeBlocks,
    setTimeBlock,
    today,
    committedTasks,
    reload: load,
    createTask,
    patchTask,
    toggleDone,
    markDone,
    archiveTask,
    addTimeSpent,
    setTimeSpent,
    rescheduleScheduledAt,
    unscheduleTask,
    toggleCommit,
    rescheduleFromToday,
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
