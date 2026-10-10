// TV-U1 + TV-U2 — the Tasks Display value as stored per workspace and scope
// (layout, group, the Board's group, order, completed, subtasks, the Rows
// preset, row properties, plus the scope's filters), the controls each scope
// offers, the Order by rules and the Group by set (tasks-v3 default l, calls
// 83, 84: AC11.2, AC11.3).

import { describe, expect, it } from "@rstest/core";
import {
  GROUP_LABELS,
  orderTasks,
  sanitizeTasksView,
  TASKS_DISPLAY_DEFAULTS,
  tasksDisplayControls,
  tasksDisplayDefaults,
  tasksDisplayKey,
  tasksViewDefaults,
} from "./display";
import { dateGroupOf, groupTasks, makeTask } from "./helpers";
import type { Task } from "./model";

// Thursday 2026-10-08, 10:00 local.
const NOW = new Date(2026, 9, 8, 10, 0);
const day = (offset: number, hour = 9) => new Date(2026, 9, 8 + offset, hour, 0).toISOString();

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    ...over,
  };
}

const ids = (tasks: readonly Task[]) => tasks.map((t) => t.id);

describe("Tasks Display — stored value", () => {
  it("defaults: Standard rows, the Board by status; All by project, My tasks by status", () => {
    expect(TASKS_DISPLAY_DEFAULTS).toEqual({
      layout: "list",
      group: "none",
      boardGroup: "status",
      order: "manual",
      completed: "hidden",
      subtasks: "nested",
      rows: "standard",
      properties: ["priority", "date", "assignee"],
    });
    expect(tasksDisplayDefaults("all").group).toBe("bucket");
    // Call 84: My tasks answers "what am I in the middle of".
    expect(tasksDisplayDefaults("mine").group).toBe("status");
    expect(tasksDisplayDefaults("b-42").group).toBe("none");
    expect(tasksDisplayDefaults("inbox").group).toBe("none");
  });

  it("a scope without a stored layout starts with the old workspace-wide one", () => {
    expect(tasksViewDefaults("b1", "board").layout).toBe("board");
    expect(tasksViewDefaults("b1").layout).toBe("list");
    expect(tasksViewDefaults("b1").filters).toEqual([]);
  });

  it("keeps every stored choice it still offers, filters included", () => {
    const stored = {
      layout: "board",
      group: "date",
      boardGroup: "bucket",
      order: "priority",
      completed: "week",
      subtasks: "flat",
      rows: "detailed",
      properties: ["energy", "priority"],
      filters: [{ dimension: "priority", operator: "is", values: ["high"] }],
    };
    expect(sanitizeTasksView(stored, tasksViewDefaults("all"), "all")).toEqual({
      ...stored,
      // Toggles come back in the menu's order.
      properties: ["priority", "energy"],
    });
  });

  it("falls back to the defaults for anything it doesn't know", () => {
    const stored = {
      layout: "gallery",
      group: "mood",
      order: "random",
      completed: "forever",
      subtasks: "deep",
      rows: "compact",
      properties: ["priority", "mood"],
      filters: [{ dimension: "mood", operator: "is", values: ["happy"] }, "junk"],
    };
    expect(sanitizeTasksView(stored, tasksViewDefaults("b1"), "b1")).toEqual({
      ...TASKS_DISPLAY_DEFAULTS,
      properties: ["priority"],
      filters: [],
    });
    expect(sanitizeTasksView("junk", tasksViewDefaults("b1"), "b1")).toEqual(
      tasksViewDefaults("b1"),
    );
  });

  it("project grouping only across projects, even from storage (List and Board)", () => {
    const stored = { group: "bucket", boardGroup: "bucket" };
    const one = sanitizeTasksView(stored, tasksViewDefaults("b1"), "b1");
    expect([one.group, one.boardGroup]).toEqual(["none", "status"]);
    const all = sanitizeTasksView(stored, tasksViewDefaults("all"), "all");
    expect([all.group, all.boardGroup]).toEqual(["bucket", "bucket"]);
  });

  it("v2's groupings (Tag, Energy, Time, Due, Scheduled) fall back to the scope's default", () => {
    for (const group of ["tag", "energy", "time", "due", "scheduled"]) {
      expect(sanitizeTasksView({ group }, tasksViewDefaults("mine"), "mine").group).toBe("status");
    }
  });

  it("is remembered per workspace and scope", () => {
    expect(tasksDisplayKey("w1", "inbox")).toBe("moduo:tasks:view:w1:inbox");
    expect(tasksDisplayKey("w1", "b-42")).toBe("moduo:tasks:view:w1:b-42");
    expect(tasksDisplayKey("", "inbox")).toBeNull();
  });
});

describe("Tasks Display — controls per scope and layout", () => {
  const controlIds = (scope: string, layout?: "list" | "board" | "timeline") =>
    tasksDisplayControls(scope, layout).map((c) => c.id);

  it("the List: layout, group, order, completed, subtasks, rows, row properties", () => {
    expect(controlIds("inbox", "list")).toEqual([
      "layout",
      "group",
      "order",
      "completed",
      "subtasks",
      "rows",
      "properties",
    ]);
  });

  it("Rows is Standard · Detailed", () => {
    const rows = tasksDisplayControls("b1", "list").find((c) => c.id === "rows");
    expect(rows?.label).toBe("Rows");
    expect(rows?.options.map((o) => o.label)).toEqual(["Standard", "Detailed"]);
  });

  it("Group by: Status · Priority · Assignee · Date · Project · None, never Tag or Energy", () => {
    const groups = (scope: string) => {
      const control = tasksDisplayControls(scope, "list").find((c) => c.id === "group");
      return control?.options.map((o) => o.label);
    };
    expect(groups("all")).toEqual(["Status", "Priority", "Assignee", "Date", "Project", "None"]);
    // Project only across projects.
    expect(groups("b1")).toEqual(["Status", "Priority", "Assignee", "Date", "None"]);
    const every = Object.values(GROUP_LABELS);
    for (const gone of ["Tag", "Energy", "Time", "Due date", "Scheduled", "Bucket"]) {
      expect(every).not.toContain(gone);
    }
  });

  it("the Board says Group by, never Columns (across projects only)", () => {
    expect(controlIds("all", "board")).toEqual([
      "layout",
      "boardGroup",
      "order",
      "completed",
      "subtasks",
      "properties",
    ]);
    const control = tasksDisplayControls("all", "board").find((c) => c.id === "boardGroup");
    expect(control?.label).toBe("Group by");
    expect(control?.options.map((o) => o.label)).toEqual(["Status", "Project"]);
    expect(controlIds("b1", "board")).not.toContain("boardGroup");
    const labels = (scope: string, layout: "list" | "board") =>
      tasksDisplayControls(scope, layout).map((c) => c.label);
    for (const layout of ["list", "board"] as const) {
      expect(labels("all", layout)).not.toContain("Columns");
    }
  });

  it("the Queue is a line-up (no Completed choice: done leaves the queue)", () => {
    expect(controlIds("today", "list")).toEqual(["layout", "rows", "properties"]);
    expect(controlIds("today", "board")).toEqual(["layout", "properties"]);
  });

  it("the Timeline keeps its own rules", () => {
    expect(controlIds("inbox", "timeline")).toEqual(["layout"]);
  });
});

describe("Order by", () => {
  const a = task("a", {
    dueDate: day(3),
    scheduledAt: null,
    priority: "low",
    createdAt: day(-3),
    updatedAt: day(-1),
  });
  const b = task("b", {
    dueDate: null,
    scheduledAt: day(1),
    priority: "high",
    createdAt: day(-1),
    updatedAt: day(-5),
  });
  const c = task("c", {
    dueDate: day(1),
    scheduledAt: day(2),
    priority: null,
    createdAt: day(-2),
    updatedAt: day(-2),
  });
  const list = [a, b, c];

  it("Manual keeps the incoming (position) order", () => {
    expect(ids(orderTasks(list, "manual"))).toEqual(["a", "b", "c"]);
  });

  it("dates run earliest first, no date last", () => {
    expect(ids(orderTasks(list, "due"))).toEqual(["c", "a", "b"]);
    expect(ids(orderTasks(list, "scheduled"))).toEqual(["b", "c", "a"]);
  });

  it("priority runs high to none", () => {
    expect(ids(orderTasks(list, "priority"))).toEqual(["b", "a", "c"]);
  });

  it("Created and Updated run newest first", () => {
    expect(ids(orderTasks(list, "created"))).toEqual(["b", "c", "a"]);
    expect(ids(orderTasks(list, "updated"))).toEqual(["a", "c", "b"]);
  });

  it("ties keep the manual order", () => {
    const x = task("x", { priority: "high" });
    const y = task("y", { priority: "high" });
    expect(ids(orderTasks([x, y], "priority"))).toEqual(["x", "y"]);
  });
});

describe("Group by", () => {
  const ctx = { bucketName: (id: string) => id.toUpperCase(), now: NOW };
  const groupsOf = (tasks: Task[], by: Parameters<typeof groupTasks>[1], extra = {}) =>
    groupTasks(tasks, by, { ...ctx, ...extra }).map((g) => [g.label, ids(g.tasks)]);

  it("Date: Earlier · Today · Tomorrow · the next five day names · Later · No date", () => {
    // Thursday 8 Oct: the five names run Saturday to Wednesday.
    const tasks = [
      task("none"),
      task("later", { dueDate: day(7) }),
      task("wed", { scheduledAt: day(6) }),
      task("sat", { dueDate: day(2) }),
      task("mon", { dueDate: day(4) }),
      task("tomorrow", { dueDate: day(1) }),
      task("today", { scheduledAt: day(0, 8) }),
      task("earlier", { dueDate: day(-2) }),
      // The row's date: whichever of the two comes first by day.
      task("both", { dueDate: day(9), scheduledAt: day(1) }),
    ];
    expect(groupsOf(tasks, "date")).toEqual([
      ["Earlier", ["earlier"]],
      ["Today", ["today"]],
      ["Tomorrow", ["tomorrow", "both"]],
      ["Saturday", ["sat"]],
      ["Monday", ["mon"]],
      ["Wednesday", ["wed"]],
      ["Later", ["later"]],
      ["No date", ["none"]],
    ]);
  });

  it("Date is rolling: no This week, the same five names on any weekday", () => {
    // A Saturday: This week would be one day long; the next five still have names.
    const saturday = new Date(2026, 9, 10, 10, 0);
    const at = (offset: number) => new Date(2026, 9, 10 + offset, 9, 0).toISOString();
    const groups = [1, 2, 3, 4, 5, 6, 7].map((offset) =>
      dateGroupOf({ scheduledAt: null, dueDate: at(offset) }, saturday),
    );
    expect(groups).toEqual(["tomorrow", "day2", "day3", "day4", "day5", "day6", "later"]);
    const labels = groupTasks(
      [2, 3, 4, 5, 6].map((offset) => task(`d${offset}`, { dueDate: at(offset) })),
      "date",
      { bucketName: (id) => id, now: saturday },
    ).map((g) => g.label);
    expect(labels).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  });

  it("Status: In progress first, then To do, Done, Won't do (the labels everyone reads)", () => {
    const tasks = [
      task("w", { status: "archived" }),
      task("d", { status: "done" }),
      task("t"),
      task("p", { status: "in_progress" }),
    ];
    expect(groupsOf(tasks, "status")).toEqual([
      ["In progress", ["p"]],
      ["To do", ["t"]],
      ["Done", ["d"]],
      ["Won’t do", ["w"]],
    ]);
  });

  it("Priority: high, medium, low, then unset", () => {
    const tasks = [
      task("u"),
      task("l", { priority: "low" }),
      task("h", { priority: "high" }),
      task("m", { priority: "medium" }),
    ];
    expect(groupsOf(tasks, "priority")).toEqual([
      ["High priority", ["h"]],
      ["Medium priority", ["m"]],
      ["Low priority", ["l"]],
      ["Unset", ["u"]],
    ]);
  });

  it("Assignee: members in picker order, former members, then Unassigned", () => {
    const tasks = [
      task("u", { assigneeId: null }),
      task("x", { assigneeId: "gone" }),
      task("mike", { assigneeId: "u2" }),
      task("me", { assigneeId: "u1" }),
    ];
    const assignees = [
      { userId: "u1", name: "Me" },
      { userId: "u2", name: "Mike" },
    ];
    expect(groupsOf(tasks, "assignee", { assignees })).toEqual([
      ["Me", ["me"]],
      ["Mike", ["mike"]],
      ["Former member", ["x"]],
      ["Unassigned", ["u"]],
    ]);
  });

  it("Project groups follow the rail, not the order tasks arrive in", () => {
    const tasks = [task("x", { bucketId: "b2" }), task("y", { bucketId: "inbox" })];
    expect(groupsOf(tasks, "bucket", { bucketOrder: ["inbox", "b1", "b2"] })).toEqual([
      ["INBOX", ["y"]],
      ["B2", ["x"]],
    ]);
  });

  it("sorting first keeps the order inside every group", () => {
    const tasks = orderTasks(
      [task("a", { status: "todo", priority: "low" }), task("b", { priority: "high" })],
      "priority",
    );
    expect(groupsOf(tasks, "status")).toEqual([["To do", ["b", "a"]]]);
  });
});
