// TV-U4 — a drop's one write shape, its Undo (never over a newer change) and
// what its toast says.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../helpers";
import type { Task } from "../model";
import { dropLabel, undoWrite, writeFromPlan } from "./drop-write";

const base: Task = {
  ...makeTask({
    workspaceId: "w",
    bucketId: "b1",
    title: "Write the brief",
    position: "0000000010",
  }),
  id: "t",
};

const names = {
  bucketName: (id: string) => (id === "b2" ? "Website" : "Inbox"),
  assigneeName: (id: string) => (id === "u1" ? "Sam" : "you"),
  taskTitle: (id: string) => (id === "p" ? "Plan launch" : "Untitled"),
};

describe("writeFromPlan", () => {
  it("flattens a plan into the one write shape", () => {
    expect(
      writeFromPlan({
        taskId: "t",
        parentId: null,
        position: "0000000015",
        fields: { status: "done" },
      }),
    ).toEqual({ taskId: "t", parentId: null, position: "0000000015", status: "done" });
    expect(writeFromPlan({ taskId: "t", bucketId: "b2", fields: { assigneeId: null } })).toEqual({
      taskId: "t",
      bucketId: "b2",
      assigneeId: null,
    });
  });
});

describe("undoWrite — Undo never overwrites a newer change", () => {
  const write = { taskId: "t", bucketId: "b2", position: "0000000099", status: "done" as const };
  const after = { ...base, bucketId: "b2", position: "0000000099", status: "done" as const };

  it("puts back every field the drop changed", () => {
    expect(undoWrite({ write, before: base, after, current: after })).toEqual({
      write: { taskId: "t", bucketId: "b1", position: "0000000010", status: "todo" },
      kept: [],
    });
  });

  it("leaves a field someone changed since, and says which", () => {
    const current = { ...after, status: "in_progress" as const };
    expect(undoWrite({ write, before: base, after, current })).toEqual({
      write: { taskId: "t", bucketId: "b1", position: "0000000010" },
      kept: ["status"],
    });
  });

  it("has nothing to write when everything changed since", () => {
    const current = { ...after, bucketId: "b3", position: "0000000001", status: "todo" as const };
    expect(undoWrite({ write, before: base, after, current })).toEqual({
      write: null,
      kept: ["bucketId", "position", "status"],
    });
  });

  it("restores a cleared parent and an assignee", () => {
    const before = { ...base, parentId: "p", assigneeId: "u1" };
    const w = { taskId: "t", parentId: null, assigneeId: null };
    const saved = { ...base, parentId: null, assigneeId: null };
    expect(undoWrite({ write: w, before, after: saved, current: saved }).write).toEqual({
      taskId: "t",
      parentId: "p",
      assigneeId: "u1",
    });
  });
});

describe("dropLabel — the Undo toast's words", () => {
  it("names the most telling change", () => {
    expect(dropLabel({ taskId: "t", bucketId: "b2", parentId: null }, names)).toBe(
      "Moved to Website",
    );
    expect(dropLabel({ taskId: "t", status: "in_progress", position: "x" }, names)).toBe(
      "Moved to In progress",
    );
    expect(dropLabel({ taskId: "t", status: "archived" }, names)).toBe("Moved to Won’t do");
    expect(dropLabel({ taskId: "t", assigneeId: "u1" }, names)).toBe("Assigned to Sam");
    expect(dropLabel({ taskId: "t", assigneeId: null }, names)).toBe("Unassigned");
    expect(dropLabel({ taskId: "t", priority: "high" }, names)).toBe("Set to High priority");
    expect(dropLabel({ taskId: "t", priority: null }, names)).toBe("Priority cleared");
    expect(dropLabel({ taskId: "t", parentId: "p" }, names)).toBe("Moved under “Plan launch”");
    expect(dropLabel({ taskId: "t", parentId: null }, names, { parentId: "p" })).toBe(
      "Moved out of “Plan launch”",
    );
    expect(dropLabel({ taskId: "t", position: "x" }, names)).toBe("Moved");
  });
});
