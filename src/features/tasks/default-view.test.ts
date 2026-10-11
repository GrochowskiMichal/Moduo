import { describe, expect, it } from "@rstest/core";

import {
  currentTimeBlockSlot,
  myTasksScope,
  openCount,
  resolveDefaultSelection,
  setBucketTimeBlock,
  showsMyTasks,
  timeBlockByBucket,
} from "./default-view";
import { groupsByBucket, makeTask, showBucketPill } from "./helpers";
import { sanitizeTimeBlocks, type Task } from "./model";

const at = (hour: number) => new Date(2026, 5, 6, hour, 30);

describe("currentTimeBlockSlot", () => {
  it("maps hours to slots with full coverage (evening wraps midnight)", () => {
    expect(currentTimeBlockSlot(at(5))).toBe("morning");
    expect(currentTimeBlockSlot(at(11))).toBe("morning");
    expect(currentTimeBlockSlot(at(12))).toBe("afternoon");
    expect(currentTimeBlockSlot(at(17))).toBe("afternoon");
    expect(currentTimeBlockSlot(at(18))).toBe("evening");
    expect(currentTimeBlockSlot(at(23))).toBe("evening");
    expect(currentTimeBlockSlot(at(0))).toBe("evening");
    expect(currentTimeBlockSlot(at(4))).toBe("evening");
  });
});

describe("setBucketTimeBlock", () => {
  it("assigns a bucket to a slot", () => {
    expect(setBucketTimeBlock({}, "b1", "morning")).toEqual({ morning: "b1" });
  });

  it("evicts the prior holder of a slot (one bucket per slot)", () => {
    expect(setBucketTimeBlock({ morning: "b1" }, "b2", "morning")).toEqual({ morning: "b2" });
  });

  it("moves a bucket between slots rather than holding two", () => {
    expect(setBucketTimeBlock({ morning: "b1" }, "b1", "evening")).toEqual({ evening: "b1" });
  });

  it("clears a bucket's slot when passed null", () => {
    expect(setBucketTimeBlock({ morning: "b1", evening: "b2" }, "b1", null)).toEqual({
      evening: "b2",
    });
  });
});

describe("timeBlockByBucket", () => {
  it("inverts the slot→bucket map", () => {
    const inv = timeBlockByBucket({ morning: "b1", evening: "b2" });
    expect(inv.get("b1")).toBe("morning");
    expect(inv.get("b2")).toBe("evening");
    expect(inv.get("b3")).toBeUndefined();
  });
});

describe("resolveDefaultSelection (REPLAN 30: opens where you left it)", () => {
  const base = { bucketIds: ["inbox-id", "b1", "b2"], inboxId: "inbox-id" };

  it("reopens the project you had open", () => {
    expect(resolveDefaultSelection({ ...base, lastBucket: "b2" })).toBe("b2");
  });

  it("reopens Focus, Upcoming, My tasks or All when that's where you were", () => {
    for (const scope of ["today", "upcoming", "mine", "all", "inbox"]) {
      expect(resolveDefaultSelection({ ...base, lastBucket: scope })).toBe(scope);
    }
  });

  it("falls back to the Inbox when the last project is gone (or archived)", () => {
    expect(resolveDefaultSelection({ ...base, lastBucket: "deleted-bucket" })).toBe("inbox");
    expect(resolveDefaultSelection({ ...base, lastBucket: null })).toBe("inbox");
  });

  it("maps the Inbox's own id to the 'inbox' selection", () => {
    expect(resolveDefaultSelection({ ...base, lastBucket: "inbox-id" })).toBe("inbox");
  });

  it("never opens Archived projects or Recently deleted", () => {
    expect(resolveDefaultSelection({ ...base, lastBucket: "archived" })).toBe("inbox");
    expect(resolveDefaultSelection({ ...base, lastBucket: "trash" })).toBe("inbox");
  });
});

describe("sanitizeTimeBlocks", () => {
  it("keeps valid slot entries and drops junk keys / values", () => {
    expect(sanitizeTimeBlocks({ morning: "b1", afternoon: "b2", lunch: "b3", evening: 7 })).toEqual(
      { morning: "b1", afternoon: "b2" },
    );
  });

  it("returns an empty map for non-object input", () => {
    expect(sanitizeTimeBlocks(null)).toEqual({});
    expect(sanitizeTimeBlocks("nope")).toEqual({});
    expect(sanitizeTimeBlocks(undefined)).toEqual({});
  });
});

describe("My tasks (TV-D4, D4-3)", () => {
  const task = (id: string, over: Partial<Task>): Task => ({
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    ...over,
  });

  it("shows the row only in workspaces with two or more members", () => {
    expect(showsMyTasks(0)).toBe(false);
    expect(showsMyTasks(1)).toBe(false);
    expect(showsMyTasks(2)).toBe(true);
    expect(showsMyTasks(5)).toBe(true);
  });

  it("scopes to tasks assigned to me across buckets, archived left out like All", () => {
    const tasks = [
      task("mine", { assigneeId: "me", bucketId: "b1" }),
      task("mine-elsewhere", { assigneeId: "me", bucketId: "b2" }),
      task("mine-done", { assigneeId: "me", status: "done" }),
      task("mine-archived", { assigneeId: "me", status: "archived" }),
      task("made-by-me", { assigneeId: "mike", creatorId: "me" }),
      task("nobody", { assigneeId: null }),
    ];
    const scope = myTasksScope(tasks, "me");
    expect(scope.map((t) => t.id)).toEqual(["mine", "mine-elsewhere", "mine-done"]);
    // The rail counts the open ones.
    expect(openCount(scope)).toBe(2);
    expect(myTasksScope(tasks, null)).toEqual([]);
  });

  it("groups by bucket and shows bucket pills like All", () => {
    expect(groupsByBucket("mine")).toBe(true);
    expect(groupsByBucket("all")).toBe(true);
    expect(groupsByBucket("today")).toBe(false);
    expect(groupsByBucket("b1")).toBe(false);
    expect(showBucketPill("mine", "none")).toBe(true);
    expect(showBucketPill("mine", "bucket")).toBe(false);
  });
});
