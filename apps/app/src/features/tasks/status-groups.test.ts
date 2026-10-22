// The List grouped by status inside one project (MOD-241): a group per
// project status, drops and the group "+" write that exact status.

import { describe, expect, it } from "@rstest/core";

import { groupFieldPatch } from "./dnd/drop-mode";
import { dropLabel, writeFromPlan } from "./dnd/drop-write";
import { groupKeyFor, groupTasks, makeTask } from "./helpers";
import { groupAddState } from "./list-group-add";
import type { ProjectStatus, Task } from "./model";
import { statusGroupKey, statusGroupOf } from "./statuses";

function status(
  id: string,
  category: ProjectStatus["category"],
  name: string,
  position = 0,
): ProjectStatus {
  return {
    id,
    workspaceId: "w",
    projectId: "p1",
    category,
    name,
    position,
    hidden: false,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

const SET = [
  status("later", "backlog", "Later"),
  status("todo", "todo", "To do"),
  status("building", "in_progress", "Building", 0),
  status("review", "in_progress", "In review", 1),
  status("shipped", "done", "Shipped"),
  status("wontdo", "wont_do", "Won't do"),
];

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: id, position: id }),
    id,
    ...fields,
  };
}

const building = task("a", {
  status: "in_progress",
  statusCategory: "in_progress",
  statusId: "building",
});
const review = task("b", {
  status: "in_progress",
  statusCategory: "in_progress",
  statusId: "review",
});
const fresh = task("c", { status: "in_progress", statusCategory: "in_progress", statusId: null });
const planned = task("d", { status: "todo", statusCategory: "todo", statusId: "todo" });

describe("Status groups in one project (MOD-241)", () => {
  it("a task's group is its own status, else its category's first", () => {
    expect(statusGroupKey(review, SET)).toBe("review");
    expect(statusGroupKey(fresh, SET)).toBe("building");
    // No set: the status key, as across projects.
    expect(groupKeyFor(review, "status")).toBe("in_progress");
  });

  it("one group per status, in flight first, by the project's order and names", () => {
    const groups = groupTasks([planned, review, building, fresh], "status", {
      bucketName: () => "",
      statuses: SET,
    });
    expect(groups.map((g) => g.label)).toEqual(["Building", "In review", "To do"]);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("across projects the groups stay the status keys", () => {
    const groups = groupTasks([planned, review], "status", { bucketName: () => "" });
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ["in_progress", "In progress"],
      ["todo", "To do"],
    ]);
  });

  it("a status group key reads as its category and status", () => {
    expect(statusGroupOf("review", SET)).toMatchObject({
      key: "in_progress",
      category: "in_progress",
    });
    expect(statusGroupOf("later", SET)?.category).toBe("backlog");
    expect(statusGroupOf("done", SET)).toEqual({ key: "done", category: "done", status: null });
    expect(statusGroupOf("gone", SET)).toBeNull();
  });

  it("a drop into a status group writes that exact status", () => {
    expect(groupFieldPatch("status", "review", SET)).toEqual({
      status: "in_progress",
      statusId: "review",
    });
    expect(groupFieldPatch("status", "in_progress")).toEqual({ status: "in_progress" });
    const write = writeFromPlan({
      taskId: "a",
      fields: { status: "in_progress", statusId: "review" },
    });
    expect(write).toEqual({ taskId: "a", status: "in_progress", statusId: "review" });
    const names = {
      bucketName: () => "",
      assigneeName: () => "",
      taskTitle: () => "",
      statusName: (id: string) => SET.find((s) => s.id === id)?.name,
    };
    expect(dropLabel(write, names)).toBe("Moved to In review");
  });

  it("the group + seeds its status, none for finished ones", () => {
    const add = (key: string) =>
      groupAddState({
        scope: "p1",
        groupBy: "status",
        key,
        canEdit: true,
        today: "2026-10-22",
        inboxId: "inbox",
        statuses: SET,
      });
    expect(add("review")).toEqual({
      kind: "add",
      add: {
        projectId: "p1",
        seed: { status: "in_progress", statusId: "review", statusName: "In review" },
      },
    });
    // The category's first is the capture's own pick: no chip.
    expect(add("building")).toEqual({
      kind: "add",
      add: { projectId: "p1", seed: { status: "in_progress" } },
    });
    expect(add("shipped")).toEqual({ kind: "none" });
    expect(add("wontdo")).toEqual({ kind: "none" });
  });
});
