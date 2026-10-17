// TV-U4, TV-U11 — a Board drop: a reorder only in one project's manual
// order, a sorted board asks to switch back, a board across projects never
// writes a position; another column writes its field (a project's own
// status by id, a shared name per project, a section, a person, a priority,
// a team, a project), another lane writes the lane's; never into the Inbox
// from a project; Project lanes and area columns take no moves.

import { describe, expect, it } from "@rstest/core";
import type { BoardTarget } from "../board-columns";
import { makeTask } from "../helpers";
import type { ProjectStatus, Task } from "../model";
import {
  type BoardCellRef,
  planBoardDrop,
  targetAccepts,
  targetLabel,
  targetName,
} from "./board-drop";

function task(id: string, position: string, fields: Partial<Task> = {}): Task {
  return { ...makeTask({ workspaceId: "w", bucketId: "p1", title: id, position }), id, ...fields };
}

const A = task("a", "0000000010");
const B = task("b", "0000000020");
const C = task("c", "0000000030", { status: "in_progress" });

function cell(
  id: string,
  label: string,
  target: BoardTarget | null,
  all: Task[],
  lane: BoardCellRef["lane"] = null,
): BoardCellRef {
  return { id, column: { id: id.split("|")[0] ?? id, label, target }, lane, all };
}

const status = (key: "todo" | "in_progress" | "archived", statusId: string | null = null) =>
  ({ field: "status", key, statusId, name: null }) as const;
const todo = cell("col:status:todo", "To do", status("todo"), [A, B]);
const doing = cell("col:status:in_progress", "In progress", status("in_progress"), [C]);

const statuses: ProjectStatus[] = [
  {
    id: "s-review-p2",
    workspaceId: "w",
    projectId: "p2",
    name: "In review",
    category: "in_progress",
    position: 2,
    hidden: false,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  } as ProjectStatus,
];
const ctx = {
  inboxId: "inbox",
  statusesFor: (bucketId: string) => statuses.filter((s) => s.projectId === bucketId),
  parent: null,
};
const plan = (over: Partial<Parameters<typeof planBoardDrop>[0]>) =>
  planBoardDrop({
    task: B,
    source: todo,
    dest: todo,
    overId: "a",
    order: "manual",
    ctx,
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

  it("one project's own status goes by id, with its own name in the toast (53a)", () => {
    const review = cell("col:status:s-r", "In review", status("in_progress", "s-r"), []);
    expect(plan({ dest: review, overId: null, order: "none" })).toEqual({
      kind: "write",
      write: { taskId: "b", status: "in_progress", statusId: "s-r" },
      label: "Moved to In review",
    });
  });

  it("a shared name across projects takes each task's own project's status of that name", () => {
    const named = cell(
      "col:status:name:in review",
      "In review",
      {
        field: "status",
        key: "in_progress",
        statusId: null,
        name: "in review",
      },
      [],
    );
    const inP2 = task("x", "0000000050", { bucketId: "p2" });
    expect(plan({ task: inP2, dest: named, overId: null, order: "none" })).toMatchObject({
      write: { taskId: "x", status: "in_progress", statusId: "s-review-p2" },
    });
    // A project without that name: the category's first.
    expect(plan({ dest: named, overId: null, order: "none" })).toMatchObject({
      write: { taskId: "b", status: "in_progress" },
    });
  });

  it("Won't do is a status column like the others", () => {
    const wont = cell("col:status:archived", "Won’t do", status("archived"), []);
    expect(plan({ dest: wont, overId: null, order: "none" })).toEqual({
      kind: "write",
      write: { taskId: "b", status: "archived" },
      label: "Moved to Won’t do",
    });
  });

  it("sections, people, priorities and teams write their field (call 22)", () => {
    const write = (target: BoardTarget, label: string) =>
      plan({ dest: cell("col:x:y", label, target, []), overId: null, order: "none" });
    expect(write({ field: "section", value: "s1" }, "Week 1")).toEqual({
      kind: "write",
      write: { taskId: "b", sectionId: "s1" },
      label: "Moved to Week 1",
    });
    expect(write({ field: "assignee", value: "u2" }, "Sam")).toMatchObject({
      write: { assigneeId: "u2" },
      label: "Assigned to Sam",
    });
    expect(write({ field: "assignee", value: null }, "Unassigned")).toMatchObject({
      write: { assigneeId: null },
      label: "Unassigned",
    });
    expect(write({ field: "priority", value: "high" }, "High")).toMatchObject({
      write: { priority: "high" },
      label: "Set to High",
    });
    expect(write({ field: "team", value: "t1" }, "Design")).toMatchObject({
      write: { teamId: "t1" },
      label: "Routed to Design",
    });
  });

  it("a column without a field (an area) takes nothing", () => {
    expect(plan({ dest: cell("col:area:a1", "Clients", null, []), overId: null })).toEqual({
      kind: "none",
    });
  });

  it("a project column moves it (to the project's end, no place from the view)", () => {
    const p1 = cell("col:bucket:p1", "Work", { field: "project", value: "p1" }, [A, B]);
    const p2 = cell("col:bucket:p2", "Website", { field: "project", value: "p2" }, []);
    expect(plan({ source: p1, dest: p2, overId: null, order: "none" })).toEqual({
      kind: "write",
      write: { taskId: "b", bucketId: "p2" },
      label: "Moved to Website",
    });
    // A subtask moved on its own comes out of its parent.
    const sub = task("s", "0000000040", { parentId: "a" });
    expect(
      plan({
        task: sub,
        source: p1,
        dest: p2,
        overId: null,
        order: "none",
        ctx: { ...ctx, parent: A },
      }),
    ).toMatchObject({ write: { taskId: "s", bucketId: "p2", parentId: null } });
  });

  it("never into the Inbox from a project; the column doesn't light up", () => {
    const p1 = cell("col:bucket:p1", "Work", { field: "project", value: "p1" }, [A, B]);
    const inbox = cell("col:bucket:inbox", "Inbox", { field: "project", value: "inbox" }, []);
    expect(plan({ source: p1, dest: inbox, overId: null, order: "none" })).toEqual({
      kind: "none",
    });
    expect(targetAccepts(inbox.column.target, B, "inbox")).toBe(false);
    expect(targetAccepts(inbox.column.target, { bucketId: "inbox" }, "inbox")).toBe(true);
    expect(targetAccepts(todo.column.target, B, "inbox")).toBe(true);
    expect(targetAccepts(null, B, "inbox")).toBe(false);
  });

  it("another lane writes the lane's field; both when the column changes too (call 85)", () => {
    const lane = (key: string, label: string, value: string | null) => ({
      key,
      label,
      target: { field: "assignee", value } as BoardTarget,
    });
    const mine = cell(
      "col:status:todo|lane:u1",
      "To do",
      status("todo"),
      [A, B],
      lane("u1", "You", "u1"),
    );
    const sams = cell(
      "col:status:todo|lane:u2",
      "To do",
      status("todo"),
      [],
      lane("u2", "Sam", "u2"),
    );
    const samsDoing = cell(
      "col:status:in_progress|lane:u2",
      "In progress",
      status("in_progress"),
      [],
      lane("u2", "Sam", "u2"),
    );
    expect(plan({ source: mine, dest: sams, overId: null, order: "none" })).toEqual({
      kind: "write",
      write: { taskId: "b", assigneeId: "u2" },
      label: "Assigned to Sam",
    });
    expect(plan({ source: mine, dest: samsDoing, overId: null, order: "none" })).toEqual({
      kind: "write",
      write: { taskId: "b", status: "in_progress", assigneeId: "u2" },
      label: "Moved to In progress",
    });
    // Project lanes never move a task to another project (a deliberate Move).
    const projectLane = (key: string) => ({ key, label: key, target: null });
    const p1 = cell("col:status:todo|lane:p1", "To do", status("todo"), [A, B], projectLane("p1"));
    const p2 = cell("col:status:todo|lane:p2", "To do", status("todo"), [], projectLane("p2"));
    expect(plan({ source: p1, dest: p2, overId: null, order: "none" })).toEqual({ kind: "none" });
  });

  it("the toast says what changed, in the one grammar", () => {
    expect(targetLabel({ field: "status", key: "done", statusId: null, name: null }, "Done")).toBe(
      "Moved to Done",
    );
    expect(targetLabel({ field: "team", value: null }, "No team")).toBe("Team cleared");
    expect(targetLabel({ field: "priority", value: null }, "Unset")).toBe("Priority cleared");
  });

  it("names you 'you' in the toast, though your column reads You (MOD-137)", () => {
    const yours = cell("col:assignee:u1", "You", { field: "assignee", value: "u1" }, []);
    const waitsOnYou = cell(
      "col:waiting:person:u1",
      "You",
      { field: "waiting", kind: "person", ref: "u1", label: null },
      [],
    );
    const self = { ...ctx, selfId: "u1" };
    expect(plan({ dest: yours, overId: null, order: "none", ctx: self })).toMatchObject({
      kind: "write",
      write: { assigneeId: "u1" },
      label: "Assigned to you",
    });
    expect(plan({ dest: waitsOnYou, overId: null, order: "none", ctx: self })).toMatchObject({
      kind: "waiting",
      label: "Waiting on you",
    });
    // Someone else's column keeps its name; no reader leaves the label alone.
    expect(targetName({ field: "assignee", value: "u2" }, "Sam", "u1")).toBe("Sam");
    expect(targetName({ field: "assignee", value: "u1" }, "You", null)).toBe("You");
  });
});
