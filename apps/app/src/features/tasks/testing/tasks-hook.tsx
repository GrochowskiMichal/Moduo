// Hook tests through the Tasks context (A4): a real `<TasksProvider>` over the
// test's own runtime, and a probe that reads the slices those tests assert on
// through the narrow hooks. Commands sit apart under `commands`.
//
//   const hook = renderTasksHook(runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" });
//   await waitFor(() => expect(hook.result.current.loading).toBe(false));
//   act(() => { hook.result.current.commands.patchTask("t1", { title: "New" }); });
//   expect(hook.result.current.tasks[0].title).toBe("New");
//
// No test framework here beyond Testing Library's `renderHook`.

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { TasksParams } from "../hooks/use-tasks-module";
import {
  TasksProvider,
  useStatusesForBucket,
  useTaskCommands,
  useTasksSelector,
  useTasksStatus,
  useTasksTrash,
  useTaskTagIndex,
} from "../tasks-context";

/** The commands, and the data slices the hook tests read. */
export function useTasksProbe() {
  const commands = useTaskCommands();
  const { loading, loaded, error, canEdit, offline, restLoaded, reachedServer } = useTasksStatus();
  const tasks = useTasksSelector((d) => d.liveTasks);
  const buckets = useTasksSelector((d) => d.buckets);
  const inbox = useTasksSelector((d) => d.inbox);
  const areas = useTasksSelector((d) => d.areas);
  const archivedBuckets = useTasksSelector((d) => d.archivedBuckets);
  const archivedTasks = useTasksSelector((d) => d.archivedTasks);
  const queuedTasks = useTasksSelector((d) => d.queuedTasks);
  const queuedTaskIds = useTasksSelector((d) => d.queuedTaskIds);
  const queueClaims = useTasksSelector((d) => d.queueClaims);
  const queueCount = useTasksSelector((d) => d.queueCount);
  const openTaskCountByBucket = useTasksSelector((d) => d.openTaskCountByBucket);
  const subtasksByParent = useTasksSelector((d) => d.subtasksByParent);
  const waiting = useTasksSelector((_, snap) => snap.waiting);
  const sessions = useTasksSelector((_, snap) => snap.sessions);
  const reminders = useTasksSelector((_, snap) => snap.reminders);
  const { tags, tagsByTask } = useTaskTagIndex();
  const statusesForBucket = useStatusesForBucket();
  const trash = useTasksTrash();
  return {
    commands,
    loading,
    loaded,
    error,
    canEdit,
    offline,
    restLoaded,
    reachedServer,
    tasks,
    buckets,
    inbox,
    areas,
    archivedBuckets,
    archivedTasks,
    queuedTasks,
    queuedTaskIds,
    queueClaims,
    queueCount,
    openTaskCountByBucket,
    subtasksByParent,
    waiting,
    sessions,
    reminders,
    tags,
    tagsByTask,
    statusesForBucket,
    trash,
  };
}

export type TasksProbe = ReturnType<typeof useTasksProbe>;

/** A `renderHook` wrapper: the provider on `runtime`, inside `Outer` when given. */
export function tasksWrapper(
  runtime: ModuoRuntime | null,
  params: TasksParams,
  Outer?: (props: { children: ReactNode }) => ReactNode,
) {
  return function TasksWrapper({ children }: { children: ReactNode }) {
    const tree = (
      <TasksProvider
        runtime={runtime}
        userId={params.userId}
        workspaceId={params.workspaceId}
        modulePermission={params.modulePermission}
        includeTrash={params.includeTrash}
      >
        {children}
      </TasksProvider>
    );
    return Outer ? <Outer>{tree}</Outer> : tree;
  };
}

/** `renderHook` of the probe under a provider on `runtime`. */
export function renderTasksHook(
  runtime: ModuoRuntime | null,
  params: TasksParams,
  Outer?: (props: { children: ReactNode }) => ReactNode,
) {
  return renderHook(() => useTasksProbe(), { wrapper: tasksWrapper(runtime, params, Outer) });
}
