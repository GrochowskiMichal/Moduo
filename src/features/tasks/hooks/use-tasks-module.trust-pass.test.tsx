// TV-P0 (tasks-v3 AC1.8, AC1.12): moving a parent takes its subtasks along,
// and a scheduled time set on its own goes through the reschedule op, so it is
// in the trail; a date edit is one write.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { Bucket, Task, TasksModuleBundle } from "../model";

// Live updates (TV-D5) need a socket; these tests drive the hook without one.
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { useTasksModule } from "./use-tasks-module";

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w1",
  ownerId: "u1",
  name: id,
  isSystem: false,
  group: null,
  position: id,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "inbox", title: id, position: id }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
    ...over,
  };
}

function fakeRuntime(tasks: Task[]) {
  const bundle: TasksModuleBundle = {
    buckets: [bucket("inbox", { isSystem: true, name: "Inbox" }), bucket("p1"), bucket("p2")],
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
    // The server's edit op (TV-D8): a move carries the live subtasks the
    // mover can edit along (here, any not named "locked…").
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
      const moved = patch.bucketId
        ? tasks.filter(
            (t) =>
              t.parentId === taskId &&
              !t.deletedAt &&
              t.bucketId !== patch.bucketId &&
              !t.id.startsWith("locked"),
          )
        : [];
      return [
        { ...byId(taskId), ...patch, updatedAt: "2026-10-10T12:00:00.000Z" },
        ...moved.map((t) => ({
          ...t,
          bucketId: patch.bucketId as string,
          updatedAt: "2026-10-10T12:00:00.000Z",
        })),
      ];
    }),
    opReschedule: rs.fn(
      async ({ taskId, scheduledAt }: { taskId: string; scheduledAt: string }) => ({
        ...byId(taskId),
        scheduledAt,
      }),
    ),
    opUnschedule: rs.fn(async ({ taskId }: { taskId: string }) => ({
      ...byId(taskId),
      scheduledAt: null,
    })),
    opCatchUp: rs.fn(async () => []),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api };
}

async function mount(tasks: Task[]) {
  const fake = fakeRuntime(tasks);
  const hook = renderHook(() =>
    useTasksModule(fake.runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

const bucketOf = (hook: { result: { current: { tasks: Task[] } } }, id: string) =>
  hook.result.current.tasks.find((t) => t.id === id)?.bucketId;

describe("moving a parent moves its subtasks (AC1.8)", () => {
  it("every open or done subtask goes to the parent's new project", async () => {
    const { api, hook } = await mount([
      task("parent", { bucketId: "p1" }),
      task("child-a", { bucketId: "p1", parentId: "parent" }),
      task("child-b", { bucketId: "p1", parentId: "parent", status: "done" }),
      task("other", { bucketId: "p1" }),
    ]);
    act(() => hook.result.current.patchTask("parent", { bucketId: "p2" }));
    // Shown at once…
    expect(bucketOf(hook, "child-a")).toBe("p2");
    expect(bucketOf(hook, "child-b")).toBe("p2");
    expect(bucketOf(hook, "other")).toBe("p1");
    // …and saved in one op (TV-D8), which moves the subtasks on the server.
    await waitFor(() => expect(api.opUpdateTask).toHaveBeenCalledTimes(1));
    expect(api.opUpdateTask).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "parent",
      patch: { bucketId: "p2" },
    });
    expect(api.updateTask).not.toHaveBeenCalled();
    // Every row ends on the server's answer.
    await waitFor(() =>
      expect(hook.result.current.tasks.find((t) => t.id === "child-a")?.updatedAt).toBe(
        "2026-10-10T12:00:00.000Z",
      ),
    );
    expect(bucketOf(hook, "child-b")).toBe("p2");
  });

  it("a subtask already in the new project isn't written again", async () => {
    const { api, hook } = await mount([
      task("parent", { bucketId: "p1" }),
      task("child", { bucketId: "p2", parentId: "parent" }),
    ]);
    act(() => hook.result.current.patchTask("parent", { bucketId: "p2" }));
    await waitFor(() => expect(api.opUpdateTask).toHaveBeenCalledTimes(1));
    expect(api.opUpdateTask.mock.calls[0][0].taskId).toBe("parent");
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("a subtask the server leaves behind (not yours to edit) goes back to its project", async () => {
    const { api, hook } = await mount([
      task("parent", { bucketId: "p1" }),
      task("child", { bucketId: "p1", parentId: "parent" }),
      task("locked-child", { bucketId: "p1", parentId: "parent" }),
    ]);
    act(() => hook.result.current.patchTask("parent", { bucketId: "p2" }));
    expect(bucketOf(hook, "locked-child")).toBe("p2");
    await waitFor(() => expect(api.opUpdateTask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bucketOf(hook, "locked-child")).toBe("p1"));
    expect(bucketOf(hook, "child")).toBe("p2");
    expect(bucketOf(hook, "parent")).toBe("p2");
  });

  it("editing anything else touches only the task", async () => {
    const { api, hook } = await mount([
      task("parent", { bucketId: "p1" }),
      task("child", { bucketId: "p1", parentId: "parent" }),
    ]);
    act(() => hook.result.current.patchTask("parent", { title: "Renamed" }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    expect(api.updateTask.mock.calls[0][0].taskId).toBe("parent");
  });
});

describe("scheduling is in the trail (AC1.12)", () => {
  it("setting a scheduled time goes through the reschedule op, once", async () => {
    const { api, hook } = await mount([task("t1")]);
    const at = new Date(2026, 9, 12, 15, 0).toISOString();
    act(() => hook.result.current.patchTask("t1", { scheduledAt: at }));
    await waitFor(() => expect(api.opReschedule).toHaveBeenCalledTimes(1));
    expect(api.opReschedule).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "t1",
      scheduledAt: at,
    });
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("clearing it goes through unschedule; setting the same time writes nothing", async () => {
    const at = new Date(2026, 9, 12, 15, 0).toISOString();
    const { api, hook } = await mount([task("t1", { scheduledAt: at })]);
    act(() => hook.result.current.patchTask("t1", { scheduledAt: at }));
    expect(api.opReschedule).not.toHaveBeenCalled();
    act(() => hook.result.current.patchTask("t1", { scheduledAt: null }));
    await waitFor(() => expect(api.opUnschedule).toHaveBeenCalledTimes(1));
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("a due date stays a single field write", async () => {
    const { api, hook } = await mount([task("t1")]);
    const due = new Date(2026, 9, 16).toISOString();
    act(() => hook.result.current.patchTask("t1", { dueDate: due }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    expect(api.updateTask.mock.calls[0][0].patch).toEqual({ dueDate: due });
  });
});
