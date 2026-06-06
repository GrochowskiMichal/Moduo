// Data hook for the Tasks module. Loads the workspace bundle and exposes
// optimistic CRUD over buckets and tasks. Mutations update local state first for
// snappy, keyboard-driven editing; on error they reload from the source of truth
// and surface a toast. Drift is computed client-side via isDrifted().

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import {
  endPosition,
  makeTask,
  todayStr,
  type NewTaskFields,
} from "../helpers";
import {
  INBOX_BUCKET_NAME,
  isDrifted,
  type Bucket,
  type Task,
  type TasksModuleBundle,
} from "../model";

type Params = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
};

const EMPTY_BUNDLE: TasksModuleBundle = { buckets: [], tasks: [], tags: [], tagLinks: [] };

function byPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

export function useTasksModule(runtime: ModuoRuntime | null, params: Params) {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [bundle, setBundle] = useState<TasksModuleBundle>(EMPTY_BUNDLE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    if (!runtime || !userId || !workspaceId || !canRead) {
      setBundle(EMPTY_BUNDLE);
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    try {
      const next = await runtime.tasks.list(workspaceId);
      if (reqRef.current === req) {
        setBundle(next);
        setError(null);
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

  /** Soft, ambient per-bucket drift counts (scheduled-and-passed, still open). */
  const driftCountByBucket = useMemo(() => {
    const now = new Date();
    const counts = new Map<string, number>();
    for (const t of liveTasks) {
      if (isDrifted(t, now)) counts.set(t.bucketId, (counts.get(t.bucketId) ?? 0) + 1);
    }
    return counts;
  }, [liveTasks]);

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
      const updated: Task = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      patchTaskLocal(id, { ...patch, updatedAt: updated.updatedAt });
      guard(async () => {
        const saved = await runtime!.tasks.upsertTask(updated);
        setBundle((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === id ? saved : t)) }));
      });
    },
    [bundle.tasks, patchTaskLocal, guard, runtime],
  );

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

  /** Toggle a task in/out of today's commit queue (commit = "doing this today"). */
  const toggleCommit = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      if (existing.committedFor === today) {
        patchTask(id, { committedFor: null, commitOrder: null });
        return;
      }
      const maxOrder = committedTasks.reduce((m, t) => Math.max(m, t.commitOrder ?? 0), 0);
      patchTask(id, { committedFor: today, commitOrder: maxOrder + 1 });
    },
    [bundle.tasks, today, committedTasks, patchTask],
  );

  /** Skip: reschedule a committed task out of today — ambient count++ (no wall). */
  const rescheduleFromToday = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      patchTask(id, {
        committedFor: null,
        commitOrder: null,
        rescheduleCount: existing.rescheduleCount + 1,
      });
    },
    [bundle.tasks, patchTask],
  );

  /** Do last: keep it committed but send it to the end of today's queue. */
  const doLast = useCallback(
    (id: string) => {
      const maxOrder = committedTasks.reduce((m, t) => Math.max(m, t.commitOrder ?? 0), 0);
      patchTask(id, { commitOrder: maxOrder + 1 });
    },
    [committedTasks, patchTask],
  );

  const deleteTask = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      setBundle((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }));
      guard(async () => {
        await runtime!.tasks.deleteTask({ workspaceId: workspaceId!, taskId: id });
      });
    },
    [bundle.tasks, guard, runtime, workspaceId],
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

  return {
    loading,
    error,
    canRead,
    canEdit,
    buckets,
    inbox,
    tasks: liveTasks,
    tags: bundle.tags,
    openTaskCountByBucket,
    driftCountByBucket,
    today,
    committedTasks,
    reload: load,
    createTask,
    patchTask,
    toggleDone,
    markDone,
    toggleCommit,
    rescheduleFromToday,
    doLast,
    deleteTask,
    createBucket,
    renameBucket,
    deleteBucket,
    INBOX_BUCKET_NAME,
  };
}

export type TasksModuleApi = ReturnType<typeof useTasksModule>;
