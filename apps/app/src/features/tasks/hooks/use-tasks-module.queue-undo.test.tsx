// TV-U4's gap, fixed in TV-D11a: a drop into Done takes the task out of my
// queue (the server does it), and its Undo puts it back where it was — after
// the queued task it followed, or the nearest earlier one still queued.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { Task, TaskQueueEntry, TasksModuleBundle } from "../model";

const undo = rs.hoisted(() => ({ last: null as null | (() => void) }));
rs.mock("../../../lib/undo-toast", () => ({
  UNDO_TOAST_MS: 8000,
  undoToast: (_label: string, opts: { onUndo: () => void }) => {
    undo.last = opts.onUndo;
  },
}));
rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));
// Live updates (TV-D5) need a socket; these tests drive the hook without one.
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { useTasksModule } from "./use-tasks-module";

const ME = "u1";
const BUCKET = {
  id: "b1",
  workspaceId: "w1",
  ownerId: ME,
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
    creatorId: ME,
    assigneeId: ME,
    updatedAt: "2026-10-11T09:00:00.000Z",
    ...over,
  };
}

const row = (taskId: string, position: string): TaskQueueEntry => ({
  id: `q-${taskId}`,
  workspaceId: "w1",
  userId: ME,
  taskId,
  position,
  queuedAt: "2026-10-11T09:00:00Z",
  updatedAt: "2026-10-11T09:00:00Z",
});

function fakeRuntime(tasks: Task[], queue: TaskQueueEntry[]) {
  let rows = queue.slice();
  let stamp = 10;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const mine = () => rows.slice().sort((a, b) => (a.position < b.position ? -1 : 1));
  const bundle = (): TasksModuleBundle => ({
    buckets: [BUCKET],
    tasks: [...byId.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  });
  const api = {
    list: rs.fn(async () => bundle()),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => mine()),
    opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: string }) => {
      const done = status === "done";
      // Done leaves every queue (TV-D2).
      if (done) rows = rows.filter((r) => r.taskId !== taskId);
      const saved = {
        ...(byId.get(taskId) as Task),
        status: done ? "done" : "todo",
        statusCategory: done ? "done" : "todo",
        updatedAt: `2026-10-11T09:${stamp++}:00.000Z`,
      } as Task;
      byId.set(taskId, saved);
      return saved;
    }),
    opQueueAdd: rs.fn(async ({ taskId }: { taskId: string }) => {
      if (!rows.some((r) => r.taskId === taskId)) rows.push(row(taskId, "zzzzzzzzzz"));
      return mine();
    }),
    opQueueReorder: rs.fn(
      async ({ taskId, afterTaskId }: { taskId: string; afterTaskId: string | null }) => {
        const order = mine()
          .map((r) => r.taskId)
          .filter((id) => id !== taskId);
        order.splice(afterTaskId ? order.indexOf(afterTaskId) + 1 : 0, 0, taskId);
        rows = rows.map((r) => ({
          ...r,
          position: `p${String(order.indexOf(r.taskId)).padStart(9, "0")}`,
        }));
        return mine();
      },
    ),
    opCatchUp: rs.fn(async () => []),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api };
}

describe("a drop into Done, then Undo (TV-U4's gap)", () => {
  it("puts the task back in my queue where it was", async () => {
    const fake = fakeRuntime(
      [task("a"), task("b"), task("c")],
      [row("a", "000000mh34"), row("b", "00000168g8"), row("c", "000001ilsc")],
    );
    const hook = renderHook(() =>
      useTasksModule(fake.runtime, { userId: ME, workspaceId: "w1", modulePermission: "edit" }),
    );
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["a", "b", "c"]);

    await act(async () => {
      await hook.result.current.dropTask({ taskId: "b", status: "done" }, "Moved to Done");
    });
    // Out of my line-up on the server; still shown, done, in its place.
    expect(hook.result.current.queuedTaskIds.has("b")).toBe(false);
    expect(undo.last).not.toBeNull();

    act(() => undo.last?.());
    await waitFor(() =>
      expect(fake.api.opQueueReorder).toHaveBeenCalledWith({
        workspaceId: "w1",
        taskId: "b",
        afterTaskId: "a",
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.queuedTasks.map((t) => [t.id, t.status])).toEqual([
        ["a", "todo"],
        ["b", "todo"],
        ["c", "todo"],
      ]),
    );
  });
});
