// TV-U12 · bulk edits on a selection (tasks-v3 §4, calls 82b, a, e; AC4.6,
// AC11.9): one write per task that would change, the subtasks a check-off
// brings along (call 87), Date for repeats (just the occurrences by default),
// and what the toast says, "3 of 4 changed" naming the one refused.

import { describe, expect, it } from "@rstest/core";

import {
  type BulkContext,
  bulkResultText,
  endPositions,
  planBulk,
  positionsAfter,
  sharedValue,
  singleProject,
} from "./bulk";
import { makeTask } from "./helpers";
import type { ProjectStatus, Task } from "./model";

// Wednesday, Oct 14 2026, 10:00 local.
const NOW = new Date(2026, 9, 14, 10, 0, 0);
const day = (d: number) => new Date(2026, 9, d).toISOString();

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    statusCategory: "todo",
    ...over,
  };
}

const REVIEW: ProjectStatus = {
  id: "s-review",
  workspaceId: "w1",
  projectId: "p1",
  category: "in_progress",
  name: "In review",
  position: "b",
  hidden: false,
  updatedAt: "",
  deletedAt: null,
} as ProjectStatus;

function ctx(all: Task[]): BulkContext {
  return {
    all,
    statusesFor: (bucketId) => (bucketId === "p1" ? [REVIEW] : []),
    names: {
      project: (id) => (id === "p2" ? "Website" : id),
      person: (id) => (id === "sam" ? "Sam" : id),
      section: (id) => (id ? "Design" : "No section"),
      team: (id) => (id ? "Design" : "No team"),
    },
    now: NOW,
    // The device's zone, as the app's engine uses it (a day is local midnight).
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

describe("bulk edits (AC4.6, AC11.9)", () => {
  it("Complete finishes the open ones and their open subtasks, once", () => {
    const parent = task("parent");
    const sub = task("sub", { parentId: "parent" });
    const doneSub = task("done-sub", { parentId: "parent", status: "done", statusCategory: "done" });
    const other = task("other");
    const all = [parent, sub, doneSub, other];
    const plan = planBulk([parent, other], { kind: "complete" }, ctx(all));
    expect(plan.writes.map((w) => [w.taskId, w.status])).toEqual([
      ["parent", "done"],
      ["other", "done"],
      ["sub", "done"],
    ]);
    expect([...plan.followers]).toEqual(["sub"]);
    expect(plan.label(2, 1)).toBe("Completed 2 tasks · also 1 subtask");
  });

  it("Complete on a selection that's all closed reopens it", () => {
    const a = task("a", { status: "done", statusCategory: "done" });
    const b = task("b", { status: "archived", statusCategory: "wont_do" });
    const plan = planBulk([a, b], { kind: "complete" }, ctx([a, b]));
    expect(plan.writes.map((w) => w.status)).toEqual(["todo", "todo"]);
    expect(plan.label(2, 0)).toBe("Reopened 2 tasks");
  });

  it("Status by name goes by id where the project has it, by category elsewhere", () => {
    const here = task("here");
    const there = task("there", { bucketId: "p2" });
    const already = task("already", {
      statusId: "s-review",
      status: "in_progress",
      statusCategory: "in_progress",
    });
    const plan = planBulk(
      [here, there, already],
      { kind: "status", target: { statusId: "s-review" } },
      ctx([here, there, already]),
    );
    expect(plan.writes).toEqual([
      { taskId: "here", status: "in_progress", statusId: "s-review" },
      { taskId: "there", status: "in_progress" },
    ]);
    expect(plan.label(2, 0)).toBe("Moved 2 tasks to In review");
  });

  it("skips the tasks that already have the value", () => {
    const a = task("a", { assigneeId: "sam" });
    const b = task("b", { assigneeId: "" });
    const plan = planBulk([a, b], { kind: "assign", assigneeId: "sam" }, ctx([a, b]));
    expect(plan.writes).toEqual([{ taskId: "b", assigneeId: "sam" }]);
    expect(plan.label(1, 0)).toBe("Assigned 1 task to Sam");
  });

  it("Move puts them at the project's end in order, a subtask going with its parent", () => {
    const end = task("z-end", { bucketId: "p2", position: "m" });
    const parent = task("parent", { position: "a" });
    const sub = task("sub", { parentId: "parent", position: "b" });
    const loose = task("loose", { position: "c" });
    const all = [parent, sub, loose, end];
    const plan = planBulk([parent, sub, loose], { kind: "project", bucketId: "p2" }, ctx(all));
    expect(plan.writes.map((w) => w.taskId)).toEqual(["parent", "loose"]);
    const [p1, p2] = plan.writes.map((w) => w.position ?? "");
    expect(p1 > "m" && p2 > p1).toBe(true);
    expect(plan.label(2, 0)).toBe("Moved 2 tasks to Website");
  });

  it("Section changes only the tasks of the section's project", () => {
    const a = task("a");
    const b = task("b", { bucketId: "p2" });
    const plan = planBulk(
      [a, b],
      { kind: "section", sectionId: "sec", projectId: "p1" },
      ctx([a, b]),
    );
    expect(plan.writes).toEqual([{ taskId: "a", sectionId: "sec" }]);
  });

  it("Date +1 day moves each from its own date; a dateless one becomes tomorrow", () => {
    const dated = task("dated", { dueDate: day(20), dueOn: "2026-10-20" });
    const none = task("none");
    const plan = planBulk(
      [dated, none],
      { kind: "date", to: { shift: 1 } },
      ctx([dated, none]),
    );
    expect(plan.writes).toEqual([
      { taskId: "dated", dueDate: day(21) },
      { taskId: "none", dueDate: day(15) },
    ]);
    expect(plan.label(2, 0)).toBe("Moved 2 tasks a day later");
  });

  it("Date on a repeat moves just this occurrence, unless the patterns are asked for", () => {
    const rule = { rrule: "FREQ=WEEKLY;BYDAY=WE", dtstart: null, nextOccurrence: null };
    const repeat = task("repeat", { dueDate: day(14), dueOn: "2026-10-14", recurrence: rule });
    const one = planBulk(
      [repeat],
      { kind: "date", to: { day: "2026-10-15" } },
      ctx([repeat]),
    );
    expect(one.writes).toEqual([{ taskId: "repeat", occurrenceOn: "2026-10-15" }]);
    expect(one.label(1, 0)).toBe("1 task due Tomorrow");
    const pattern = planBulk(
      [repeat],
      { kind: "date", to: { day: "2026-10-15" }, repeats: "pattern" },
      ctx([repeat]),
    );
    expect(pattern.writes[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(pattern.writes[0]?.dueDate).toBe(day(15));
  });

  it("places several after the task you held, before the next one", () => {
    const all = [task("a", { position: "a" }), task("b", { position: "b" }), task("c", { position: "c" })];
    const [p1, p2] = positionsAfter("a", 2, all, new Set(["c"]));
    expect(p1 > "a" && p2 > p1 && p2 < "b").toBe(true);
    const ends = endPositions(2, "p1", all, new Set());
    expect(ends[0] > "c" && ends[1] > ends[0]).toBe(true);
  });
});

describe("what the toast says (spec edge case: one read-only of four)", () => {
  it("names the one refused task and counts the rest", () => {
    const text = bulkResultText("Moved 4 tasks to Website", {
      changed: 3,
      total: 4,
      refused: [{ title: "Pricing copy", message: "You don't have access to this task." }],
    });
    expect(text).toEqual({
      title: "3 of 4 changed",
      description: "“Pricing copy” is read-only to you.",
    });
  });

  it("counts several refusals without naming them", () => {
    const text = bulkResultText("x", {
      changed: 1,
      total: 3,
      refused: [
        { title: "a", message: "Task not found in this workspace." },
        { title: "b", message: "Task not found in this workspace." },
      ],
    });
    expect(text.description).toBe("2 are read-only to you.");
  });

  it("says the change alone when every one saved", () => {
    expect(bulkResultText("Completed 4 tasks", { changed: 4, total: 4, refused: [] })).toEqual({
      title: "Completed 4 tasks",
    });
  });
});

describe("the panel's Mixed", () => {
  it("one shared value, or Mixed", () => {
    const a = task("a", { priority: "high" });
    const b = task("b", { priority: "high" });
    const c = task("c", { priority: null, bucketId: "p2" });
    expect(sharedValue([a, b], (t) => t.priority)).toEqual({ mixed: false, value: "high" });
    expect(sharedValue([a, c], (t) => t.priority)).toEqual({ mixed: true });
    expect(singleProject([a, b])).toBe("p1");
    expect(singleProject([a, c])).toBeNull();
  });
});
