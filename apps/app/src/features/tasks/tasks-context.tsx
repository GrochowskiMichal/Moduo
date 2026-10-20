// The Tasks module for a page, through React context (A4). `TasksProvider`
// builds what `useTasksModule` builds (the store, the commands, the stateful
// bits) once for the page, and the components under it read only what they
// show:
//
// - `useTaskCommands()`: every command, one stable object per store, runtime,
//   workspace and person. A data change never gives it a new identity, so a
//   component that only writes never re-renders on one.
// - `useTasksSelector(select)`: a slice of the Tasks data (`tasksDataOf` the
//   store's snapshot; the snapshot itself is the second argument). The
//   component re-renders only when the slice's identity moves. The selectors
//   are cached, so `d.inbox`, `d.liveTasks`, `snap.sessions` are stable
//   between unrelated writes; a selector must never build a new object or
//   array itself (useSyncExternalStore would loop).
// - `useTaskById(id)`, `useTasksStatus()`: the two conveniences most surfaces need.
// - `useTasksUserId()`, `useTasksActivityStamp()`, `useTaskTags(id)`: who
//   reads, the trail's refetch cue, and a task's tags (the tag store's).
// - `useTasksReader()`: the data as it is when a handler runs (a drop's
//   neighbours), without subscribing the component to it.
// - `TaskCommandsOverride`: a host's own take on a few commands for what is
//   under it (the Tasks page guards Focus with the blocked-by offer).
// - `useTasksApi()`: the whole `TasksModuleApi`, for what still takes it
//   (the Tasks views). It re-renders on every change.
//
// With the React Compiler on, each hook returns what useSyncExternalStore
// hands it, never a read of the store beside it (docs/gotchas/ui.md, RF-1).

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ModuoRuntime } from "../../lib/runtime.types";
import { EMPTY_SNAPSHOT, type StoreSnapshot, type WorkspaceStore } from "../../lib/sync/store";
import { entityKey, useTagView } from "../tags/store";
import type { TaskCommands } from "./commands";
import { type TasksModuleApi, type TasksParams, useTasksRoot } from "./hooks/use-tasks-module";
import type { Tag, Task } from "./model";
import { byIdOf, type TasksData, tasksDataOf } from "./selectors";

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
const ApiContext = createContext<TasksModuleApi | null>(null);
/** Bumped after every op that saved: the detail panel's trail re-reads on it. */
const ActivityContext = createContext(0);

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
  return (
    <ScopeContext.Provider value={scope}>
      <ActivityContext.Provider value={root.api.activityStamp}>
        <ApiContext.Provider value={root.api}>{children}</ApiContext.Provider>
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
  const read = () => {
    const snap = store ? store.getSnapshot() : EMPTY_SNAPSHOT;
    return select(tasksDataOf(snap, userId, workspaceId), snap);
  };
  return useSyncExternalStore(store ? store.subscribe : noSubscribe, read, read);
}

/** One live task (as `api.tasks.find` finds it: not deleted, not in an archived project), or null. */
export function useTaskById(id: string | null | undefined): Task | null {
  return useTasksSelector((d) => (id ? (byIdOf(d.liveTasks).get(id) ?? null) : null));
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
};

/** Loading, error and access, re-rendering only when one of them changes. */
export function useTasksStatus(): TasksStatus {
  const { store, canRead, canEdit } = useTasksScope();
  const loaded = useTasksSelector((_, snap) => !!store && snap.loaded);
  const error = useTasksSelector((_, snap) => (store ? snap.error : null));
  const offline = useTasksSelector((_, snap) => !!store && snap.offline);
  return { loading: !!store && !loaded, loaded, error, canRead, canEdit, offline };
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

/** The whole Tasks api, for what still takes it; re-renders on every change. */
export function useTasksApi(): TasksModuleApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useTasksApi needs a <TasksProvider> above it.");
  return api;
}
