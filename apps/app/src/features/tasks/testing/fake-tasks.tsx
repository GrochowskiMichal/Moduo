// A real Tasks context over a fake runtime, for tests and stories (A4). The
// components under `<TasksProvider>` read the shared store through the narrow
// hooks, so a test gives them a store instead of a stub api: `fakeTasksRuntime`
// answers the store's reads from a seed (each synced table's rows), and
// `FakeTasksProvider` mounts the provider on it, with any commands swapped for
// the test's own (spies, a story's canned answers).
//
// No test framework here: stories import it too. `renderWithTasks`
// (`./render-with-tasks.tsx`) is the tests' way in.

import type { ReactNode } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { memoryCache } from "../../../lib/sync/cache";
import { setStoreOptionsForTests } from "../../../lib/sync/store";
import type { SyncReadInput, SyncRows, SyncTableName } from "../../../lib/sync/types";
import type { TaskCommands } from "../commands";
import type { TagLink, Task, TaskQueueEntry, TaskRelation } from "../model";
import { TaskCommandsOverride, TasksProvider } from "../tasks-context";

/** Each synced table's rows, as the server would answer them (absent: none). */
export type FakeTasksSeed = { [T in SyncTableName]?: SyncRows[T][] };

/** Runtime parts besides the Tasks reads (spine, attachments), and Tasks calls to replace. */
export type FakeRuntimeExtras = {
  tasks?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FakeTasksRuntime = {
  runtime: ModuoRuntime;
  /** The fake `runtime.tasks`: replace a call on it to spy on what reaches the server. */
  tasks: Record<string, (...args: never[]) => unknown>;
};

/**
 * A runtime whose Tasks reads answer from `seed` and whose writes echo the
 * patched row back. `extras` adds the rest a component needs (`spine`,
 * `attachments`) and may replace any `tasks` call.
 */
export function fakeTasksRuntime(
  seed: FakeTasksSeed = {},
  extras: FakeRuntimeExtras = {},
): FakeTasksRuntime {
  // Stores made from here on keep their copy in memory and open no socket.
  setStoreOptionsForTests({ cache: memoryCache(), listen: () => () => {} });
  const rows = <T extends SyncTableName>(table: T): SyncRows[T][] => seed[table] ?? [];
  const taskById = (id: string) => rows("tasks").find((t) => t.id === id) as Task;
  const patched = ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => ({
    ...taskById(taskId),
    ...patch,
  });
  const tasks: FakeTasksRuntime["tasks"] = {
    syncRead: async ({ table, part }: SyncReadInput) => ({
      // The first load reads open tasks, then "the rest": all of them come first.
      rows: table === "tasks" && part === "rest" ? [] : rows(table),
      deleted: [],
      maxUpdatedAt: null,
      truncated: null,
    }),
    listQueue: async () => rows("queue"),
    getTimeBlocks: async () => ({}),
    opCatchUp: async () => [],
    listActivity: async () => [],
    listMyTimeEntries: async () => [],
    listTimeTotals: async () => [],
    taskHistory: async () => [],
    updateTask: async (input: { taskId: string; patch: Partial<Task> }) => patched(input),
    opUpdateTask: async (input: { taskId: string; patch: Partial<Task> }) => [patched(input)],
    opAssign: async ({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) => ({
      ...taskById(taskId),
      assigneeId,
    }),
    ...(extras.tasks as FakeTasksRuntime["tasks"] | undefined),
  };
  const runtime = { ...extras, tasks } as unknown as ModuoRuntime;
  return { runtime, tasks };
}

type ProviderProps = {
  runtime: ModuoRuntime;
  userId?: string;
  workspaceId?: string;
  /** Tasks access (default edit). */
  permission?: "none" | "view" | "edit" | "admin";
  /**
   * Commands to use instead of the store's (spies, canned answers). Pass one
   * object for the life of the tree: a new one re-renders every reader.
   */
  commands?: Partial<TaskCommands>;
  children: ReactNode;
};

/** `<TasksProvider>` on a fake runtime, with the test's commands on top. */
export function FakeTasksProvider({
  runtime,
  userId = "u1",
  workspaceId = "w1",
  permission = "edit",
  commands,
  children,
}: ProviderProps) {
  return (
    <TasksProvider
      runtime={runtime}
      userId={userId}
      workspaceId={workspaceId}
      modulePermission={permission}
    >
      {commands ? (
        <TaskCommandsOverride commands={commands}>{children}</TaskCommandsOverride>
      ) : (
        children
      )}
    </TasksProvider>
  );
}

// ── rows ─────────────────────────────────────────────────────────────────────

/** A line-up row: `userId` has `taskId` in their Focus (mine, or a claim). */
export function queueEntry(
  taskId: string,
  userId: string,
  over: Partial<TaskQueueEntry> = {},
): TaskQueueEntry {
  return {
    id: `q-${userId}-${taskId}`,
    workspaceId: "w1",
    userId,
    taskId,
    position: "a",
    queuedAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...over,
  };
}

/** `blocker` blocks `blocked`. */
export function relation(
  blockerTaskId: string,
  blockedTaskId: string,
  workspaceId = "w1",
): TaskRelation {
  return {
    id: `rel-${blockerTaskId}-${blockedTaskId}`,
    workspaceId,
    blockerTaskId,
    blockedTaskId,
    createdAt: "2026-10-01T09:00:00Z",
  };
}

/** `tagId` on task `taskId`. */
export function tagLink(tagId: string, taskId: string, workspaceId = "w1"): TagLink {
  return {
    id: `tl-${tagId}-${taskId}`,
    workspaceId,
    tagId,
    entityType: "task",
    entityId: taskId,
    createdAt: "2026-10-01T09:00:00Z",
  };
}
