// The Tasks module for a page, through React context (A4). `TasksProvider`
// builds the Tasks root (`useTasksRoot`: the store, the commands, the stateful
// bits) once for the page, and the components under it read only what they
// show:
//
// - `useTaskCommands()`: every command, one stable object per store, runtime,
//   workspace and person. A data change never gives it a new identity, so a
//   component that only writes never re-renders on one.
// - `useTasksSelector(select)`: a slice of the Tasks data (`tasksDataOf` the
//   store's snapshot; the snapshot itself is the second argument). The
//   component re-renders only when the slice's identity moves. The derivations
//   are cached, so `d.inbox`, `d.liveTasks`, `snap.sessions` are stable
//   between unrelated writes; a selector must never build a new object or
//   array itself (useSyncExternalStore would loop).
// - `useTaskById(id)`: one task, from the cached by-id map.
// - `useSubtasksOf(id)`: a task's subtasks (the panel, the Focus card).
// - `useTasksStatus()`: loading, error and access.
// - `useTasksUserId()`, `useTasksActivityStamp()`, `useTaskTags(id)`: who
//   reads, the trail's refetch cue, and a task's tags (the tag store's).
// - `useTasksReader()`: the data as it is when a handler runs (a drop's
//   neighbours), without subscribing the component to it.
// - `useTaskTagIndex()`, `useDriftCountByBucket()`, `useStatusesForBucket()`,
//   `useStatusCategoryOf()`,
//   `useFrontierFor()`: derived reads the Tasks views share (each cached).
// - `useTasksTrash()`, `useOpenTrashRef()`, `useSavedViewOps()`: the page's
//   stateful pieces (Recently deleted, its link, saved views).
// - `TaskCommandsOverride`: a host's own take on a few commands for what is
//   under it (the Tasks page guards Focus with the blocked-by offer).
// - `useLandingLag()`, `TasksHeld`, `TasksLagged`: a page's secondary parts
//   (the rail, the right panel) draw the landing of the data one frame after
//   the centre's rows (TS-R1).
//
// With the React Compiler on, each hook returns what useSyncExternalStore
// hands it, never a read of the store beside it (docs/gotchas/ui.md, RF-1).

import {
  createContext,
  type MutableRefObject,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { afterPaint } from "../../lib/after-paint";
import type { ModuoRuntime } from "../../lib/runtime.types";
import { EMPTY_SNAPSHOT, type StoreSnapshot, type WorkspaceStore } from "../../lib/sync/store";
import { entityKey, useTagView } from "../tags/store";
import type { TaskCommands } from "./commands";
import {
  byIdOf,
  driftCountByBucketOf,
  frontierOf,
  openTaskCountByTagOf,
  statusesForBucketOf,
  type TasksData,
  tagsByTaskOf,
  tasksDataOf,
} from "./derived";
import { type TasksParams, useTasksRoot } from "./hooks/use-tasks-module";
import type { ViewOps } from "./hooks/use-view-ops";
import type { ProjectStatus, Tag, Task, TasksTrash } from "./model";
import type { StatusCategoryOf } from "./statuses";
import { useToday } from "./use-today";

/** What never changes with the data: the narrow hooks read the store through it. */
type TasksScope = {
  store: WorkspaceStore | null;
  commands: TaskCommands;
  userId: string | null;
  workspaceId: string | null;
  canRead: boolean;
  canEdit: boolean;
};

const ScopeContext = createContext<TasksScope | null>(null);
/** Recently deleted (when the page reads it) and the page's way there. */
type TrashScope = {
  trash: TasksTrash | null;
  openTrashRef: MutableRefObject<(() => void) | null>;
};
const TrashContext = createContext<TrashScope | null>(null);
const ViewOpsContext = createContext<ViewOps | null>(null);
/** Bumped after every op that saved: the detail panel's trail re-reads on it. */
const ActivityContext = createContext(0);
/** A snapshot the subtree reads instead of the store's live one (`TasksLagged`). */
const LaggedContext = createContext<StoreSnapshot | null>(null);

type ProviderProps = {
  runtime: ModuoRuntime | null;
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: TasksParams["modulePermission"];
  /** Also read Recently deleted (TV-U6): the Tasks page only. */
  includeTrash?: boolean;
  children: ReactNode;
};

export function TasksProvider({
  runtime,
  userId,
  workspaceId,
  modulePermission,
  includeTrash,
  children,
}: ProviderProps) {
  const root = useTasksRoot(runtime, { userId, workspaceId, modulePermission, includeTrash });
  const { store, commands, canRead, canEdit } = root;
  const scope = useMemo<TasksScope>(
    () => ({ store, commands, userId, workspaceId, canRead, canEdit }),
    [store, commands, userId, workspaceId, canRead, canEdit],
  );
  const { trash, openTrashRef } = root;
  const trashScope = useMemo<TrashScope>(() => ({ trash, openTrashRef }), [trash, openTrashRef]);
  const {
    views,
    saveView,
    saveViewChanges,
    renameView,
    shareView,
    deleteView,
    moveView,
    seedViews,
  } = root.viewOps;
  const viewOps = useMemo<ViewOps>(
    () => ({
      views,
      saveView,
      saveViewChanges,
      renameView,
      shareView,
      deleteView,
      moveView,
      seedViews,
    }),
    [views, saveView, saveViewChanges, renameView, shareView, deleteView, moveView, seedViews],
  );
  return (
    <ScopeContext.Provider value={scope}>
      <ActivityContext.Provider value={root.activityStamp}>
        <TrashContext.Provider value={trashScope}>
          <ViewOpsContext.Provider value={viewOps}>{children}</ViewOpsContext.Provider>
        </TrashContext.Provider>
      </ActivityContext.Provider>
    </ScopeContext.Provider>
  );
}

function useTasksScope(): TasksScope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("Tasks hooks need a <TasksProvider> above them.");
  return scope;
}

const noSubscribe = () => () => {};

/**
 * A host's own version of some commands for everything under it, as the Tasks
 * page's queue toggle opens the blocked-by offer first. Pass a stable object:
 * a new one gives every command reader below a new `useTaskCommands()`.
 */
export function TaskCommandsOverride({
  commands,
  children,
}: {
  commands: Partial<TaskCommands>;
  children: ReactNode;
}) {
  const scope = useTasksScope();
  const value = useMemo<TasksScope>(
    () => ({ ...scope, commands: { ...scope.commands, ...commands } }),
    [scope, commands],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

/** Every Tasks command; the identity holds across data changes. */
export function useTaskCommands(): TaskCommands {
  return useTasksScope().commands;
}

/**
 * A slice of the Tasks data, re-rendering only when its identity moves.
 * Return a cached value (a field of `data` or `snap`, a row from them), never
 * a new object or array.
 */
export function useTasksSelector<T>(select: (data: TasksData, snap: StoreSnapshot) => T): T {
  const { store, userId, workspaceId } = useTasksScope();
  const lagged = useContext(LaggedContext);
  const read = () => {
    const snap = lagged ?? (store ? store.getSnapshot() : EMPTY_SNAPSHOT);
    return select(tasksDataOf(snap, userId, workspaceId), snap);
  };
  // Under `TasksLagged` the snapshot comes down through context: no subscription.
  return useSyncExternalStore(store && !lagged ? store.subscribe : noSubscribe, read, read);
}

const snapshotOf = (_: TasksData, snap: StoreSnapshot) => snap;

/**
 * Draw a page's secondary parts (the rail, the panel) one frame after the
 * data lands (TS-R1). Wrap each in `TasksHeld hold={hold}` around
 * `TasksLagged snapshot={snapshot}`. Until the data has landed they read the
 * page's snapshot through context (no subscription of their own); in the
 * render where the device copy or the first read lands, `hold` keeps their
 * last output, so the centre's rows paint alone; right after that frame they
 * draw, and from then on read the store live (`snapshot` null), so they never
 * trail an edit, a selection or a switch.
 */
export function useLandingLag(): { snapshot: StoreSnapshot | null; hold: boolean } {
  const live = useTasksSelector(snapshotOf);
  const [landed, setLanded] = useState(false);
  const hold = live.loaded && !landed;
  useEffect(() => {
    if (hold) return afterPaint(() => setLanded(true));
  }, [hold]);
  return { snapshot: landed ? null : live, hold };
}

/** Its subtree reads the Tasks data from `snapshot` (from `useLandingLag`). */
export function TasksLagged({
  snapshot,
  children,
}: {
  snapshot: StoreSnapshot | null;
  children: ReactNode;
}) {
  return <LaggedContext.Provider value={snapshot}>{children}</LaggedContext.Provider>;
}

/** Keeps its last output while `hold` (see `useLandingLag`). */
export const TasksHeld = memo(
  function TasksHeld({ children }: { hold: boolean; children: ReactNode }) {
    return children;
  },
  (_, next) => next.hold,
);

/**
 * One live task (as `api.tasks.find` finds it: not deleted, not in an
 * archived project), or null. A lookup in the cached by-id map: a live query
 * by id would need every task mirrored into a collection first (TS-3b).
 */
export function useTaskById(id: string | null | undefined): Task | null {
  return useTasksSelector((d) => (id ? (byIdOf(d.liveTasks).get(id) ?? null) : null));
}

/**
 * A task's live, non-archived subtasks in position order, from the cached
 * per-parent map. TS-3b built this as a narrow live query
 * (`lib/sync/tanstack/tasks-live.ts`) but doesn't wire it: TanStack DB's
 * query engine and `react-db` add ~59 KB gzip to the first load, past AC9's
 * cap, for a lookup that is already O(1) here.
 */
export function useSubtasksOf(taskId: string): Task[] {
  return useTasksSelector((d) => d.subtasksByParent.get(taskId) ?? NO_SUBTASKS);
}

export type TasksStatus = {
  /** Before the first answer: show a skeleton, never "empty" (TV-P0). */
  loading: boolean;
  loaded: boolean;
  error: string | null;
  canRead: boolean;
  canEdit: boolean;
  /** Reading the device copy; captures and check-offs wait (TV-D11a). */
  offline: boolean;
  /** Done, Won't do and Backlog tasks have arrived (they load after the open ones). */
  restLoaded: boolean;
  /**
   * A read reached the server this session (not just the device copy): what
   * isn't here now is really gone (TV-U15's snoozes are forgotten only then).
   */
  reachedServer: boolean;
};

/** Loading, error and access, re-rendering only when one of them changes. */
export function useTasksStatus(): TasksStatus {
  const { store, canRead, canEdit } = useTasksScope();
  const loaded = useTasksSelector((_, snap) => !!store && snap.loaded);
  const error = useTasksSelector((_, snap) => (store ? snap.error : null));
  const offline = useTasksSelector((_, snap) => !!store && snap.offline);
  const restLoaded = useTasksSelector((_, snap) => !!store && snap.restLoaded);
  const reachedServer = useTasksSelector(
    (_, snap) => !!store && snap.loadStamp > 0 && !snap.fromCache && !snap.offline,
  );
  return {
    loading: !!store && !loaded,
    loaded,
    error,
    canRead,
    canEdit,
    offline,
    restLoaded,
    reachedServer,
  };
}

/** Who reads the Tasks data (null before sign-in). */
export function useTasksUserId(): string | null {
  return useTasksScope().userId;
}

/** Moves after every op that saved (the detail panel's trail re-reads on it). */
export function useTasksActivityStamp(): number {
  return useContext(ActivityContext);
}

const NO_TAGS: Tag[] = [];
const NO_SUBTASKS: Task[] = [];

/**
 * The workspace's live tags and one task's (name-sorted), from the shared tag
 * store: re-renders on a tag change, never on a task's.
 */
export function useTaskTags(taskId: string): { tags: Tag[]; taskTags: Tag[] } {
  const { workspaceId, canRead } = useTasksScope();
  const view = useTagView(canRead ? workspaceId : null);
  return { tags: view.tags, taskTags: view.byEntity.get(entityKey("task", taskId)) ?? NO_TAGS };
}

/**
 * The Tasks data as it is now, for a handler (a drop reads its neighbours):
 * the component doesn't re-render when it changes.
 */
export function useTasksReader(): () => TasksData {
  const { store, userId, workspaceId } = useTasksScope();
  return useCallback(
    () => tasksDataOf(store ? store.getSnapshot() : EMPTY_SNAPSHOT, userId, workspaceId),
    [store, userId, workspaceId],
  );
}

export type TaskTagIndex = {
  /** Live workspace tags, name-sorted. */
  tags: Tag[];
  /** Tags attached to each task, name-sorted. */
  tagsByTask: Map<string, Tag[]>;
  /** Open-task count per tag (the filter menu's counts). */
  openTaskCountByTag: Map<string, number>;
};

/** The workspace's tags by task, from the shared tag store; each map is cached. */
export function useTaskTagIndex(): TaskTagIndex {
  const { workspaceId, canRead } = useTasksScope();
  const view = useTagView(canRead ? workspaceId : null);
  const liveTasks = useTasksSelector((d) => d.liveTasks);
  return {
    tags: view.tags,
    tagsByTask: tagsByTaskOf(view.byEntity),
    openTaskCountByTag: openTaskCountByTagOf(view.links, liveTasks),
  };
}

/** Soft, ambient per-project drift counts; rolls over at midnight. */
export function useDriftCountByBucket(): Map<string, number> {
  const today = useToday();
  const liveTasks = useTasksSelector((d) => d.liveTasks);
  return driftCountByBucketOf(liveTasks, today);
}

/**
 * The statuses a project's tasks use (the Inbox: the workspace default). A
 * read for render: its identity moves with the statuses and projects.
 */
export function useStatusesForBucket(): (bucketId: string) => ProjectStatus[] {
  const statuses = useTasksSelector((d) => d.statuses);
  const allBuckets = useTasksSelector((d) => d.allBuckets);
  return useCallback(
    (bucketId: string) => statusesForBucketOf(statuses, allBuckets, bucketId),
    [statuses, allBuckets],
  );
}

/** A status's category by id (Filter → Status's project statuses, MOD-240). */
export function useStatusCategoryOf(): StatusCategoryOf {
  const statusById = useTasksSelector((d) => d.statusById);
  return useCallback((id: string) => statusById.get(id)?.category, [statusById]);
}

/**
 * The unblocked frontier of a task: "what's actually next" (spec §5c). A read
 * for render: its identity moves with the tasks and their blockers.
 */
export function useFrontierFor(): (taskId: string) => Task[] {
  const liveTasks = useTasksSelector((d) => d.liveTasks);
  const relations = useTasksSelector((d) => d.bundle.taskRelations);
  return useCallback(
    (taskId: string) => frontierOf(liveTasks, relations, taskId),
    [liveTasks, relations],
  );
}

function useTrashScope(): TrashScope {
  const scope = useContext(TrashContext);
  if (!scope) throw new Error("Tasks hooks need a <TasksProvider> above them.");
  return scope;
}

/** Recently deleted (TV-U6), when the provider reads it (`includeTrash`); null otherwise. */
export function useTasksTrash(): TasksTrash | null {
  return useTrashScope().trash;
}

/** The page sets it: opens Recently deleted (the delete toast links there). */
export function useOpenTrashRef(): MutableRefObject<(() => void) | null> {
  return useTrashScope().openTrashRef;
}

/** Saved views (TV-U8): yours, then the ones shared with you, and their ops. */
export function useSavedViewOps(): ViewOps {
  const ops = useContext(ViewOpsContext);
  if (!ops) throw new Error("Tasks hooks need a <TasksProvider> above them.");
  return ops;
}
