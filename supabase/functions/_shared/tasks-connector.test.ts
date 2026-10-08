import { describe, expect, it } from "@rstest/core";

import {
  DEFAULT_FOCUS_SETTINGS,
  MAX_PAGE,
  filterByAssignee,
  focusSettingsFrom,
  orderByBucket,
  pageOf,
  parseAssignee,
  queueTaskIds,
  shapeTask,
  subtaskCounts,
  topLevelOnly,
} from "./tasks-connector.ts";
import { FORMER_MEMBER } from "./task-people.ts";

// TV-D1: owner_id is the creator, assignee_id the assignee (null = Unassigned).
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  owner_id: "u1",
  assignee_id: "u1",
  creator_unknown: false,
  bucket_id: "b1",
  position: "",
  ...extra,
});

const names = new Map([
  ["u1", "Ada"],
  ["u2", "Bea"],
]);

const shapeData = (tasks: Record<string, any>[]) => ({
  byId: new Map(tasks.map((t) => [t.id as string, t])),
  blockedIds: new Set<string>(),
  taskTags: new Map<string, string[]>(),
  subtaskCounts: subtaskCounts(tasks),
  names,
});

describe("tasks connector helpers", () => {
  it("filters 'me' by the assignee, not the creator", () => {
    const tasks = [
      task("mine"),
      task("made-for-bea", { assignee_id: "u2" }),
      task("made-by-bea-for-me", { owner_id: "u2", assignee_id: "u1" }),
      task("unassigned", { assignee_id: null }),
    ];
    expect(filterByAssignee(tasks, "me", "u1").map((t) => t.id)).toEqual(["mine", "made-by-bea-for-me"]);
    expect(filterByAssignee(tasks, "me", "u2").map((t) => t.id)).toEqual(["made-for-bea"]);
    expect(filterByAssignee(tasks, "anyone", "u1").map((t) => t.id)).toEqual([
      "mine", "made-for-bea", "made-by-bea-for-me", "unassigned",
    ]);
    expect(parseAssignee("me")).toBe("me");
    expect(parseAssignee("everyone")).toBe("anyone");
    expect(parseAssignee(undefined)).toBe("anyone");
  });

  it("a row from before the TV-D1 migration counts owner_id as the assignee", () => {
    const legacy = [{ id: "old", owner_id: "u1" }, { id: "old-unowned", owner_id: null }];
    expect(filterByAssignee(legacy, "me", "u1").map((t) => t.id)).toEqual(["old"]);
  });

  it("shapes the assignee and the creator by name", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const tasks = [
      task("handed-over", { owner_id: "u1", assignee_id: "u2" }),
      task("unassigned", { assignee_id: null }),
      task("unknown-creator", { owner_id: "u2", assignee_id: "u2", creator_unknown: true }),
      task("left", { owner_id: "gone", assignee_id: "gone" }),
    ];
    const data = shapeData(tasks);
    const [handedOver, unassigned, unknownCreator, left] = tasks.map((t) => shapeTask(t, data, now));
    expect(handedOver).toMatchObject({
      assignee: { id: "u2", name: "Bea" },
      creator: { id: "u1", name: "Ada" },
    });
    // The flat assignee_id is the real assignee, not the creator, and null when Unassigned.
    expect(handedOver.assignee_id).toBe("u2");
    expect(unassigned.assignee_id).toBeNull();
    expect(unknownCreator.assignee_id).toBe("u2");
    expect(unassigned.assignee).toBeNull();
    expect(unassigned.creator).toEqual({ id: "u1", name: "Ada" });
    expect(unknownCreator.assignee).toEqual({ id: "u2", name: "Bea" });
    expect("creator" in unknownCreator).toBe(false);
    expect(left).toMatchObject({
      assignee: { id: "gone", name: FORMER_MEMBER },
      creator: { id: "gone", name: FORMER_MEMBER },
    });
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
    const data = { ...shapeData(tasks), blockedIds: new Set(["parent"]) };
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
      assignee: { id: "u1", name: "Ada" },
      creator: { id: "u1", name: "Ada" },
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

  it("lines up the key creator's queue by position, bytewise, skipping tasks it can't see (TV-D2)", () => {
    const rows = [
      { id: "q3", task_id: "t3", position: "0000018y68" },
      { id: "q1", task_id: "t1", position: "000000mh34" },
      // A subdivided key sorts right after its prefix.
      { id: "q2", task_id: "t2", position: "000000mh34i" },
      { id: "q4", task_id: "hidden", position: "000000000a" },
    ];
    expect(queueTaskIds(rows, new Set(["t1", "t2", "t3"]))).toEqual(["t1", "t2", "t3"]);
    expect(queueTaskIds([], new Set(["t1"]))).toEqual([]);
  });

  it("says queued_by_me only for the key creator's queue, and drops the shared day columns (TV-D2)", () => {
    const tasks = [
      task("queued", { committed_for: "2026-10-08", commit_order: 1 }),
      task("not-queued", { committed_for: "2026-10-08", commit_order: 2 }),
    ];
    const data = { ...shapeData(tasks), queuedByMe: new Set(["queued"]) };
    const now = new Date("2026-10-08T12:00:00Z");
    const queued = shapeTask(tasks[0]!, data, now);
    const other = shapeTask(tasks[1]!, data, now);
    expect(queued.queued_by_me).toBe(true);
    expect("queued_by_me" in other).toBe(false);
    expect("committed_for" in queued || "commit_order" in queued).toBe(false);
    // Without a queue at all (a caller that didn't load it), nothing is claimed.
    expect("queued_by_me" in shapeTask(tasks[0]!, shapeData(tasks), now)).toBe(false);
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
});
