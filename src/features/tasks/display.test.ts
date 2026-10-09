// TV-U1 + TV-U2 (U2-3) — the Tasks Display value as stored per workspace and
// scope (layout, group, columns, order, completed, subtasks, row properties,
// plus the scope's filters), the controls each scope offers, the Order by
// rules and the Group by groupings (Time and Energy included).

import { describe, expect, it } from "@rstest/core";
import { dayGroupKey, timeGroupOf } from "./day-buckets";
import {
  orderTasks,
  sanitizeTasksView,
  TASKS_DISPLAY_DEFAULTS,
  tasksDisplayControls,
  tasksDisplayDefaults,
  tasksDisplayKey,
  tasksViewDefaults,
} from "./display";
import { groupTasks, makeTask } from "./helpers";
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
  it("defaults: list, no grouping in one bucket, bucket grouping across buckets", () => {
    expect(TASKS_DISPLAY_DEFAULTS).toEqual({
      layout: "list",
      group: "none",
      columns: "status",
      order: "manual",
      completed: "hidden",
      subtasks: "nested",
      properties: ["priority", "date", "assignee"],
    });
    expect(tasksDisplayDefaults("all").group).toBe("bucket");
    expect(tasksDisplayDefaults("mine").group).toBe("bucket");
    expect(tasksDisplayDefaults("b-42").group).toBe("none");
  });

  it("a scope without a stored layout starts with the old workspace-wide one", () => {
    expect(tasksViewDefaults("b1", "board").layout).toBe("board");
    expect(tasksViewDefaults("b1").layout).toBe("list");
    expect(tasksViewDefaults("b1").filters).toEqual([]);
  });

  it("keeps every stored choice it still offers, filters included", () => {
    const stored = {
      layout: "board",
      group: "time",
      columns: "bucket",
      order: "priority",
      completed: "week",
      subtasks: "flat",
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

  it("bucket grouping only across buckets, even from storage", () => {
    const stored = { group: "bucket" };
    expect(sanitizeTasksView(stored, tasksViewDefaults("b1"), "b1").group).toBe("none");
    expect(sanitizeTasksView(stored, tasksViewDefaults("all"), "all").group).toBe("bucket");
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

  it("the List: layout, group, order, completed, subtasks, row properties", () => {
    expect(controlIds("inbox", "list")).toEqual([
      "layout",
      "group",
      "order",
      "completed",
      "subtasks",
      "properties",
    ]);
  });

  it("offers Bucket grouping only across buckets, and every §7 grouping", () => {
    const groups = (scope: string) => {
      const control = tasksDisplayControls(scope, "list").find((c) => c.id === "group");
      return control?.options.map((o) => o.value);
    };
    expect(groups("all")).toEqual([
      "none",
      "status",
      "bucket",
      "assignee",
      "priority",
      "energy",
      "tag",
      "due",
      "scheduled",
      "time",
    ]);
    expect(groups("b1")).not.toContain("bucket");
  });

  it("the Board picks columns (across buckets only); one bucket's board is by status", () => {
    expect(controlIds("all", "board")).toEqual([
      "layout",
      "columns",
      "order",
      "completed",
      "subtasks",
      "properties",
    ]);
    expect(controlIds("b1", "board")).not.toContain("columns");
  });

  it("the Queue is a line-up (no Completed choice: done leaves the queue)", () => {
    expect(controlIds("today", "list")).toEqual(["layout", "properties"]);
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

  it("Energy: high, medium, low, then unset", () => {
    const tasks = [
      task("u"),
      task("l", { energyLevel: "low" }),
      task("h", { energyLevel: "high" }),
      task("m", { energyLevel: "medium" }),
    ];
    expect(groupsOf(tasks, "energy")).toEqual([
      ["High energy", ["h"]],
      ["Medium energy", ["m"]],
      ["Low energy", ["l"]],
      ["Unset", ["u"]],
    ]);
  });

  it("Time: Earlier · Today · Tomorrow · This week · Later · No date, by the row's date", () => {
    // Thursday: "This week" is Saturday and Sunday.
    const tasks = [
      task("none"),
      task("later", { dueDate: day(10) }),
      task("week", { scheduledAt: day(3) }),
      task("tomorrow", { dueDate: day(1) }),
      task("today", { scheduledAt: day(0, 8) }),
      task("earlier", { dueDate: day(-2) }),
      // The earlier of the two dates wins.
      task("both", { dueDate: day(9), scheduledAt: day(1) }),
    ];
    expect(groupsOf(tasks, "time")).toEqual([
      ["Earlier", ["earlier"]],
      ["Today", ["today"]],
      ["Tomorrow", ["tomorrow", "both"]],
      ["This week", ["week"]],
      ["Later", ["later"]],
      ["No date", ["none"]],
    ]);
    expect(timeGroupOf({ scheduledAt: null, dueDate: day(4) }, NOW)).toBe("later");
  });

  it("Due date and Scheduled: one group per day, Earlier first, no date last", () => {
    const tasks = [
      task("none"),
      task("fri", { dueDate: day(1) }),
      task("past", { dueDate: day(-3) }),
      task("thu", { dueDate: day(0) }),
      task("fri2", { dueDate: day(1, 18) }),
    ];
    expect(groupsOf(tasks, "due")).toEqual([
      ["Earlier", ["past"]],
      ["Today", ["thu"]],
      ["Tomorrow", ["fri", "fri2"]],
      ["No due date", ["none"]],
    ]);
    expect(groupsOf([task("s", { scheduledAt: day(1) }), task("n")], "scheduled")).toEqual([
      ["Tomorrow", ["s"]],
      ["Not scheduled", ["n"]],
    ]);
    expect(dayGroupKey(day(1), NOW)).toBe("d:2026-10-09");
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

  it("Tag: by tag name, a task under each of its tags, untagged last", () => {
    const tags: Record<string, Array<{ id: string; name: string }>> = {
      both: [
        { id: "t2", name: "ux" },
        { id: "t1", name: "bug" },
      ],
      one: [{ id: "t1", name: "bug" }],
    };
    const tasks = [task("both"), task("one"), task("none")];
    expect(groupsOf(tasks, "tag", { tagsFor: (id: string) => tags[id] ?? [] })).toEqual([
      ["bug", ["both", "one"]],
      ["ux", ["both"]],
      ["No tag", ["none"]],
    ]);
  });

  it("Bucket groups follow the rail, not the order tasks arrive in", () => {
    const tasks = [task("x", { bucketId: "b2" }), task("y", { bucketId: "inbox" })];
    expect(groupsOf(tasks, "bucket", { bucketOrder: ["inbox", "b1", "b2"] })).toEqual([
      ["INBOX", ["y"]],
      ["B2", ["x"]],
    ]);
  });

  it("sorting first keeps the order inside every group", () => {
    const tasks = orderTasks(
      [
        task("a", { energyLevel: "high", priority: "low" }),
        task("b", { energyLevel: "high", priority: "high" }),
      ],
      "priority",
    );
    expect(groupsOf(tasks, "energy")).toEqual([["High energy", ["b", "a"]]]);
  });
});
