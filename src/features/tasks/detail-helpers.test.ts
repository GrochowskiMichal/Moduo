// TV-U3 pure rules: which properties the detail panel shows (U3-1, rule C), how
// the Time row reads, the merged comments & activity feed, and what Duplicate
// copies.

import { describe, expect, it } from "@rstest/core";

import type { SpineComment } from "@/lib/runtime.types";
import { isPropertySet, quietLineProperties, shownOptionalProperties } from "./detail-properties";
import { duplicateFields } from "./duplicate";
import { buildTaskFeed, feedTime, foldFeed } from "./feed";
import { makeTask } from "./helpers";
import type { ActivityEntry, Task } from "./model";
import { formatMinutes, formatTracked, parseMinutes, timeRow } from "./time-format";

function task(over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b", title: "T", position: "a" }),
    id: "t1",
    creatorId: "u1",
    ...over,
  };
}

describe("rule C: core always, the rest once set (U3-1)", () => {
  it("hides Energy, Scheduled, Time and Repeat until they have a value", () => {
    const empty = task();
    expect([...shownOptionalProperties(empty, new Set())]).toEqual([]);
    expect(quietLineProperties(empty, new Set())).toEqual([
      "energy",
      "scheduled",
      "time",
      "repeat",
    ]);
  });

  it("shows a set property and drops it from the quiet line", () => {
    const set = task({ energyLevel: "high", scheduledAt: "2026-10-09T09:00:00Z" });
    expect([...shownOptionalProperties(set, new Set())]).toEqual(["energy", "scheduled"]);
    expect(quietLineProperties(set, new Set())).toEqual(["time", "repeat"]);
  });

  it("counts an estimate or tracked time as a Time value", () => {
    expect(isPropertySet(task({ durationMinutes: 30 }), "time")).toBe(true);
    expect(isPropertySet(task({ timeSpentSeconds: 60 }), "time")).toBe(true);
    expect(isPropertySet(task(), "time")).toBe(false);
  });

  it("shows a row picked from the quiet line even while it's empty", () => {
    expect([...shownOptionalProperties(task(), new Set(["repeat"]))]).toEqual(["repeat"]);
    expect(quietLineProperties(task(), new Set(["repeat"]))).toEqual([
      "energy",
      "scheduled",
      "time",
    ]);
  });
});

describe("the Time row", () => {
  it("formats tracked time and estimates", () => {
    expect(formatTracked(0)).toBe("0m");
    expect(formatTracked(4800)).toBe("1h 20m");
    expect(formatMinutes(240)).toBe("4h");
    expect(formatMinutes(45)).toBe("45m");
  });

  it("reads typed durations", () => {
    expect(parseMinutes("90")).toBe(90);
    expect(parseMinutes("45m")).toBe(45);
    expect(parseMinutes("~4h")).toBe(240);
    expect(parseMinutes("1.5h")).toBe(90);
    expect(parseMinutes("1h 30m")).toBe(90);
    expect(parseMinutes("1:30")).toBe(90);
    expect(parseMinutes("")).toBeNull();
    expect(parseMinutes("soon")).toBeNull();
  });

  it('reads "1h 20m of ~4h", fills the bar, and adds your share when it is a share', () => {
    expect(timeRow(4800, 240, 3000)).toEqual({
      tracked: "1h 20m",
      estimate: "of ~4h",
      progress: 4800 / 14400,
      mine: "you 50m",
    });
  });

  it("leaves out your share when all the time is yours, and the bar without an estimate", () => {
    expect(timeRow(4800, null, 4800)).toEqual({
      tracked: "1h 20m",
      estimate: null,
      progress: null,
      mine: null,
    });
    expect(timeRow(0, 240, null).progress).toBe(0);
    expect(timeRow(20_000, 60, 0).progress).toBe(1);
  });
});

function entry(id: string, at: string, op = "tasks.queue_add"): ActivityEntry {
  return {
    id,
    workspaceId: "w",
    module: "tasks",
    entityType: "task",
    entityId: "t1",
    op,
    actorType: "user",
    actorId: "u1",
    actorLabel: "Maciej",
    payload: {},
    createdAt: at,
  };
}

function comment(id: string, at: string): SpineComment {
  return {
    id,
    workspaceId: "w",
    entityType: "task",
    entityId: "t1",
    body: "hi",
    createdBy: "u2",
    authorKind: "user",
    authorLabel: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

describe("comments & activity feed", () => {
  it("leads with creation, then comments and trail entries oldest first", () => {
    const feed = buildTaskFeed({
      task: task({ createdAt: "2026-10-06T10:00:00Z" }),
      activity: [
        entry("a2", "2026-10-07T10:00:00Z"),
        entry("a1", "2026-10-06T11:00:00Z"),
        entry("n1", "2026-10-06T12:00:00Z", "tasks.completed"),
      ],
      comments: [comment("c1", "2026-10-06T12:30:00Z")],
    });
    expect(feed.map((i) => i.id)).toEqual(["created:t1", "a1", "c1", "a2"]);
    expect(feed[0]).toMatchObject({ kind: "created", actorId: "u1" });
  });

  it("leads with the create row when the server logged one, so an agent's create names its key (TV-D8)", () => {
    const feed = buildTaskFeed({
      task: task({ createdAt: "2026-10-06T10:00:00Z" }),
      activity: [
        entry("a1", "2026-10-06T10:00:00Z", "tasks.assigned"),
        entry("cr", "2026-10-06T10:00:00Z", "tasks.create"),
        entry("a2", "2026-10-07T10:00:00Z"),
      ],
      comments: [],
    });
    expect(feed.map((i) => i.id)).toEqual(["cr", "a1", "a2"]);
    expect(feed.filter((i) => i.kind === "created")).toEqual([]);
  });

  it("names nobody for creation when the creator isn't known", () => {
    const [created] = buildTaskFeed({
      task: task({ creatorUnknown: true }),
      activity: [],
      comments: [],
    });
    expect(created).toMatchObject({ kind: "created", actorId: null });
  });

  it("folds older items behind 'Show N earlier', keeping creation first", () => {
    const activity = Array.from({ length: 12 }, (_, i) =>
      entry(`a${String(i).padStart(2, "0")}`, new Date(Date.UTC(2026, 9, 7, i)).toISOString()),
    );
    const feed = buildTaskFeed({ task: task(), activity, comments: [] });
    const folded = foldFeed(feed, false, 8);
    expect(folded.lead.map((i) => i.kind)).toEqual(["created"]);
    expect(folded.hidden).toBe(4);
    expect(folded.rest.map((i) => i.id)[0]).toBe("a04");
    expect(foldFeed(feed, true, 8).hidden).toBe(0);
    // One more than the limit isn't worth a fold line.
    expect(foldFeed(feed.slice(0, 10), false, 8).hidden).toBe(0);
  });
});

describe("feed times", () => {
  it("shows the time today, the day this year, and the year before that", () => {
    const now = new Date(2026, 9, 9, 15, 0);
    expect(feedTime(new Date(2026, 9, 9, 7, 20).toISOString(), now)).toMatch(/7:20/);
    expect(feedTime(new Date(2026, 9, 6, 12, 7).toISOString(), now)).not.toMatch(/2026|12:07/);
    expect(feedTime(new Date(2025, 9, 6, 12, 7).toISOString(), now)).toMatch(/2025/);
  });
});

describe("Duplicate", () => {
  it("copies the plan, not the history", () => {
    const original = task({
      title: "Ship it",
      description: "<p>notes</p>",
      assigneeId: "u2",
      priority: "high",
      energyLevel: "low",
      dueDate: "2026-10-10T00:00:00Z",
      durationMinutes: 60,
      timeSpentSeconds: 900,
      status: "in_progress",
      parentId: "p1",
    });
    const fields = duplicateFields(original);
    expect(fields).toMatchObject({
      title: "Ship it",
      description: "<p>notes</p>",
      assigneeId: "u2",
      priority: "high",
      energyLevel: "low",
      durationMinutes: 60,
      parentId: "p1",
      bucketId: "b",
    });
    expect("timeSpentSeconds" in fields).toBe(false);
    expect("status" in fields).toBe(false);
  });
});
