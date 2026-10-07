import { describe, expect, it } from "@rstest/core";

import {
  currentTimeBlockSlot,
  resolveDefaultSelection,
  setBucketTimeBlock,
  timeBlockByBucket,
} from "./default-view";
import { sanitizeTimeBlocks } from "./model";

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

describe("resolveDefaultSelection", () => {
  const base = { bucketIds: ["inbox-id", "b1", "b2"], inboxId: "inbox-id" };

  it("prefers the bucket mapped to the current time block", () => {
    expect(
      resolveDefaultSelection({
        ...base,
        now: at(8), // morning
        timeBlocks: { morning: "b1" },
        lastBucket: "b2",
      }),
    ).toBe("b1");
  });

  it("falls back to the last-opened bucket when no time-block matches", () => {
    expect(
      resolveDefaultSelection({
        ...base,
        now: at(8),
        timeBlocks: { evening: "b1" }, // wrong slot for the morning `now`
        lastBucket: "b2",
      }),
    ).toBe("b2");
  });

  it("skips a stale time-block bucket that no longer exists", () => {
    expect(
      resolveDefaultSelection({
        ...base,
        now: at(8),
        timeBlocks: { morning: "gone" },
        lastBucket: "b2",
      }),
    ).toBe("b2");
  });

  it("falls back to Inbox when the last bucket is gone", () => {
    expect(
      resolveDefaultSelection({
        ...base,
        now: at(8),
        timeBlocks: {},
        lastBucket: "deleted-bucket",
      }),
    ).toBe("inbox");
  });

  it("maps a time-block / last-bucket pointing at the Inbox id to the 'inbox' selection", () => {
    expect(
      resolveDefaultSelection({
        ...base,
        now: at(8),
        timeBlocks: { morning: "inbox-id" },
        lastBucket: null,
      }),
    ).toBe("inbox");
  });

  it("never opens on the full cross-bucket list", () => {
    const out = resolveDefaultSelection({
      ...base,
      now: at(8),
      timeBlocks: {},
      lastBucket: "all",
    });
    expect(out).not.toBe("all");
    expect(out).toBe("inbox");
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
