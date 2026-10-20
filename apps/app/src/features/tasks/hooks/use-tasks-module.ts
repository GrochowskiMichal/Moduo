// The Tasks module's root, held by `TasksProvider`. Reads the workspace's shared store (TV-D11a,
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
import { WorkspaceContext } from "../../workspaces/workspace-context";
import {
  createTaskCommands,
  makeFailed,
  type TaskCommandsContext,
  type TaskCommandsEnv,
} from "../commands";
import type { TasksTrash, TimeBlockMap } from "../model";
import { allTasksOf, tasksDataOf } from "../selectors";
import { useViewOps } from "./use-view-ops";

export type { ArchiveOpenTasks, TimeAdjustment, TrashTarget } from "../commands";

type Params = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
  /** Also read Recently deleted (TV-U6): the Tasks page only. */
  includeTrash?: boolean;
};

/**
 * Everything the Tasks module builds for one workspace: the store, the stable
 * commands and the stateful pieces (the trash read, saved views' ops, the
 * activity stamp). `TasksProvider` (`../tasks-context.tsx`) holds it for a
 * page; components read it through the provider's narrow hooks.
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
  // the store's row arrays; the narrow hooks (`../tasks-context.tsx`) and the
  // commands read them, never this root.

  const [timeBlocks, setTimeBlocksState] = useState<TimeBlockMap>({});

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

  return {
    store,
    commands,
    userId,
    workspaceId,
    canRead,
    canEdit,
    /** Bumped after every op that saved: the detail panel's trail re-reads on it. */
    activityStamp,
    /** Recently deleted (TV-U6), when read (`includeTrash`); null otherwise. */
    trash,
    /** Set by the page: opens Recently deleted (the delete toast links there). */
    openTrashRef,
    /** TV-U8: saved views (yours, then the ones shared with you) and their ops. */
    viewOps,
  };
}

export type TasksParams = Params;
