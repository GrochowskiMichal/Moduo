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
// - `useTasksApi()`: the whole `TasksModuleApi`, for what still takes it
//   (TaskDetailPanel, the Tasks views). It re-renders on every change.
//
// With the React Compiler on, each hook returns what useSyncExternalStore
// hands it, never a read of the store beside it (docs/gotchas/ui.md, RF-1).

import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from "react";
import type { ModuoRuntime } from "../../lib/runtime.types";
import { EMPTY_SNAPSHOT, type StoreSnapshot, type WorkspaceStore } from "../../lib/sync/store";
import type { TaskCommands } from "./commands";
import { type TasksModuleApi, type TasksParams, useTasksRoot } from "./hooks/use-tasks-module";
import type { Task } from "./model";
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
      <ApiContext.Provider value={root.api}>{children}</ApiContext.Provider>
    </ScopeContext.Provider>
  );
}

function useTasksScope(): TasksScope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("Tasks hooks need a <TasksProvider> above them.");
  return scope;
}

const noSubscribe = () => () => {};

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

/** The whole Tasks api, for what still takes it; re-renders on every change. */
export function useTasksApi(): TasksModuleApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useTasksApi needs a <TasksProvider> above it.");
  return api;
}
