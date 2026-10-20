import { describe, expect, it } from "@rstest/core";

import {
  currentTimeBlockSlot,
  myTasksScope,
  openCount,
  remembersPlace,
  resolveDefaultSelection,
  resolveEntryPlace,
  setBucketTimeBlock,
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

  it("a first open follows onboarding: the role's first view (TV-U17)", () => {
    expect(resolveDefaultSelection({ ...base, lastBucket: null, firstOpen: "upcoming" })).toBe(
      "upcoming",
    );
    expect(resolveDefaultSelection({ ...base, lastBucket: null, firstOpen: "b1" })).toBe("b1");
    // A place you left still wins, and a gone one isn't a first open.
    expect(resolveDefaultSelection({ ...base, lastBucket: "b2", firstOpen: "upcoming" })).toBe(
      "b2",
    );
    expect(resolveDefaultSelection({ ...base, lastBucket: "gone", firstOpen: "upcoming" })).toBe(
      "inbox",
    );
    // A first view that isn't there (a project since deleted) is the Inbox.
    expect(resolveDefaultSelection({ ...base, lastBucket: null, firstOpen: "gone" })).toBe("inbox");
  });

  it("never opens Archived projects or Recently deleted", () => {
    expect(resolveDefaultSelection({ ...base, lastBucket: "archived" })).toBe("inbox");
    expect(resolveDefaultSelection({ ...base, lastBucket: "trash" })).toBe("inbox");
  });
});

describe("resolveEntryPlace (DF-1: the address bar holds the place)", () => {
  const V = "view:9d1c3a7e-1111-4222-8333-444455556666";
  const base = {
    url: null,
    reopening: true,
    lastBucket: null,
    legacyMode: false,
    firstView: null,
    inboxId: "inbox-id",
    bucketIds: ["b1", "b2"],
    archivedBucketIds: ["old"],
    viewSelections: [V],
    loaded: true,
    reachedServer: true,
  };

  it("opens the place the address bar holds, over where you left Tasks", () => {
    expect(resolveEntryPlace({ ...base, url: "upcoming", lastBucket: "b2" })).toBe("upcoming");
    expect(resolveEntryPlace({ ...base, url: "b1", lastBucket: "b2" })).toBe("b1");
    expect(resolveEntryPlace({ ...base, url: V })).toBe(V);
    expect(resolveEntryPlace({ ...base, url: "inbox-id" })).toBe("inbox-id");
  });

  it("without one, reopens where you left Tasks, else onboarding's view, else the Inbox", () => {
    expect(resolveEntryPlace({ ...base, lastBucket: "b2" })).toBe("b2");
    expect(resolveEntryPlace({ ...base, lastBucket: V })).toBe(V);
    expect(resolveEntryPlace({ ...base, firstView: "b1" })).toBe("b1");
    expect(resolveEntryPlace(base)).toBe("inbox");
    // The retired Plan · Focus switch's Focus mode opens Focus (TV-F7).
    expect(resolveEntryPlace({ ...base, legacyMode: true, lastBucket: "b2" })).toBe("today");
  });

  it("trusts the address bar and memory while the bundle loads", () => {
    const loading = { ...base, loaded: false, bucketIds: [], viewSelections: [] };
    expect(resolveEntryPlace({ ...loading, url: "b9" })).toBe("b9");
    expect(resolveEntryPlace({ ...loading, lastBucket: "b9" })).toBe("b9");
    expect(resolveEntryPlace(loading)).toBe("inbox");
  });

  it("a project gone mid-visit falls back to the Inbox", () => {
    const visiting = { ...base, reopening: false, lastBucket: "b2" };
    expect(resolveEntryPlace({ ...visiting, url: "gone" })).toBe("inbox");
    // On arrival (another workspace's project, a deleted one) it's where you left Tasks.
    expect(resolveEntryPlace({ ...base, url: "gone", lastBucket: "b2" })).toBe("b2");
  });

  it("a view counts as gone only once the server answered", () => {
    const missing = "view:00000000-0000-4000-8000-000000000000";
    expect(resolveEntryPlace({ ...base, url: missing, reachedServer: false })).toBe(missing);
    expect(resolveEntryPlace({ ...base, url: missing, reopening: false })).toBe("inbox");
  });

  it("a place you only pass through doesn't reopen on arrival, but opens when picked", () => {
    for (const url of ["trash", "archived", "wontdo", "templates", "new-view", "old"]) {
      expect(resolveEntryPlace({ ...base, url, lastBucket: "b1" })).toBe("b1");
      expect(resolveEntryPlace({ ...base, url, lastBucket: "b1", reopening: false })).toBe(url);
    }
  });

  it("settles: what it resolves resolves to itself", () => {
    const cases = [
      { ...base },
      { ...base, url: "gone", lastBucket: "b2" },
      { ...base, url: "trash", lastBucket: V },
      { ...base, firstView: "upcoming" },
    ];
    for (const c of cases) {
      const place = resolveEntryPlace(c);
      expect(resolveEntryPlace({ ...c, url: place, reopening: false })).toBe(place);
    }
  });
});

describe("remembersPlace", () => {
  it("remembers projects, views and the reopenable scopes, never a passing place", () => {
    expect(remembersPlace("b1", [])).toBe(true);
    expect(remembersPlace("view:x", [])).toBe(true);
    expect(remembersPlace("mine", [])).toBe(true);
    expect(remembersPlace("trash", [])).toBe(false);
    expect(remembersPlace("new-view", [])).toBe(false);
    expect(remembersPlace("old", ["old"])).toBe(false);
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
