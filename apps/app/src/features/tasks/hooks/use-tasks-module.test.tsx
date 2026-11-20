// TV-D1: the Tasks hook saves edits field by field (D1-1), assigns through
// tasks_op_assign (D1-2), and its Undo restores only what it changed.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { Task, TasksModuleBundle } from "../model";

const undo = rs.hoisted(() => ({ last: null as null | (() => void) }));
rs.mock("../../../lib/undo-toast", () => ({
  UNDO_TOAST_MS: 5000,
  undoToast: (_label: string, opts: { onUndo: () => void }) => {
    undo.last = opts.onUndo;
  },
}));

// Live updates (TV-D5) need a socket; these tests drive the hook without one.
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { renderTasksHook } from "../testing/tasks-hook";

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
    assigneeId: "u2",
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
    opAssign: rs.fn(
      async ({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) => ({
        ...byId(taskId),
        assigneeId,
      }),
    ),
    opClaim: rs.fn(async ({ taskId }: { taskId: string }) => ({
      ...byId(taskId),
      assigneeId: "u1",
    })),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      { ...byId(taskId), ...patch },
    ]),
    upsertTask: rs.fn(async (t: Task) => ({ ...t, id: "t-new" })),
    deleteTask: rs.fn(async ({ taskId }: { taskId: string }) => ({
      ...byId(taskId),
      deletedAt: "2026-10-08T00:00:00Z",
    })),
    opCatchUp: rs.fn(async () => []),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api };
}

async function mount(tasks: Task[]) {
  const fake = fakeRuntime(tasks);
  const hook = renderTasksHook(fake.runtime, {
    userId: "u1",
    workspaceId: "w1",
    modulePermission: "edit",
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

describe("teams and hand-overs (TV-D13)", () => {
  it("taking a team's task shows it as mine at once and keeps the server's row", async () => {
    const { api, hook } = await mount([task("t1", { assigneeId: null, teamId: "team-ds" })]);
    act(() => hook.result.current.commands.claimTask("t1"));
    expect(hook.result.current.tasks.find((t) => t.id === "t1")?.assigneeId).toBe("u1");
    await waitFor(() =>
      expect(api.opClaim).toHaveBeenCalledWith({ workspaceId: "w1", taskId: "t1" }),
    );
    expect(hook.result.current.tasks.find((t) => t.id === "t1")?.teamId).toBe("team-ds");
  });

  it("taken by someone first: the claim is refused and the task goes back to unclaimed", async () => {
    const { api, hook } = await mount([task("t1", { assigneeId: null, teamId: "team-ds" })]);
    api.opClaim.mockImplementationOnce(async () => {
      throw new Error("Someone already took this task.");
    });
    act(() => hook.result.current.commands.claimTask("t1"));
    await waitFor(() => expect(api.opClaim).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(hook.result.current.tasks.find((t) => t.id === "t1")?.assigneeId).toBeNull(),
    );
  });

  it("someone else's unfiled task handed on to another Inbox leaves my copy, with its steps", async () => {
    const { api, hook } = await mount([
      task("t1", { creatorId: "u9", assigneeId: "u1" }),
      task("s1", { creatorId: "u9", assigneeId: null, parentId: "t1" }),
    ]);
    api.opAssign.mockImplementationOnce(async ({ taskId }: { taskId: string }) => ({
      ...task(taskId, { creatorId: "u9" }),
      assigneeId: "u3",
      bucketId: "inbox-u3",
    }));
    act(() => hook.result.current.commands.patchTask("t1", { assigneeId: "u3" }));
    await waitFor(() => expect(api.opAssign).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.tasks.map((t) => t.id)).toEqual([]));
  });

  it("an Inbox task assigned and filed in one gesture: the move lands first, then the assignment", async () => {
    const { api, hook } = await mount([task("t1", { creatorId: "u9", assigneeId: "u1" })]);
    const order: string[] = [];
    api.opUpdateTask.mockImplementationOnce(
      async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
        order.push("update");
        return [{ ...task(taskId, { creatorId: "u9" }), ...patch }];
      },
    );
    api.opAssign.mockImplementationOnce(
      async ({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) => {
        order.push("assign");
        return { ...task(taskId, { creatorId: "u9" }), bucketId: "b2", assigneeId };
      },
    );
    act(() => hook.result.current.commands.patchTask("t1", { assigneeId: "u3", bucketId: "b2" }));
    await waitFor(() => expect(order).toEqual(["update", "assign"]));
    expect(api.opUpdateTask).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "t1",
      patch: { bucketId: "b2" },
    });
  });

  it("my own task handed on stays in my copy (I made it: Created by me)", async () => {
    const { api, hook } = await mount([task("t1", { creatorId: "u1", assigneeId: "u1" })]);
    api.opAssign.mockImplementationOnce(async ({ taskId }: { taskId: string }) => ({
      ...task(taskId, { creatorId: "u1" }),
      assigneeId: "u3",
      bucketId: "inbox-u3",
    }));
    act(() => hook.result.current.commands.patchTask("t1", { assigneeId: "u3" }));
    await waitFor(() =>
      expect(hook.result.current.tasks.find((t) => t.id === "t1")?.bucketId).toBe("inbox-u3"),
    );
  });
});

describe("Tasks saves (TV-D1)", () => {
  beforeEach(() => {
    undo.last = null;
  });

  it("an edit sends only the fields it changed, not the whole task", async () => {
    const { api, hook } = await mount([task("t1", { priority: null, title: "Old" })]);
    act(() => hook.result.current.commands.patchTask("t1", { priority: "high" }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    expect(api.updateTask).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "t1",
      patch: { priority: "high" },
    });
    expect(api.upsertTask).not.toHaveBeenCalled();
  });

  it("assigning goes through the op, Unassigned included, and nothing else is written", async () => {
    const { api, hook } = await mount([task("t1")]);
    act(() => hook.result.current.commands.patchTask("t1", { assigneeId: null }));
    await waitFor(() => expect(api.opAssign).toHaveBeenCalledTimes(1));
    expect(api.opAssign).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "t1",
      assigneeId: null,
    });
    expect(api.updateTask).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(hook.result.current.tasks.find((t) => t.id === "t1")?.assigneeId).toBeNull(),
    );
  });

  it("an Inbox task edited and reassigned at once: the edit through the op first, then the assignment (TV-D13)", async () => {
    const { api, hook } = await mount([task("t1")]);
    act(() => hook.result.current.commands.patchTask("t1", { assigneeId: "u3", title: "New" }));
    await waitFor(() => expect(api.opAssign).toHaveBeenCalledTimes(1));
    expect(api.opUpdateTask).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "t1",
      patch: { title: "New" },
    });
    expect(api.opAssign).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "t1",
      assigneeId: "u3",
    });
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("a new task is the creator's unless an assignee (or Unassigned) is chosen", async () => {
    const { api, hook } = await mount([]);
    // createTask returns the save's promise (TV-T1); a block body keeps act synchronous.
    act(() => {
      hook.result.current.commands.createTask({ bucketId: "b1", title: "Mine" });
    });
    act(() => {
      hook.result.current.commands.createTask({
        bucketId: "b1",
        title: "Nobody's",
        assigneeId: null,
      });
    });
    act(() => {
      hook.result.current.commands.createTask({
        bucketId: "b1",
        title: "Theirs",
        assigneeId: "u2",
      });
    });
    await waitFor(() => expect(api.upsertTask).toHaveBeenCalledTimes(3));
    const sent = api.upsertTask.mock.calls.map(([t]) => [t.title, t.assigneeId, t.creatorId]);
    expect(sent).toEqual([
      ["Mine", "u1", "u1"],
      ["Nobody's", null, "u1"],
      ["Theirs", "u2", "u1"],
    ]);
  });

  it("Undo of a delete restores only deleted_at and the subtasks' parent", async () => {
    const { api, hook } = await mount([task("p"), task("c", { parentId: "p" })]);
    act(() => hook.result.current.commands.deleteTask("p"));
    await waitFor(() => expect(undo.last).not.toBeNull());
    await act(async () => {
      undo.last?.();
    });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(2));
    expect(api.updateTask).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "p",
      patch: { deletedAt: null },
    });
    expect(api.updateTask).toHaveBeenCalledWith({
      workspaceId: "w1",
      taskId: "c",
      patch: { parentId: "p" },
    });
    expect(api.upsertTask).not.toHaveBeenCalled();
  });
});
