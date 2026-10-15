import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

  it("says queued_by_me only for the key creator's queue; the shared day columns stay until TV-D7 (TV-D2)", () => {
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
    expect(other.committed_for).toBe("2026-10-08");
    expect(other.commit_order).toBe(2);
    // Without a queue at all (a caller that didn't load it), nothing is claimed.
    expect("queued_by_me" in shapeTask(tasks[0]!, shapeData(tasks), now)).toBe(false);
  });

  it("answers descriptions as Markdown, an older HTML one too, and cuts an excerpt before a link (call #15, MOD-120)", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const html =
      '<p class="mb-2 last:mb-0"><span style="white-space: pre-wrap;">Currently reads as asterisks. </span><b><strong class="font-semibold" style="white-space: pre-wrap;">Example</strong></b><span style="white-space: pre-wrap;"> attached.</span></p>' +
      `<p class="mb-2 last:mb-0"><span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${id}">Secret title</span></p>`;
    const markdown = "**Adding an issue**\n- Put it in **Triage**.";
    const long = `${"x".repeat(270)} [task](moduo://task/${id}) more`;
    const tasks = [
      task("html", { description: html }),
      task("md", { description: markdown }),
      task("long", { description: long }),
    ];
    const data = shapeData(tasks);
    const now = new Date("2026-10-15T12:00:00Z");
    const full = shapeTask(tasks[0]!, data, now, true);
    expect(full.description).toBe(
      `Currently reads as asterisks. **Example** attached.\n\n[task](moduo://task/${id})`,
    );
    expect(full.description).not.toContain("<");
    expect(full.description).not.toContain("Secret");
    // Markdown is answered as it is stored.
    expect(shapeTask(tasks[1]!, data, now, true).description).toBe(markdown);
    // tasks_list's excerpt (280) never ends in half a reference.
    expect(shapeTask(tasks[2]!, data, now).description).toBe("x".repeat(270));
    expect(shapeTask(tasks[2]!, data, now, true).description).toBe(long);
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

describe("tasks_list's summary row (MOD-113)", () => {
  const now = new Date("2030-01-10T12:00:00Z");
  const names2 = {
    sections: new Map([["s1", "Design"]]),
    statuses: new Map([
      ["st-review", "In review"],
      ["st-doing", "In progress"],
    ]),
    projects: new Map([["b1", "Launch"]]),
  };
  const rows = [
    task("parent", {
      number: 1,
      title: "Ship",
      status: "in_progress",
      status_category: "in_progress",
      status_id: "st-review",
      priority: "high",
      section_id: "s1",
      due_on: "2030-01-12",
      due_time: "09:30:00",
      description: "x".repeat(500),
    }),
    task("sub", {
      number: 2,
      title: "Write",
      parent_id: "parent",
      status: "in_progress",
      status_category: "in_progress",
      status_id: "st-doing",
      assignee_id: null,
      scheduled_at: "2030-01-09T09:00:00Z",
      due_date: "2030-01-15T12:00:00Z",
    }),
    task("old", { number: 3, title: "Old row", status: "archived", assignee_id: "gone" }),
  ];
  const data = {
    ...shapeData(rows),
    blockedIds: new Set(["parent"]),
    taskTags: new Map([["parent", ["mcp"]]]),
    queuedByMe: new Set(["sub"]),
    taskKey: "MOD",
  };

  it("names things, keeps flags only when true, and leaves the long fields out", async () => {
    const { shapeTaskSummary } = await import("./tasks-connector.ts");
    expect(shapeTaskSummary(rows[0]!, data, now, names2)).toEqual({
      handle: "MOD-1",
      id: "parent",
      title: "Ship",
      status: "in_progress",
      status_name: "In review",
      priority: "high",
      assignee: "Ada",
      project: "Launch",
      section: "Design",
      tags: ["mcp"],
      due: "2030-01-12 09:30",
      blocked: true,
      subtasks: 1,
    });
    // A default status name isn't repeated; Unassigned has no assignee; an
    // older due date reads as its day; the parent is named by its handle.
    expect(shapeTaskSummary(rows[1]!, data, now, names2)).toEqual({
      handle: "MOD-2",
      id: "sub",
      title: "Write",
      status: "in_progress",
      project: "Launch",
      due: "2030-01-15",
      drifted: true,
      queued_by_me: true,
      parent: "MOD-1",
    });
    // A legacy row reads its status as a category; a former member keeps their tasks.
    expect(shapeTaskSummary(rows[2]!, data, now, { ...names2, projects: undefined })).toEqual({
      handle: "MOD-3",
      id: "old",
      title: "Old row",
      status: "wont_do",
      assignee: FORMER_MEMBER,
    });
  });

  it("is a fraction of the full shape", async () => {
    const { shapeTaskSummary } = await import("./tasks-connector.ts");
    const size = (x: unknown) => JSON.stringify(x, null, 2).length;
    const summary = rows.map((t) => shapeTaskSummary(t, data, now, names2));
    const full = rows.map((t) => shapeTask(t, data, now));
    expect(size(summary) * 2).toBeLessThan(size(full));
  });
});

describe("a due day from a due instant: the server's tasks__due_on_of rule", () => {
  it("keeps a local midnight on its own date across a UTC midnight, and noon UTC on its date", async () => {
    const { dueDayOfInstant, dueDayOfRow } = await import("./tasks-connector.ts");
    // Jan 15's local midnight in UTC+1 is still Jan 14 in UTC.
    expect(dueDayOfInstant("2030-01-14T23:00:00Z")).toBe("2030-01-15");
    // Noon UTC, due_on's mirror, is its own date.
    expect(dueDayOfInstant("2030-01-15T12:00:00Z")).toBe("2030-01-15");
    // Jan 15's local midnight in UTC-5.
    expect(dueDayOfInstant("2030-01-15T05:00:00Z")).toBe("2030-01-15");
    expect(dueDayOfInstant("2030-01-15T00:00:00Z")).toBe("2030-01-15");
    expect(dueDayOfInstant("not a date")).toBeNull();
    expect(dueDayOfInstant(null)).toBeNull();
    // due_on leads when it's there.
    expect(dueDayOfRow({ due_on: "2030-01-20", due_date: "2030-01-14T23:00:00Z" })).toBe("2030-01-20");
  });

  it("a timed task with only a due_date shows its day across a UTC midnight", async () => {
    const { shapeTaskSummary } = await import("./tasks-connector.ts");
    const row = task("t", { number: 9, title: "x", status: "todo", due_date: "2030-01-14T23:00:00Z", due_time: "18:00:00" });
    const data = { ...shapeData([row]), taskKey: "MOD" };
    const out = shapeTaskSummary(row, data, new Date("2030-01-01T00:00:00Z"), {
      sections: new Map(),
      statuses: new Map(),
    });
    expect(out.due).toBe("2030-01-15 18:00");
  });

  it("is the rule the migration states", () => {
    const sql = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations/20261010171000_tasks_completion_due_on.sql"),
      "utf8",
    );
    expect(sql).toContain("WHEN (p_at AT TIME ZONE 'UTC')::time = time '12:00' THEN (p_at AT TIME ZONE 'UTC')::date");
    expect(sql).toContain("ELSE ((p_at + interval '12 hours') AT TIME ZONE 'UTC')::date");
  });
});

describe("a task's comments as agents read them (MOD-94)", () => {
  it("names a person, marks an app, says when it was edited", async () => {
    const { commentsInOrder, shapeComment } = await import("./tasks-connector.ts");
    const at = "2030-01-01T10:00:00Z";
    expect(shapeComment({ id: "c1", created_by: "u2", author_kind: "user", body: "Yes", created_at: at }, names))
      .toEqual({ id: "c1", author: "Bea", at, body: "Yes" });
    const app = {
      id: "c2",
      created_by: "u1",
      author_kind: "api_key",
      author_label: "Claude Code",
      body: "Q?",
      created_at: at,
      edited_at: at,
    };
    expect(shapeComment(app, names)).toEqual({ id: "c2", author: "Claude Code (app)", at, edited: true, body: "Q?" });
    expect(shapeComment({ id: "c3", created_by: "gone", body: null, created_at: at }, names)).toEqual({
      id: "c3",
      author: FORMER_MEMBER,
      at,
      body: "",
    });
    const ordered = commentsInOrder([
      { id: "b", created_at: "2030-01-02" },
      { id: "a", created_at: "2030-01-02" },
      { id: "z", created_at: "2030-01-01" },
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["z", "a", "b"]);
  });
});
