// TV-H1 · call 87 from Home (TV-U13's rule, Home's side): the Tasks widget
// finishes a task through the shared store, its open subtasks too, and one
// Undo puts back only what is still done.

import { describe, expect, it } from "@rstest/core";

import { checkOffWithSubtasks, focusAnchor, restoreFocusPlace, undoCheckOff } from "./check-off";
import { makeTask } from "./helpers";
import type { Task } from "./model";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    statusCategory: "todo",
    ...over,
  };
}

type Sent = { taskId: string; status: string; fields: Partial<Task> };

function fakeStore(refuse: ReadonlySet<string> = new Set()) {
  const sent: Sent[] = [];
  return {
    sent,
    sendStatus: async (input: Sent) => {
      sent.push(input);
      if (refuse.has(input.taskId)) throw new Error("refused");
      return "saved" as const;
    },
  };
}

describe("checkOffWithSubtasks", () => {
  const parent = task("p", {
    statusId: "st-progress",
    statusCategory: "in_progress",
    status: "in_progress",
  });
  const a = task("a", { parentId: "p" });
  const b = task("b", { parentId: "p", statusCategory: "backlog" });
  const closed = task("c", { parentId: "p", status: "done", statusCategory: "done" });

  it("finishes the task first, then its open subtasks", async () => {
    const store = fakeStore();
    const out = await checkOffWithSubtasks(store, parent, [parent, a, b, closed]);
    expect(store.sent.map((s) => [s.taskId, s.status])).toEqual([
      ["p", "done"],
      ["a", "done"],
      ["b", "done"],
    ]);
    expect(out.subtasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(out.refused).toBe(0);
  });

  it("counts a refused subtask and leaves it out of the Undo", async () => {
    const store = fakeStore(new Set(["b"]));
    const out = await checkOffWithSubtasks(store, parent, [parent, a, b]);
    expect(out.subtasks.map((t) => t.id)).toEqual(["a"]);
    expect(out.refused).toBe(1);
  });

  it("throws when the task itself is refused, and sends nothing more", async () => {
    const store = fakeStore(new Set(["p"]));
    await expect(checkOffWithSubtasks(store, parent, [parent, a])).rejects.toThrow("refused");
    expect(store.sent.map((s) => s.taskId)).toEqual(["p"]);
  });
});

describe("undoCheckOff", () => {
  it("puts back each task still done, by its own status when it had one", async () => {
    const parent = task("p", {
      statusId: "st-progress",
      statusCategory: "in_progress",
      status: "in_progress",
    });
    const a = task("a", { parentId: "p" });
    const b = task("b", { parentId: "p", statusCategory: "backlog" });
    const now = new Map<string, Task>([
      ["p", { ...parent, status: "done", statusCategory: "done" }],
      ["a", { ...a, status: "done", statusCategory: "done" }],
      // Reopened by someone since: a later change wins.
      ["b", { ...b, statusCategory: "todo" }],
    ]);
    const store = fakeStore();
    const out = await undoCheckOff(store, [parent, a, b], (id) => now.get(id));
    expect(out).toEqual({ restored: ["p", "a"], failed: 0 });
    expect(store.sent).toEqual([
      {
        taskId: "p",
        status: "st-progress",
        fields: { statusId: "st-progress", statusCategory: "in_progress", status: "in_progress" },
      },
      { taskId: "a", status: "todo", fields: { statusCategory: "todo", status: "todo" } },
    ]);
  });
});

describe("focusAnchor (Undo puts a task back in Focus where it was)", () => {
  it("goes back after the nearest task before it that is still lined up", () => {
    expect(focusAnchor("c", ["a", "b", "c", "d"], new Set(["a", "d"]))).toBe("a");
    expect(focusAnchor("c", ["a", "b", "c", "d"], new Set(["b", "d"]))).toBe("b");
  });

  it("goes to the top when nothing before it is still lined up", () => {
    expect(focusAnchor("a", ["a", "b"], new Set(["b"]))).toBeNull();
    expect(focusAnchor("b", ["a", "b"], new Set())).toBeNull();
  });

  it("restoreFocusPlace adds it back, then places it by the server's line-up", async () => {
    const calls: string[] = [];
    const entry = (taskId: string) => ({
      id: taskId,
      workspaceId: "w1",
      userId: "me",
      taskId,
      position: taskId,
      queuedAt: "",
      updatedAt: "",
    });
    const tasks = {
      // On the server "b" has left the line-up meanwhile; the copy may not know yet.
      opQueueAdd: async () => {
        calls.push("add");
        return [entry("a"), entry("d"), entry("c")];
      },
      opQueueReorder: async (input: { afterTaskId: string | null }) => {
        calls.push(`after:${input.afterTaskId}`);
        return [];
      },
    };
    const store = { queueOp: (_o: unknown, op: () => Promise<unknown>) => op() };
    await restoreFocusPlace(store as never, tasks as never, "w1", "c", ["a", "b", "c", "d"]);
    expect(calls).toEqual(["add", "after:a"]);
  });
});
