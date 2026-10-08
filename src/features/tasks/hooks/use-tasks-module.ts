// Data hook for the Tasks module. Loads the workspace bundle and exposes
// optimistic CRUD over buckets and tasks. Mutations update local state first for
// snappy, keyboard-driven editing; on error they reload from the source of truth
// and surface a toast. Drift is computed client-side via isDrifted().

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { editableTaskFields } from "../../../lib/task-rows";
import { undoToast } from "../../../lib/undo-toast";
import { formatAwaySpan } from "../../focus/away-copy";
import type { FocusSaveContext } from "../../focus/engine";
import { readSavedFocusTotal, writeSavedFocusTotal } from "../../focus/saved-totals";
import {
  createOrAttachByName,
  deleteTag as deleteWorkspaceTag,
  recolorTag,
  seedTags,
  type TagContext,
  toggleTag,
  useTagView,
} from "../../tags/store";
import { setBucketTimeBlock } from "../default-view";
import { writeTaskTimeTotal } from "../focus-time-write";
import {
  blockedTaskIds as computeBlockedTaskIds,
  subtasksByParent as computeSubtasksByParent,
  endPosition,
  formatScheduled,
  frontierTasks,
  makeTask,
  type NewTaskFields,
  subtaskProgress,
  todayStr,
  wouldCreateCycle,
} from "../helpers";
import { hideBucket, unhideBucket, useHiddenBuckets } from "../hidden-buckets";
import {
  type ActivityEntry,
  type Bucket,
  INBOX_BUCKET_NAME,
  isDrifted,
  type RecurrenceRule,
  type Tag,
  type Task,
  type TaskRelation,
  type TasksCatchUpItem,
  type TasksModuleBundle,
  type TimeBlockMap,
  type TimeBlockSlot,
} from "../model";
import {
  catchUpItem,
  catchUpPatch,
  recurrenceOnStatusChange,
  skipOccurrencePatch,
} from "../recurrence-engine";
import { commitOrderUpdates } from "../reorder";

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

/** The bundle's tag-links read, as its SCALE-1 truncation names it. */
const TAG_LINKS_SCOPE = "tag assignments";

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
      // read just means the default view skips the time-block step.
      const [next, blocks] = await Promise.all([
        runtime.tasks.list(workspaceId),
        runtime.tasks.getTimeBlocks(workspaceId).catch((): TimeBlockMap => ({})),
      ]);
      if (reqRef.current === req) {
        setBundle(next);
        // Tags live in the workspace tag store, shared by every surface (TV-T1).
        seedTags(workspaceId, {
          tags: next.tags,
          links: next.tagLinks,
          scope: { kind: "all" },
          at: startedAt,
          complete: !next.truncated.some((t) => t.scope === TAG_LINKS_SCOPE),
        });
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

  /**
   * Capture a new task straight into today's commit queue (Focus empty-queue
   * affordance, DF-11). Mirrors {@link createTask} but sets `committedFor`/
   * `commitOrder` on the create payload, so the task lands in Execute's queue
   * immediately — no temp-id round-trip before a separate commit (which would be
   * rejected). Created in the Inbox. Like `createTask`, the raw upsert path logs
   * no attributed create/commit activity (consistent with capture).
   */
  const commitNewTaskToday = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (!runtime || !workspaceId || !canEdit || !inbox) {
        if (!canEdit) toast.error("You don't have edit access to Tasks in this workspace.");
        return;
      }
      const bucketId = inbox.id;
      const bucketTasks = liveTasks.filter((t) => t.bucketId === bucketId);
      const position = endPosition(bucketTasks);
      const maxOrder = committedTasks.reduce((m, t) => Math.max(m, t.commitOrder ?? 0), 0);
      const optimistic = makeTask({
        bucketId,
        title: trimmed,
        workspaceId,
        position,
        assigneeId: userId,
      });
      optimistic.creatorId = userId ?? "";
      optimistic.committedFor = today;
      optimistic.commitOrder = maxOrder + 1;
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
    [runtime, workspaceId, canEdit, inbox, liveTasks, committedTasks, today, userId],
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
    [bundle.tasks, patchTaskLocal, guard, runtime, workspaceId, applyOp, canEdit],
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

  /** Skip: take a committed task out of today's queue (and, since TV-D2, out
   * of my personal queue). Leaving the queue isn't a slip, so the reschedule
   * count stays as it is (tasks-v2 decision 4); the op clears the commit. */
  const rescheduleFromToday = useCallback(
    (id: string) => {
      const existing = bundle.tasks.find((t) => t.id === id);
      if (!existing) return;
      applyOp(id, { committedFor: null, commitOrder: null }, () =>
        runtime!.tasks.opSkipToday({ workspaceId: workspaceId!, taskId: id }),
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
      toast(`Skipped — next ${formatScheduled(scheduledAt)}`);
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
    [bundle.tasks, guard, runtime, workspaceId, load],
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
    today,
    committedTasks,
    reload: load,
    createTask,
    commitNewTaskToday,
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
