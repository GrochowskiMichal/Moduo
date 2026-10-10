// TV-U4 — a Board drop: a reorder only in one project's manual order, a
// sorted board asks to switch back, a board across projects never writes a
// position, a status column changes the status, a project column moves the
// task (never into the Inbox from a project).

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../helpers";
import type { Task } from "../model";
import { type BoardColumnRef, boardColumnAccepts, planBoardDrop } from "./board-drop";

function task(id: string, position: string, fields: Partial<Task> = {}): Task {
  return { ...makeTask({ workspaceId: "w", bucketId: "p1", title: id, position }), id, ...fields };
}

const A = task("a", "0000000010");
const B = task("b", "0000000020");
const C = task("c", "0000000030", { status: "in_progress" });
const todo: BoardColumnRef = { id: "col:status:todo", dim: "status", value: "todo", all: [A, B] };
const doing: BoardColumnRef = {
  id: "col:status:in_progress",
  dim: "status",
  value: "in_progress",
  all: [C],
};
const plan = (over: Partial<Parameters<typeof planBoardDrop>[0]>) =>
  planBoardDrop({
    task: B,
    parent: null,
    source: todo,
    dest: todo,
    overId: "a",
    order: "manual",
    inboxId: "inbox",
    bucketName: (id) => (id === "p2" ? "Website" : id),
    ...over,
  });

describe("planBoardDrop", () => {
  it("reorders inside a column of one project's manual order", () => {
    const d = plan({});
    expect(d.kind).toBe("write");
    if (d.kind !== "write") return;
    expect(d.label).toBe("Moved");
    expect(d.write.taskId).toBe("b");
    expect(d.write.position && d.write.position < A.position).toBe(true);
  });

  it("a sorted board asks to switch back and writes nothing", () => {
    expect(plan({ order: "sorted" })).toEqual({ kind: "ask-manual" });
  });

  it("a board across projects has no reorder", () => {
    expect(plan({ order: "none" })).toEqual({ kind: "none" });
  });

  it("another status column changes the status; the place only in manual order", () => {
    const manual = plan({ dest: doing, overId: "c" });
    expect(manual.kind === "write" && manual.write.status).toBe("in_progress");
    expect(manual.kind === "write" && manual.write.position !== undefined).toBe(true);
    expect(manual.kind === "write" && manual.label).toBe("Moved to In progress");
    for (const order of ["sorted", "none"] as const) {
      expect(plan({ dest: doing, overId: "c", order })).toEqual({
        kind: "write",
        write: { taskId: "b", status: "in_progress" },
        label: "Moved to In progress",
      });
    }
  });

  it("Won't do is a status column like the others", () => {
    const wont: BoardColumnRef = {
      id: "col:status:archived",
      dim: "status",
      value: "archived",
      all: [],
    };
    expect(plan({ dest: wont, overId: null, order: "none" })).toEqual({
      kind: "write",
      write: { taskId: "b", status: "archived" },
      label: "Moved to Won’t do",
    });
  });

  it("a project column moves it (to the project's end, no place from the view)", () => {
    const p1: BoardColumnRef = { id: "col:bucket:p1", dim: "bucket", value: "p1", all: [A, B] };
    const p2: BoardColumnRef = { id: "col:bucket:p2", dim: "bucket", value: "p2", all: [] };
    expect(plan({ source: p1, dest: p2, overId: null, order: "none" })).toEqual({
      kind: "write",
      write: { taskId: "b", bucketId: "p2" },
      label: "Moved to Website",
    });
    // A subtask moved on its own comes out of its parent.
    const sub = task("s", "0000000040", { parentId: "a" });
    expect(
      plan({ task: sub, parent: A, source: p1, dest: p2, overId: null, order: "none" }),
    ).toMatchObject({ write: { taskId: "s", bucketId: "p2", parentId: null } });
  });

  it("never into the Inbox from a project; the column doesn't light up", () => {
    const p1: BoardColumnRef = { id: "col:bucket:p1", dim: "bucket", value: "p1", all: [A, B] };
    const inbox: BoardColumnRef = {
      id: "col:bucket:inbox",
      dim: "bucket",
      value: "inbox",
      all: [],
    };
    expect(plan({ source: p1, dest: inbox, overId: null, order: "none" })).toEqual({
      kind: "none",
    });
    expect(boardColumnAccepts(inbox, B, "inbox")).toBe(false);
    expect(boardColumnAccepts(inbox, { bucketId: "inbox" }, "inbox")).toBe(true);
    expect(boardColumnAccepts(todo, B, "inbox")).toBe(true);
  });
});
