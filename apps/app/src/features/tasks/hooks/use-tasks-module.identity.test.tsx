// The Tasks commands are made once per store, runtime, workspace and person
// (`../commands`): a store change (a write landing) moves the data the hook
// returns, never a command's identity, so memoised rows and effects that hold
// a command don't re-run on every change.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { Task, TasksModuleBundle } from "../model";

rs.mock("../../../lib/undo-toast", () => ({
  UNDO_TOAST_MS: 5000,
  undoToast: () => {},
}));

// Live updates (TV-D5) need a socket; these tests drive the hook without one.
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { useTasksModule } from "./use-tasks-module";

const BUCKET = {
  id: "b1",
  workspaceId: "w1",
  ownerId: "u1",
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
    ...over,
  };
}

function fakeRuntime(tasks: Task[]) {
  const bundle: TasksModuleBundle = {
    buckets: [BUCKET],
    tasks,
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  };
  const byId = (id: string) => tasks.find((t) => t.id === id) as Task;
  const api = {
    list: rs.fn(async () => bundle),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => []),
    updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => ({
      ...byId(taskId),
      ...patch,
    })),
    opCatchUp: rs.fn(async () => []),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api };
}

describe("command identity", () => {
  it("a write landing changes the data, not the commands", async () => {
    const fake = fakeRuntime([task("t1")]);
    const hook = renderHook(() =>
      useTasksModule(fake.runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
    );
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const before = hook.result.current;

    act(() => {
      before.patchTask("t1", { title: "Renamed" });
    });
    await waitFor(() => expect(fake.api.updateTask).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(hook.result.current.tasks.find((t) => t.id === "t1")?.title).toBe("Renamed"),
    );

    const after = hook.result.current;
    expect(after.tasks).not.toBe(before.tasks);
    expect(after.patchTask).toBe(before.patchTask);
    expect(after.setTaskStatus).toBe(before.setTaskStatus);
    expect(after.addToQueue).toBe(before.addToQueue);
    expect(after.createBucket).toBe(before.createBucket);
    expect(after.bulkWrite).toBe(before.bulkWrite);
  });

  it("a command called after a write reads the store as it is now", async () => {
    const fake = fakeRuntime([task("t1")]);
    const hook = renderHook(() =>
      useTasksModule(fake.runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
    );
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const first = hook.result.current;

    act(() => {
      first.patchTask("t1", { title: "Renamed" });
    });
    await waitFor(() =>
      expect(hook.result.current.tasks.find((t) => t.id === "t1")?.title).toBe("Renamed"),
    );
    // The same (first render's) function sees the renamed row: no stale closure.
    expect(first.focusRefOf("t1")?.title).toBe("Renamed");
  });
});
