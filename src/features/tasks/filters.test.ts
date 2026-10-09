// TV-U2 · U2-2, U2-5 — Tasks' Filter: every §7 dimension with is / is not /
// is any of, AND across dimensions, Archived and Done reachable through
// Status, the stored filters read back safely, and the capture seed.

import { describe, expect, it } from "@rstest/core";
import type { FilterCondition } from "../../components/ui/filter-model";
import {
  addFilterValue,
  captureSeed,
  filterTasks,
  sanitizeTaskFilters,
  showsArchived,
  showsDone,
  TASK_FILTER_DIMENSIONS,
  type TaskFilterContext,
  taskFilterShape,
  taskFilterValues,
} from "./filters";
import { makeTask } from "./helpers";
import type { Task } from "./model";

// Thursday 2026-10-08, 10:00 local.
const NOW = new Date(2026, 9, 8, 10, 0);
const day = (offset: number, hour = 9) => new Date(2026, 9, 8 + offset, hour, 0).toISOString();

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
    ...over,
  };
}

const TAGS: Record<string, string[]> = { a: ["t1"], b: ["t1", "t2"] };
const ctx: TaskFilterContext = {
  now: NOW,
  tagIdsOf: (id) => TAGS[id] ?? [],
  isQueued: (id) => id === "a",
  isBlocked: (id) => id === "b",
  hasSubtasks: (id) => id === "c",
  attachmentCount: (id) => (id === "b" ? 2 : 0),
};

const a = task("a", { priority: "high", energyLevel: "low", dueDate: day(0) });
const b = task("b", {
  assigneeId: "u2",
  creatorId: "u2",
  priority: "low",
  status: "in_progress",
  scheduledAt: day(-1),
  recurrence: { rrule: "FREQ=DAILY", dtstart: null, nextOccurrence: null },
});
const c = task("c", { assigneeId: null, status: "done", dueDate: day(-2), scheduledAt: day(2) });
const d = task("d", { creatorUnknown: true, creatorId: "", status: "archived" });
const ALL = [a, b, c, d];

const run = (conditions: FilterCondition[]) => filterTasks(ALL, conditions, ctx).map((t) => t.id);
const is = (dimension: string, ...values: string[]): FilterCondition => ({
  dimension,
  operator: values.length > 1 ? "any_of" : "is",
  values,
});
const isNot = (dimension: string, ...values: string[]): FilterCondition => ({
  dimension,
  operator: "is_not",
  values,
});

describe("Filter dimensions", () => {
  it("offers every §7 dimension; yes/no ones take one value under 'is'", () => {
    expect(TASK_FILTER_DIMENSIONS).toEqual([
      "assignee",
      "creator",
      "tag",
      "status",
      "priority",
      "energy",
      "due",
      "scheduled",
      "queued",
      "blocked",
      "recurring",
      "subtasks",
      "attachments",
    ]);
    expect(taskFilterShape("blocked")).toMatchObject({ operators: ["is"], multiple: false });
    expect(taskFilterShape("tag").operators).toBeUndefined();
  });

  it("Assignee: a member, Unassigned, is not, any of", () => {
    expect(run([is("assignee", "u1")])).toEqual(["a", "d"]);
    expect(run([is("assignee", "none")])).toEqual(["c"]);
    expect(run([isNot("assignee", "u1")])).toEqual(["b", "c"]);
    expect(run([is("assignee", "u2", "none")])).toEqual(["b", "c"]);
  });

  it("Creator: a creator lost before TV-D1 matches no one", () => {
    expect(run([is("creator", "u1")])).toEqual(["a", "c"]);
    expect(run([isNot("creator", "u1")])).toEqual(["b", "d"]);
  });

  it("Tag: any of its tags, and No tag", () => {
    expect(run([is("tag", "t2")])).toEqual(["b"]);
    expect(run([is("tag", "t1")])).toEqual(["a", "b"]);
    expect(run([isNot("tag", "t2")])).toEqual(["a", "c", "d"]);
    expect(run([is("tag", "none")])).toEqual(["c", "d"]);
    expect(run([is("tag", "t2", "none")])).toEqual(["b", "c", "d"]);
  });

  it("Status, including Archived", () => {
    expect(run([is("status", "archived")])).toEqual(["d"]);
    expect(run([is("status", "todo", "in_progress")])).toEqual(["a", "b"]);
    expect(run([isNot("status", "done")])).toEqual(["a", "b", "d"]);
  });

  it("Priority and Energy, with their unset values", () => {
    expect(run([is("priority", "high")])).toEqual(["a"]);
    expect(run([is("priority", "none")])).toEqual(["c", "d"]);
    expect(run([is("energy", "low")])).toEqual(["a"]);
    expect(run([isNot("energy", "none")])).toEqual(["a"]);
  });

  it("Due date: today, this week, earlier, no date", () => {
    expect(run([is("due", "today")])).toEqual(["a"]);
    expect(run([is("due", "week")])).toEqual(["a"]);
    expect(run([is("due", "earlier")])).toEqual(["c"]);
    expect(run([is("due", "none")])).toEqual(["b", "d"]);
    // Sunday is still this week; Monday isn't (weeks start on Monday).
    expect(taskFilterValues(task("x", { dueDate: day(3) }), "due", ctx)).toEqual(["week"]);
    expect(taskFilterValues(task("x", { dueDate: day(4) }), "due", ctx)).toEqual([]);
  });

  it("Scheduled: today, this week, none, drifted", () => {
    expect(run([is("scheduled", "drifted")])).toEqual(["b"]);
    expect(run([is("scheduled", "week")])).toEqual(["c"]);
    expect(run([is("scheduled", "none")])).toEqual(["a", "d"]);
    // A time that passed today is both Today and Drifted.
    const passed = task("x", { scheduledAt: day(0, 8) });
    expect(taskFilterValues(passed, "scheduled", ctx)).toEqual(["today", "week", "drifted"]);
    // A done task never drifts.
    const done = task("x", { scheduledAt: day(-1), status: "done" });
    expect(taskFilterValues(done, "scheduled", ctx)).toEqual([]);
  });

  it("the yes/no dimensions", () => {
    expect(run([is("queued", "yes")])).toEqual(["a"]);
    expect(run([is("queued", "no")])).toEqual(["b", "c", "d"]);
    expect(run([is("blocked", "yes")])).toEqual(["b"]);
    expect(run([is("recurring", "yes")])).toEqual(["b"]);
    expect(run([is("subtasks", "yes")])).toEqual(["c"]);
    expect(run([is("attachments", "yes")])).toEqual(["b"]);
    expect(run([is("attachments", "no")])).toEqual(["a", "c", "d"]);
  });

  it("combines dimensions with AND", () => {
    expect(run([is("tag", "t1"), is("priority", "low")])).toEqual(["b"]);
    expect(run([is("assignee", "u1"), isNot("status", "archived"), is("due", "today")])).toEqual([
      "a",
    ]);
    expect(run([])).toEqual(["a", "b", "c", "d"]);
  });
});

describe("Status brings hidden tasks back", () => {
  it("Archived joins the scope only when Status asks for it", () => {
    expect(showsArchived([is("status", "archived")])).toBe(true);
    expect(showsArchived([is("status", "todo", "archived")])).toBe(true);
    expect(showsArchived([isNot("status", "archived")])).toBe(false);
    expect(showsArchived([is("priority", "high")])).toBe(false);
  });

  it("asking for Done shows done tasks whatever Completed says", () => {
    expect(showsDone([is("status", "done")])).toBe(true);
    expect(showsDone([isNot("status", "done")])).toBe(false);
  });
});

describe("Stored filters", () => {
  it("keep well-formed conditions, normalised", () => {
    const stored = [
      { dimension: "tag", operator: "is", values: ["t1", "t2"] },
      { dimension: "blocked", operator: "is", values: ["no", "yes"] },
    ];
    expect(sanitizeTaskFilters(stored)).toEqual([
      { dimension: "tag", operator: "any_of", values: ["t1", "t2"] },
      // A yes/no dimension keeps one value.
      { dimension: "blocked", operator: "is", values: ["yes"] },
    ]);
  });

  it("drop junk, unknown dimensions and operators a dimension doesn't offer", () => {
    expect(sanitizeTaskFilters("junk")).toEqual([]);
    expect(
      sanitizeTaskFilters([
        { dimension: "mood", operator: "is", values: ["happy"] },
        { dimension: "tag", operator: "contains", values: ["t1"] },
        { dimension: "tag", operator: "is", values: [] },
        null,
      ]),
    ).toEqual([]);
    // "is not" isn't offered on a yes/no dimension: it falls back to "is".
    expect(
      sanitizeTaskFilters([{ dimension: "queued", operator: "is_not", values: ["yes"] }]),
    ).toEqual([{ dimension: "queued", operator: "is", values: ["yes"] }]);
  });
});

describe("addFilterValue (a #tag or @name typed in search)", () => {
  it("creates the condition, adds to it, never removes", () => {
    const one = addFilterValue([], "tag", "t1");
    expect(one).toEqual([{ dimension: "tag", operator: "is", values: ["t1"] }]);
    const two = addFilterValue(one, "tag", "t2");
    expect(two).toEqual([{ dimension: "tag", operator: "any_of", values: ["t1", "t2"] }]);
    expect(addFilterValue(two, "tag", "t1")).toEqual(two);
  });

  it("turns 'is not' into 'is' that value", () => {
    expect(addFilterValue([isNot("assignee", "u2")], "assignee", "u2")).toEqual([
      { dimension: "assignee", operator: "is", values: ["u2"] },
    ]);
  });
});

describe("captureSeed (U2-5)", () => {
  it("pre-fills the filter's tag, assignee and priority", () => {
    expect(captureSeed([is("tag", "t1"), is("assignee", "u2"), is("priority", "high")])).toEqual({
      tagIds: ["t1"],
      assigneeId: "u2",
      priority: "high",
    });
  });

  it("'is any of' gives its first value; 'is not' gives nothing", () => {
    expect(captureSeed([is("tag", "t2", "t1"), isNot("priority", "low")])).toEqual({
      tagIds: ["t2"],
    });
  });

  it("Unassigned and No priority seed as empty; No tag seeds nothing", () => {
    expect(
      captureSeed([is("assignee", "none"), is("priority", "none"), is("tag", "none")]),
    ).toEqual({ tagIds: [], assigneeId: null, priority: null });
  });

  it("other dimensions don't seed", () => {
    expect(captureSeed([is("status", "todo"), is("due", "today")])).toEqual({ tagIds: [] });
  });
});
