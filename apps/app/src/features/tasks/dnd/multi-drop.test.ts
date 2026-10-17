// TV-U12 · a drag of several selected tasks (TV-U4's carry-forward): the held
// task's change goes to every selected task, places line up behind the held
// one, a parent never nests, and a task that already has the value is left.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../helpers";
import type { Task } from "../model";
import { manyLabel, multiDropLabel, multiDropWrites } from "./multi-drop";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    statusCategory: "todo",
    ...over,
  };
}

const names = {
  bucketName: (id: string) => (id === "p2" ? "Website" : id),
  assigneeName: (id: string) => id,
  taskTitle: (id: string) => id,
};

describe("dragging a selection (TV-U12)", () => {
  it("copies a status to every selected task, skipping one already there", () => {
    const a = task("a");
    const b = task("b");
    const c = task("c", { status: "in_progress", statusCategory: "in_progress" });
    const writes = multiDropWrites(
      { taskId: "a", status: "in_progress" },
      a,
      ["a", "b", "c"],
      [a, b, c],
    );
    expect(writes).toEqual([
      { taskId: "a", status: "in_progress" },
      { taskId: "b", status: "in_progress" },
    ]);
  });

  it("lines the rest up right behind the held task's new place", () => {
    const all = [task("a"), task("b"), task("c"), task("d")];
    const writes = multiDropWrites(
      { taskId: "c", position: "c5" },
      all[2] as Task,
      ["a", "c"],
      all,
    );
    const held = writes.find((w) => w.taskId === "c");
    const other = writes.find((w) => w.taskId === "a");
    expect(held?.position).toBe("c5");
    expect((other?.position ?? "") > "c5" && (other?.position ?? "") < "d").toBe(true);
  });

  it("nests the rest under the target, but never a parent or the target itself", () => {
    const target = task("target");
    const parent = task("parent");
    const child = task("child", { parentId: "parent" });
    const loose = task("loose");
    const writes = multiDropWrites(
      { taskId: "loose", parentId: "target" },
      loose,
      ["loose", "parent", "target"],
      [target, parent, child, loose],
    );
    expect(writes.map((w) => w.taskId)).toEqual(["loose"]);
  });

  it("moves a selection into another project, each to the project's end", () => {
    const end = task("z", { bucketId: "p2" });
    const a = task("a");
    const b = task("b");
    const writes = multiDropWrites({ taskId: "a", bucketId: "p2" }, a, ["a", "b"], [a, b, end]);
    expect(writes.map((w) => [w.taskId, w.bucketId])).toEqual([
      ["a", "p2"],
      ["b", "p2"],
    ]);
    expect((writes[0]?.position ?? "") > "z").toBe(true);
    expect(multiDropLabel({ taskId: "a", bucketId: "p2" }, 2, names)).toBe(
      "Moved 2 tasks to Website",
    );
    expect(manyLabel("Moved to Done", 3)).toBe("Moved to Done · 3 tasks");
  });
});
