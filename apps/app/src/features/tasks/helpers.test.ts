import { describe, expect, it } from "@rstest/core";

import { dueOnToLocalInstant } from "../../lib/task-rows";
import { type GroupBy, makeTask, showBucketPill } from "./helpers";

const GROUPINGS: GroupBy[] = ["none", "status", "bucket", "assignee", "priority", "date"];

describe("showBucketPill (tasks-v2 Q1-3)", () => {
  it("bucket pill implied: never in a single-bucket scope, whatever the grouping", () => {
    for (const groupBy of GROUPINGS) {
      expect(showBucketPill("inbox", groupBy)).toBe(false);
      expect(showBucketPill("6f1c9a52-bucket", groupBy)).toBe(false);
    }
  });

  it("bucket pill implied: never when grouped by bucket (the header names it)", () => {
    expect(showBucketPill("all", "bucket")).toBe(false);
    expect(showBucketPill("today", "bucket")).toBe(false);
  });

  it("shows across buckets when nothing else names the bucket", () => {
    for (const groupBy of ["none", "status", "assignee", "priority", "date"] as const) {
      expect(showBucketPill("all", groupBy)).toBe(true);
    }
    expect(showBucketPill("today", "none")).toBe(true);
  });
});

// HV-15 509-4 (creator side): a task made with a due date carries its derived
// local day from the start, so every `dueOn` reader (Calendar chips, Mail's
// Today, Upcoming) sees it before the create comes back, offline included.
describe("makeTask derives dueOn from dueDate", () => {
  const base = { workspaceId: "w", bucketId: "b", title: "t", position: "a" };
  /** Nov 10's local wall clock at h:m, as an instant. */
  const nov10At = (h: number, m: number) => new Date(2026, 10, 10, h, m).toISOString();

  it("the due instant's local day, at local midnight, 00:30 and 23:30", () => {
    // Midnight is what capture and the pickers pass; 00:30 and 23:30 move a
    // UTC-day reading (`.slice(0, 10)`) in any zone but UTC.
    for (const at of [dueOnToLocalInstant("2026-11-10"), nov10At(0, 30), nov10At(23, 30)]) {
      expect(makeTask({ ...base, dueDate: at }).dueOn).toBe("2026-11-10");
    }
  });

  it("a bare due day is that day (west of UTC it read as the day before)", () => {
    expect(makeTask({ ...base, dueDate: "2026-11-10" }).dueOn).toBe("2026-11-10");
  });

  it("no due date, no due day", () => {
    expect(makeTask(base).dueOn ?? null).toBeNull();
    expect(makeTask({ ...base, dueDate: null }).dueOn ?? null).toBeNull();
  });
});
