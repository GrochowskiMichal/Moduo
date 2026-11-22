// TV-POLISH · a reference card's Complete outside the Tasks page finishes the
// task's open subtasks through the shared store (call 87); reopening is the
// task alone, through the store too; a task the store doesn't hold takes the
// plain op in its turn, and only without a store does it go straight out.

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
  const inTurn: string[] = [];
  const ops: Array<{ taskId: string; status: string }> = [];
  const store =
    tasks === null
      ? null
      : {
          sendStatus: async (input: { taskId: string; status: string }) => {
            sent.push(`${input.taskId}:${input.status}`);
            return "saved" as const;
          },
          sendStatusInTurn: (taskId: string, op: () => Promise<unknown>) => {
            inTurn.push(taskId);
            return op();
          },
          queueOp: (_o: unknown, op: () => Promise<unknown>) => op(),
          getSnapshot: () => ({ bundle: { tasks, buckets: [] }, queue: [] }),
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
  return { sent, inTurn, ops, run };
}

describe("completeReferencedTask", () => {
  const parent = task("p");
  const sub = task("s", { parentId: "p" });

  it("finishes the task and its open subtasks through the store", async () => {
    const { sent, ops, run } = setup([parent, sub]);
    await run("p", true);
    expect(sent).toEqual(["p:done", "s:done"]);
    expect(ops).toEqual([]);
  });

  it("reopens through the store's status write, the task alone", async () => {
    const { sent, ops, run } = setup([parent, { ...sub, statusCategory: "done" }]);
    await run("p", false);
    expect(sent).toEqual(["p:todo"]);
    expect(ops).toEqual([]);
  });

  it("takes the plain op in its turn when the store doesn't hold the task", async () => {
    const elsewhere = setup([sub]);
    await elsewhere.run("p", true);
    await elsewhere.run("p", false);
    expect(elsewhere.sent).toEqual([]);
    expect(elsewhere.inTurn).toEqual(["p", "p"]);
    expect(elsewhere.ops).toEqual([
      { taskId: "p", status: "done" },
      { taskId: "p", status: "todo" },
    ]);
  });

  it("takes the plain op straight out only without a store", async () => {
    const none = setup(null);
    await none.run("p", true);
    expect(none.ops).toEqual([{ taskId: "p", status: "done" }]);
  });
});
