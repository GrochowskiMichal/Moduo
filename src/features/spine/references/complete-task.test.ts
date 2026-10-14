// TV-POLISH · a reference card's Complete outside the Tasks page finishes the
// task's open subtasks through the shared store (call 87); reopening, or a
// task the store doesn't hold, takes the plain op.

import { describe, expect, it, rs } from "@rstest/core";

rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: () => 1 }));
rs.mock("sonner", () => ({ toast: Object.assign(() => 1, { error: () => 1 }) }));

import { makeTask } from "../../tasks/helpers";
import type { Task } from "../../tasks/model";
import { completeReferencedTask } from "./complete-task";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    statusCategory: "todo",
    ...over,
  };
}

function setup(tasks: Task[] | null) {
  const sent: string[] = [];
  const ops: Array<{ taskId: string; status: string }> = [];
  const store =
    tasks === null
      ? null
      : {
          sendStatus: async (input: { taskId: string }) => {
            sent.push(input.taskId);
            return "saved" as const;
          },
          queueOp: (_o: unknown, op: () => Promise<unknown>) => op(),
          getSnapshot: () => ({ bundle: { tasks }, queue: [] }),
        };
  const runtime = {
    tasks: {
      opSetStatus: async (input: { taskId: string; status: string }) => {
        ops.push({ taskId: input.taskId, status: input.status });
      },
      opQueueAdd: async () => [],
      opQueueReorder: async () => [],
    },
  };
  const run = (taskId: string, done: boolean) =>
    completeReferencedTask({
      runtime: runtime as never,
      workspaceId: "w1",
      userId: "me",
      taskId,
      done,
      findStore: () => store as never,
    });
  return { sent, ops, run };
}

describe("completeReferencedTask", () => {
  const parent = task("p");
  const sub = task("s", { parentId: "p" });

  it("finishes the task and its open subtasks through the store", async () => {
    const { sent, ops, run } = setup([parent, sub]);
    await run("p", true);
    expect(sent).toEqual(["p", "s"]);
    expect(ops).toEqual([]);
  });

  it("reopens with the plain op, the task alone", async () => {
    const { sent, ops, run } = setup([parent, sub]);
    await run("p", false);
    expect(sent).toEqual([]);
    expect(ops).toEqual([{ taskId: "p", status: "todo" }]);
  });

  it("takes the plain op when there's no store, or the store doesn't hold the task", async () => {
    const none = setup(null);
    await none.run("p", true);
    expect(none.ops).toEqual([{ taskId: "p", status: "done" }]);
    const elsewhere = setup([sub]);
    await elsewhere.run("p", true);
    expect(elsewhere.sent).toEqual([]);
    expect(elsewhere.ops).toEqual([{ taskId: "p", status: "done" }]);
  });
});
