// Data hook for the Tasks module. Reads the workspace's shared store (TV-D11a,
// `src/lib/sync/`) — the one copy every surface shares, opened from the device
// and kept live — and exposes optimistic CRUD over buckets and tasks. Each
// mutation is a write on the store: shown at once, sent through the server
// op, and on a refusal only that write's fields go back (with a toast);
// nothing reloads. Offline, captures and check-offs wait on the device and
// every other edit says "Offline". Drift is computed client-side via isDrifted().
//
// The commands live in `../commands/`, grouped by aggregate, and are made once
// per store, runtime, workspace and person: they read the store's data when
// they run, so a store change gives none of them a new identity. What changes
// without a new store (edit access, members, time blocks, the trash read)
// reaches them through `env()`, kept current after each render.

import { isOpenTask } from "@contracts/vocabularies";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useStoreSnapshot, useWorkspaceStore } from "../../../lib/sync/react";
import { EMPTY_SNAPSHOT } from "../../../lib/sync/store";
import { useTagView } from "../../tags/store";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import {
  createTaskCommands,
  makeFailed,
  type TaskCommandsContext,
  type TaskCommandsEnv,
} from "../commands";
import {
  INBOX_BUCKET_NAME,
  type ProjectStatus,
  type Tag,
  type TasksTrash,
  type TimeBlockMap,
} from "../model";
import {
  allTasksOf,
  driftCountByBucketOf,
  frontierOf,
  statusesForBucketOf,
  tasksDataOf,
} from "../selectors";
import { useToday } from "../use-today";
import { useViewOps } from "./use-view-ops";

export type { ArchiveOpenTasks, TimeAdjustment, TrashTarget } from "../commands";

type Params = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
  /** Also read Recently deleted (TV-U6): the Tasks page only. */
  includeTrash?: boolean;
};

/** One empty list for every absent collection (a stable identity for memos). */
const NO_ROWS: never[] = [];

/**
 * Everything the Tasks module builds for one workspace: the store, the stable
 * commands and the stateful pieces, plus the one big `api` object the pages
 * still take. `TasksProvider` (`../tasks-context.tsx`) holds it for a page;
 * `useTasksModule` is the provider-less path and returns only `api`.
 */
export function useTasksRoot(baseRuntime: ModuoRuntime | null, params: Params) {
  const { userId, workspaceId, modulePermission = "none", includeTrash = false } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  // The shared store (TV-D11a): one per workspace, shared by every surface
  // that shows tasks. It reads, keeps the copy live (Realtime, TV-D5) and
  // holds every write until the server answers.
  const store = useWorkspaceStore(baseRuntime, userId, workspaceId, canRead);
  const snap = useStoreSnapshot(store);
  const runtime = baseRuntime;
  // Derived data comes from the shared selectors (`../selectors`), cached on
  // the store's row arrays: every page that shows this workspace shares them,
  // and the commands read the same through `tasksDataOf` when they run.
  // A project deleted or archived a moment ago is already out of the store's
  // bundle (the write shows on every surface at once). Archived ones and
  // their tasks ride apart (TV-U6): out of the sidebar, every list, count and
  // queue, shown under Archived projects and found by search.
  const data = tasksDataOf(snap, userId, workspaceId);
  const bundle = data.bundle;

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

  // ── Recently deleted (TV-U6) ────────────────────────────────────────────────
  // Read apart from the store, by the Tasks page only (`includeTrash`): on
  // open, and after a delete, a Restore or a Delete forever made here.
  const [trash, setTrash] = useState<TasksTrash | null>(null);
  const trashReq = useRef(0);
  const reloadTrash = useCallback(async () => {
    if (!includeTrash || !runtime || !workspaceId || !canRead) return;
    const req = ++trashReq.current;
    try {
      const next = await runtime.tasks.listTrash(workspaceId);
      if (trashReq.current === req) setTrash(next);
    } catch {
      // Keep what's on screen; the next read tries again.
    }
  }, [includeTrash, runtime, workspaceId, canRead]);
  useEffect(() => {
    if (!includeTrash || !runtime || !workspaceId || !canRead) {
      trashReq.current++;
      setTrash(null);
      return;
    }
    void reloadTrash();
  }, [includeTrash, runtime, workspaceId, canRead, reloadTrash]);

  // ── statuses (TV-D9) ─────────────────────────────────────────────────────────
  /** The statuses a project's tasks use (the Inbox: the workspace default).
   *  A read for render: its identity moves with the statuses and projects. */
  const statusesForBucket = useCallback(
    (bucketId: string): ProjectStatus[] =>
      statusesForBucketOf(data.statuses, data.allBuckets, bucketId),
    [data.statuses, data.allBuckets],
  );

  // ── subtasks (one level) and blocked-by dependencies (spec §5c) ──────────────
  /** The unblocked frontier of a task — "what's actually next" (spec §5c). */
  const frontierFor = useCallback(
    (taskId: string) => frontierOf(data.liveTasks, bundle.taskRelations, taskId),
    [data.liveTasks, bundle.taskRelations],
  );

  /** Soft, ambient per-bucket drift counts; rolls over at midnight. */
  const today = useToday();
  const driftCountByBucket = driftCountByBucketOf(data.liveTasks, today);

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
  const liveTasks = data.liveTasks;
  const openTaskCountByTag = useMemo(() => {
    const openIds = new Set(liveTasks.filter((t) => isOpenTask(t)).map((t) => t.id));
    const counts = new Map<string, number>();
    for (const link of tagView.links) {
      if (link.entityType !== "task" || !openIds.has(link.entityId)) continue;
      counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
    }
    return counts;
  }, [tagView, liveTasks]);

  // Names for the "Also in Mike's queue" note. Read without `useWorkspace` so
  // the hook still works where no workspace provider is mounted (tests).
  const members = useContext(WorkspaceContext)?.members;
  const memberName = useCallback(
    (id: string) => members?.find((m) => m.userId === id)?.displayName?.trim() || "a teammate",
    [members],
  );

  // ── intent ops (docs/moduo-module-contract.md) ──────────────────────────────
  /** Bumped after every successful op — the detail panel's trail refetch cue. */
  const [activityStamp, setActivityStamp] = useState(0);
  const bumpActivity = useCallback(() => setActivityStamp((s) => s + 1), []);

  /** Opens Recently deleted (the page sets it), for the delete toast's link. */
  const openTrashRef = useRef<(() => void) | null>(null);

  // What the commands read when they run that changes without a new store:
  // kept current after each render (never written during one).
  const env = useMemo<TaskCommandsEnv>(
    () => ({ canRead, canEdit, memberName, timeBlocks, reloadTrash }),
    [canRead, canEdit, memberName, timeBlocks, reloadTrash],
  );
  const envRef = useRef(env);
  useLayoutEffect(() => {
    envRef.current = env;
  }, [env]);

  const ctx = useMemo<TaskCommandsContext>(
    () => ({
      store,
      runtime,
      workspaceId,
      userId,
      data: () => tasksDataOf(store ? store.getSnapshot() : EMPTY_SNAPSHOT, userId, workspaceId),
      env: () => envRef.current,
      bumpActivity,
      setTrash,
      setTimeBlocks: setTimeBlocksState,
      openTrashRef,
    }),
    [store, runtime, workspaceId, userId, bumpActivity],
  );
  /** Every command, made once per store, runtime, workspace and person. */
  const commands = useMemo(() => createTaskCommands(ctx), [ctx]);

  // Saved views (TV-U8): the store's rows and their ops.
  const failed = useMemo(() => makeFailed(store), [store]);
  const viewOps = useViewOps({
    runtime,
    store,
    workspaceId: workspaceId ?? null,
    userId: userId ?? null,
    rows: snap.views,
    failed,
  });

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
    if (!allTasksOf(store.getSnapshot().bundle).some((t) => t.recurrence)) return;
    void runtime.tasks
      .opCatchUp({ workspaceId, items: [] })
      .then((saved) => {
        if (saved.length === 0) return;
        store.answer({ tasks: saved });
        bumpActivity();
      })
      .catch(() => {
        // A quiet read, never a reload: a reload asks again, and a call that
        // keeps failing (offline, a database before TV-D8's migration) would
        // loop. The next reload asks again.
        void store.syncNow();
      });
  }, [loadStamp, canEdit, runtime, workspaceId, store, bumpActivity]);

  const api = {
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
    /**
     * A read reached the server this session (not just the device copy): what
     * isn't here now is really gone (TV-U15's snoozes are forgotten only then).
     */
    reachedServer: !!store && snap.loadStamp > 0 && !snap.fromCache && !snap.offline,
    /** Live comments per task (TV-D11a; TV-D5's promised counts). */
    commentCounts: snap.commentCounts,
    /** Tasks with a capture or check-off waiting on this device (a row's clock). */
    pendingTaskIds: snap.pendingTaskIds,
    /** Per task, moves on any comment change (TV-U13): the open feed re-reads on it. */
    commentStamps: snap.commentStamps,
    /** Finished files per task (AT-3's 📎 counts, live). */
    attachmentCounts: snap.attachmentCounts,
    /** Per task, moves on any file change (AT-3): an open strip re-reads on it. */
    attachmentStamps: snap.attachmentStamps,
    /** TV-D10's structure, live from the store: areas (in sidebar order),
     *  sections, teams, members. */
    areas: data.areas,
    sections: data.sections,
    teams: bundle.teams ?? NO_ROWS,
    teamMembers: bundle.teamMembers ?? NO_ROWS,
    /** Work sessions on tasks you can see, your own reminders, Waiting on… (TV-D10). */
    sessions: snap.sessions,
    reminders: snap.reminders,
    waiting: snap.waiting,
    /** TV-U8: saved views (yours, then the ones shared with you) and their ops. */
    ...viewOps,
    /** Every completion (each cycle of a repeat): the overview's "Done this month" (TV-U16). */
    completions: snap.completions,
    /** TV-D16: agent sessions you can see (yours; teammates' while they share). */
    agentSessions: snap.agentSessions,
    restoreTask: commands.restoreTask,
    addSession: commands.addSession,
    updateSession: commands.updateSession,
    removeSession: commands.removeSession,
    addReminder: commands.addReminder,
    restoreReminders: commands.restoreReminders,
    removeReminder: commands.removeReminder,
    addWaiting: commands.addWaiting,
    removeWaiting: commands.removeWaiting,
    buckets: data.buckets,
    inbox: data.inbox,
    tasks: liveTasks,
    tags: liveTags,
    tagsByTask,
    openTaskCountByTag,
    openTaskCountByBucket: data.openTaskCountByBucket,
    taskCountByBucket: data.taskCountByBucket,
    driftCountByBucket,
    timeBlocks,
    setTimeBlock: commands.setTimeBlock,
    /** My queue's tasks in line-up order (TV-D4). */
    queuedTasks: data.queuedTasks,
    /** Tasks in my queue (open ones; a task leaves queues when done). */
    queuedTaskIds: data.queuedTaskIds,
    /** Who else has each task queued: task id → user ids (claims). */
    queueClaims: data.queueClaims,
    /** My open queued tasks — the rail's Queue count. */
    queueCount: data.queueCount,
    reload: commands.load,
    searchTasks: commands.searchTasks,
    /** Every status this reader can see (TV-D9). */
    statuses: data.statuses,
    statusById: data.statusById,
    statusesForBucket,
    setTaskStatus: commands.setTaskStatus,
    createStatus: commands.createStatus,
    updateStatus: commands.updateStatus,
    deleteStatus: commands.deleteStatus,
    createTask: commands.createTask,
    createQueuedTask: commands.createQueuedTask,
    captureToQueue: commands.captureToQueue,
    patchTask: commands.patchTask,
    /** Take a team's unclaimed task (TV-D13); `unclaimedForMe` in teams.ts lists them. */
    claimTask: commands.claimTask,
    toggleDone: commands.toggleDone,
    markDone: commands.markDone,
    archiveTask: commands.archiveTask,
    addTimeSpent: commands.addTimeSpent,
    logTimeAdjustment: commands.logTimeAdjustment,
    undoTimeAdjustment: commands.undoTimeAdjustment,
    setTimeSpent: commands.setTimeSpent,
    logTime: commands.logTime,
    editTimeEntry: commands.editTimeEntry,
    removeTimeEntry: commands.removeTimeEntry,
    listMyTimeEntries: commands.listMyTimeEntries,
    rescheduleScheduledAt: commands.rescheduleScheduledAt,
    unscheduleTask: commands.unscheduleTask,
    scheduleTaskAt: commands.scheduleTaskAt,
    toggleQueue: commands.toggleQueue,
    focusOnTask: commands.focusOnTask,
    /** What the one clock binds for a task here (Focus's Start and Done). */
    focusRefOf: commands.focusRefOf,
    addToQueue: commands.addToQueue,
    removeFromQueue: commands.removeFromQueue,
    moveQueuedToEnd: commands.moveQueuedToEnd,
    skipOccurrence: commands.skipOccurrence,
    /** "Move just this one" on a repeat (TV-D12's op, TV-U15's Upcoming). */
    moveOccurrence: commands.moveOccurrence,
    taskHistory: commands.taskHistory,
    reorderQueue: commands.reorderQueue,
    /** The whole line-up in a new order (Focus's Arrange by project, TV-F8). */
    arrangeQueue: commands.arrangeQueue,
    deleteTask: commands.deleteTask,
    loadActivity: commands.loadActivity,
    activityStamp,
    currentUserId: userId,
    subtasksByParent: data.subtasksByParent,
    subtaskProgressByTask: data.subtaskProgressByTask,
    addSubtask: commands.addSubtask,
    setTaskParent: commands.setTaskParent,
    dropTask: commands.dropTask,
    blockedTaskIds: data.blockedIds,
    taskRelations: bundle.taskRelations,
    /** SCALE-1: collections the read had to cut — the page must show these. */
    truncated: bundle.truncated,
    blockersByTask: data.blockersByTask,
    dependentsByTask: data.dependentsByTask,
    frontierFor,
    addBlocker: commands.addBlocker,
    removeBlocker: commands.removeBlocker,
    createBucket: commands.createBucket,
    renameBucket: commands.renameBucket,
    deleteBucket: commands.deleteBucket,
    setBucketGroup: commands.setBucketGroup,
    setBucketColor: commands.setBucketColor,
    moveBucketToArea: commands.moveBucketToArea,
    /** Archived projects (TV-U6), position-sorted, and their tasks. */
    archivedBuckets: data.archivedBuckets,
    archivedTasks: data.archivedTasks,
    archiveBucket: commands.archiveBucket,
    unarchiveBucket: commands.unarchiveBucket,
    setProjectState: commands.setProjectState,
    updateProjectFields: commands.updateProjectFields,
    /** The Timeline's bar: start and target, one write, an Undo (TV-TL2). */
    setProjectDates: commands.setProjectDates,
    /** The areas' ops (TV-U6 on TV-D10's ops); `areas` is above. */
    createArea: commands.createArea,
    renameArea: commands.renameArea,
    setAreaColor: commands.setAreaColor,
    moveArea: commands.moveArea,
    deleteArea: commands.deleteArea,
    /** Sections' ops (TV-D10's; the List's "+ Add section", TV-U10). */
    createSection: commands.createSection,
    renameSection: commands.renameSection,
    /** The Timeline's diamond and band: a section's dates, one write, an Undo (TV-TL2). */
    setSectionDates: commands.setSectionDates,
    deleteSection: commands.deleteSection,
    /** Recently deleted (TV-U6), when read (`includeTrash`); null otherwise. */
    trash,
    restoreFromTrash: commands.restoreFromTrash,
    deleteForever: commands.deleteForever,
    /** Set by the page: opens Recently deleted (the delete toast links there). */
    openTrashRef,
    toggleTaskTag: commands.toggleTaskTag,
    createTagForTask: commands.createTagForTask,
    setTagColor: commands.setTagColor,
    deleteTag: commands.deleteTag,
    /** A selection's change as one write with one Undo (TV-U12, `use-bulk-ops.ts`). */
    bulkWrite: commands.bulkWrite,
    bulkDelete: commands.bulkDelete,
    bulkQueue: commands.bulkQueue,
    bulkWaiting: commands.bulkWaiting,
    bulkTag: commands.bulkTag,
    INBOX_BUCKET_NAME,
  };
  return { api, store, commands, userId, workspaceId, canRead, canEdit };
}

export type TasksParams = Params;

/** The Tasks module for one workspace, without a provider: the whole `api`. */
export function useTasksModule(baseRuntime: ModuoRuntime | null, params: Params) {
  return useTasksRoot(baseRuntime, params).api;
}

export type TasksModuleApi = ReturnType<typeof useTasksModule>;
