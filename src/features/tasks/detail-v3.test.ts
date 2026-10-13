// TV-U13's pure rules: the feed's merged changes, folds and All · Comments
// (default q), the repeat picker's rules and its one summary line (27i), the
// description fold's counts (56) and the Project view's numbers (default p).

import { describe, expect, it } from "@rstest/core";

import type { SpineComment } from "@/lib/runtime.types";
import { buildTaskFeed, foldLabel, mergedLine, shapeFeed } from "./feed";
import { makeTask } from "./helpers";
import type { ActivityEntry, RecurrenceRule, Task } from "./model";
import { defaultSpec, repeatSummary, rruleToSpec, ruleFromSpec, specToRrule } from "./repeat";
import { projectFacts } from "./ui/project-panel";
import { hiddenCounts } from "./ui/task-description";

const T0 = Date.parse("2026-10-13T10:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

function entry(
  id: string,
  min: number,
  op: string,
  payload: object = {},
  actor = "u1",
): ActivityEntry {
  return {
    id,
    workspaceId: "w",
    module: "tasks",
    entityType: "task",
    entityId: "t1",
    op,
    actorType: "user",
    actorId: actor,
    actorLabel: actor === "u1" ? "Maciej" : "Mike",
    payload,
    createdAt: at(min),
  };
}

function comment(id: string, min: number): SpineComment {
  return {
    id,
    workspaceId: "w",
    entityType: "task",
    entityId: "t1",
    body: id,
    createdBy: "u2",
    authorKind: "user",
    authorLabel: null,
    createdAt: at(min),
    updatedAt: at(min),
    deletedAt: null,
    editedAt: null,
    reactions: [],
  };
}

const task = (over: Partial<Task> = {}): Task => ({
  ...makeTask({ workspaceId: "w", bucketId: "p1", title: "T", position: "a" }),
  id: "t1",
  createdAt: at(-60),
  ...over,
});

const update = (fields: string[]) => ({ fields });

describe("the feed (default q)", () => {
  it("merges one person's changes within 10 minutes into one line", () => {
    const feed = buildTaskFeed({
      task: task(),
      activity: [
        entry("a", 0, "tasks.update", update(["due_date"])),
        entry("b", 3, "tasks.update", update(["priority"])),
        entry("c", 6, "tasks.set_status", { to: "in_progress" }),
        entry("d", 8, "tasks.assigned", {}),
        entry("e", 30, "tasks.update", update(["title"])),
      ],
      comments: [],
    });
    const rows = shapeFeed(feed, "all");
    expect(rows.map((r) => r.kind)).toEqual(["line", "merged", "line"]);
    const merged = rows[1];
    expect(merged?.kind === "merged" && mergedLine(merged.entries)).toBe(
      "changed due, priority and 2 more",
    );
  });

  it("never merges two people, or across a comment", () => {
    const feed = buildTaskFeed({
      task: task(),
      activity: [
        entry("a", 0, "tasks.update", update(["due_date"])),
        entry("b", 1, "tasks.update", update(["priority"]), "u2"),
        entry("c", 3, "tasks.update", update(["title"]), "u2"),
      ],
      comments: [comment("c1", 2)],
    });
    expect(shapeFeed(feed, "all").map((r) => r.kind)).toEqual([
      "line",
      "line",
      "line",
      "comment",
      "line",
    ]);
  });

  it("folds a run of changes between comments, and keeps the latest after the last", () => {
    const activity = [0, 20, 40, 60].map((m, i) =>
      entry(`old${i}`, m, "tasks.update", update(["title"]), i % 2 ? "u1" : "u2"),
    );
    const tail = [100, 120, 140, 160, 180, 200, 220].map((m, i) =>
      entry(`new${i}`, m, "tasks.update", update(["title"]), i % 2 ? "u1" : "u2"),
    );
    const feed = buildTaskFeed({
      task: task(),
      activity: [...activity, ...tail],
      comments: [comment("c1", 90)],
    });
    const rows = shapeFeed(feed, "all");
    expect(rows.map((r) => r.kind)).toEqual([
      "line",
      "fold",
      "comment",
      "fold",
      "line",
      "line",
      "line",
      "line",
      "line",
    ]);
    const first = rows[1];
    expect(first?.kind === "fold" && foldLabel(first.count)).toBe("Show 4 earlier changes");
    // Opening a fold shows its lines in place.
    const opened = shapeFeed(feed, "all", new Set([first?.id ?? ""]));
    expect(opened.filter((r) => r.kind === "fold")).toHaveLength(1);
  });

  it("shows only the talk with Comments", () => {
    const feed = buildTaskFeed({
      task: task(),
      activity: [entry("a", 0, "tasks.update", update(["title"]))],
      comments: [comment("c1", 5), comment("c2", 10)],
    });
    expect(shapeFeed(feed, "comments").map((r) => r.id)).toEqual(["c1", "c2"]);
  });

  it("says one change in the singular", () => {
    expect(foldLabel(1)).toBe("Show 1 earlier change");
  });
});

describe("the repeat picker (27i)", () => {
  const rule = (rrule: string, mode?: "after_completion"): RecurrenceRule => ({
    rrule,
    dtstart: null,
    nextOccurrence: null,
    ...(mode ? { mode } : {}),
  });
  const now = new Date("2026-10-13T12:00:00");

  it("sums a rule up in one plain line", () => {
    expect(repeatSummary(rule("FREQ=DAILY"), now)).toBe("Every day");
    expect(repeatSummary(rule("FREQ=DAILY;INTERVAL=3"), now)).toBe("Every 3 days");
    expect(repeatSummary(rule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"), now)).toBe("Every weekday");
    expect(repeatSummary(rule("FREQ=WEEKLY;BYDAY=FR"), now)).toBe("Every Friday");
    expect(repeatSummary(rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"), now)).toBe(
      "Every 2 weeks on Mon, Wed",
    );
    expect(repeatSummary(rule("FREQ=MONTHLY;BYMONTHDAY=15"), now)).toBe("Monthly on the 15th");
    expect(repeatSummary(rule("FREQ=MONTHLY;BYDAY=+3FR;UNTIL=20261215T235959Z"), now)).toBe(
      "Every 3rd Friday, until Dec 15",
    );
    expect(repeatSummary(rule("FREQ=MONTHLY;BYDAY=-1FR"), now)).toBe("Every last Friday");
    expect(repeatSummary(rule("FREQ=WEEKLY;COUNT=10"), now)).toBe("Every week, 10 times");
    expect(repeatSummary(rule("FREQ=DAILY;INTERVAL=7", "after_completion"), now)).toBe(
      "Every 7 days after it’s done",
    );
  });

  it("writes a Custom spec as a rule both engines read, and reads it back", () => {
    const spec = {
      frequency: "monthly" as const,
      interval: 1,
      weekdays: [],
      monthly: { kind: "nth" as const, nth: 3, weekday: "FR" as const },
      end: { kind: "until" as const, day: "2026-12-15" },
      afterCompletion: false,
    };
    const rrule = specToRrule(spec);
    expect(rrule).toContain("FREQ=MONTHLY");
    expect(rrule).toContain("BYDAY=+3FR");
    expect(rrule).toContain("UNTIL=20261215T235959Z");
    expect(rruleToSpec(rule(rrule))).toEqual(spec);
  });

  it("anchors a rule to the task's date and marks 'after it's done'", () => {
    const made = ruleFromSpec(
      { ...defaultSpec(null, now), frequency: "daily", afterCompletion: true },
      "2026-10-14T09:00:00.000Z",
    );
    expect(made.mode).toBe("after_completion");
    expect(made.dtstart).toBe("2026-10-14T09:00:00.000Z");
    expect(made.nextOccurrence).toBe("2026-10-14T09:00:00.000Z");
  });

  it("starts Custom from the task's rule, else weekly on today's weekday", () => {
    expect(defaultSpec(null, now).weekdays).toEqual(["TU"]);
    expect(defaultSpec(rule("FREQ=DAILY;INTERVAL=2"), now).interval).toBe(2);
  });
});

describe("the description fold (56)", () => {
  it("counts what's hidden below it by kind", () => {
    expect(hiddenCounts(["task", "task", "email_thread"])).toBe("2 tasks · 1 email");
    expect(hiddenCounts(["note"])).toBe("1 note");
    expect(hiddenCounts([])).toBe("");
  });
});

describe("the Project view (default p)", () => {
  it("counts done of the work, leaving Won't do and Backlog out of the total", () => {
    const tasks = [
      task({ id: "a", statusCategory: "done", status: "done" }),
      task({ id: "b", statusCategory: "todo" }),
      task({ id: "c", statusCategory: "in_progress" }),
      task({ id: "d", statusCategory: "wont_do", status: "archived" }),
      task({ id: "e", statusCategory: "backlog" }),
      task({ id: "f", bucketId: "other" }),
    ];
    expect(projectFacts(tasks, "p1")).toEqual({
      total: 3,
      done: 1,
      open: 2,
      inProgress: 1,
      backlog: 1,
    });
  });
});
