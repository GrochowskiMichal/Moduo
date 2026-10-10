import { describe, expect, it } from "@rstest/core";

import { type GroupBy, showBucketPill } from "./helpers";

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
