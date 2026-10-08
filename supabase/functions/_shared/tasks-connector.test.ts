import { describe, expect, it } from "@rstest/core";

import {
  DEFAULT_FOCUS_SETTINGS,
  MAX_LOG_SECONDS,
  MAX_PAGE,
  filterByAssignee,
  focusSettingsFrom,
  orderByBucket,
  pageOf,
  parseAssignee,
  parseLogSeconds,
  shapeTask,
  subtaskCounts,
  topLevelOnly,
  validateReorder,
} from "./tasks-connector.ts";

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  owner_id: "u1",
  bucket_id: "b1",
  position: "",
  ...extra,
});

describe("tasks connector helpers", () => {
  it("filters by assignee", () => {
    const tasks = [task("a"), task("b", { owner_id: "u2" }), task("c", { owner_id: null })];
    expect(filterByAssignee(tasks, "me", "u1").map((t) => t.id)).toEqual(["a"]);
    expect(filterByAssignee(tasks, "anyone", "u1").map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(parseAssignee("me")).toBe("me");
    expect(parseAssignee("everyone")).toBe("anyone");
    expect(parseAssignee(undefined)).toBe("anyone");
  });

  it("shapes subtasks, drift, blocked, recurrence", () => {
    const tasks = [
      task("parent"),
      task("kid1", { parent_id: "parent" }),
      task("kid2", { parent_id: "parent" }),
      task("orphan", { parent_id: "hidden" }),
    ];
    const visible = new Set(tasks.map((t) => t.id));
    expect(topLevelOnly(tasks, visible).map((t) => t.id)).toEqual(["parent", "orphan"]);
    expect(subtaskCounts(tasks).get("parent")).toBe(2);
    expect(subtaskCounts(tasks).get("orphan")).toBeUndefined();

    const now = new Date("2026-10-08T12:00:00Z");
    const data = {
      byId: new Map(tasks.map((t) => [t.id, t as Record<string, any>])),
      blockedIds: new Set(["parent"]),
      taskTags: new Map<string, string[]>(),
      subtaskCounts: subtaskCounts(tasks),
    };
    const shaped = shapeTask(
      {
        ...tasks[0],
        status: "todo",
        scheduled_at: "2026-10-05T09:00:00Z",
        recurrence: { rrule: "FREQ=DAILY", nextOccurrence: "2026-10-09" },
      },
      data,
      now,
    );
    expect(shaped).toMatchObject({
      id: "parent",
      assignee_id: "u1",
      subtask_count: 2,
      drifted: true,
      blocked: true,
      recurrence: { rrule: "FREQ=DAILY", next_occurrence: "2026-10-09" },
    });
    const kid = shapeTask(tasks[1], data, now);
    expect(kid).toMatchObject({ parent_id: "parent", drifted: false, blocked: false });
    expect(kid.subtask_count).toBeUndefined();
    expect(shapeTask({ ...tasks[0], status: "done", scheduled_at: "2026-10-05T09:00:00Z" }, data, now).drifted).toBe(false);
  });

  it("keeps subtasks whose parent is filtered out as top-level", () => {
    const tasks = [task("sub", { parent_id: "done-parent" }), task("p2"), task("sub2", { parent_id: "p2" })];
    expect(topLevelOnly(tasks, new Set(tasks.map((t) => t.id))).map((t) => t.id)).toEqual(["sub", "p2"]);
    expect(subtaskCounts([task("a", { parent_id: "p" }), task("b", { parent_id: "p", status: "archived" })]).get("p")).toBe(1);
  });

  it("pins Inbox first and keeps group sections together", () => {
    const buckets = [
      { id: "legacy", position: "00" },
      { id: "inbox", position: "a0", is_system: true },
      { id: "g1a", position: "b", group_label: "Work" },
      { id: "plain", position: "c" },
      { id: "g1b", position: "d", group_label: "Work" },
    ];
    const tasks = buckets.map((b) => task(`t-${b.id}`, { bucket_id: b.id }));
    expect(orderByBucket(tasks, buckets).map((t) => t.id)).toEqual([
      "t-inbox", "t-legacy", "t-plain", "t-g1a", "t-g1b",
    ]);
  });

  it("orders by bucket position", () => {
    const buckets = [
      { id: "later", position: "b" },
      { id: "first", position: "a" },
    ];
    const tasks = [
      task("t1", { bucket_id: "later", position: "a" }),
      task("t2", { bucket_id: "first", position: "b" }),
      task("t3", { bucket_id: "first", position: "a" }),
      task("t4", { bucket_id: "unknown" }),
    ];
    expect(orderByBucket(tasks, buckets).map((t) => t.id)).toEqual(["t3", "t2", "t1", "t4"]);
  });

  it("pages past 200", () => {
    const all = Array.from({ length: 450 }, (_, i) => i);
    const pages: number[][] = [];
    for (let offset = 0; ; offset += MAX_PAGE) {
      const page = pageOf(all, offset, MAX_PAGE);
      pages.push(page);
      if (page.length < MAX_PAGE) break;
    }
    expect(pages.map((p) => p.length)).toEqual([200, 200, 50]);
    expect(pages.flat()).toEqual(all);
    expect(pageOf(all, -5, 3)).toEqual([0, 1, 2]);
    expect(pageOf(all, "x", 3)).toEqual([0, 1, 2]);
  });

  it("fills Focus settings with the app's defaults", () => {
    expect(focusSettingsFrom({})).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(focusSettingsFrom(null)).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(
      focusSettingsFrom({ workMinutes: 50, longBreakMinutes: 999, autoStartNext: true, soundEnabled: "x" }),
    ).toEqual({
      ...DEFAULT_FOCUS_SETTINGS,
      work_minutes: 50,
      long_break_minutes: 180,
      auto_start_next: true,
    });
  });

  it("validates reorder and time log input", () => {
    expect(validateReorder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
    expect(() => validateReorder(["a", "b"], ["a"])).toThrow(/missing/);
    expect(() => validateReorder(["a", "b"], ["a", "b", "x"])).toThrow(/not in that day's queue/);
    expect(() => validateReorder(["a", "b"], ["a", "a", "b"])).toThrow(/more than once/);
    expect(() => validateReorder(["a"], "a")).toThrow(/list/);
    expect(parseLogSeconds(1)).toBe(1);
    expect(parseLogSeconds(MAX_LOG_SECONDS)).toBe(14400);
    for (const bad of [0, -5, 14401, 1.5, "60", null]) expect(() => parseLogSeconds(bad)).toThrow();
  });
});
