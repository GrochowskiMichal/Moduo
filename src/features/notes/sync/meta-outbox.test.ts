import { describe, expect, it } from "vitest";
import type { MetaOutboxEntry } from "./idb";
import { isDuplicateKeyError, isNetworkError, replayDecision, replayOrder } from "./meta-outbox";

function entry(kind: MetaOutboxEntry["kind"], queuedAt: number, key?: number): MetaOutboxEntry {
  return { key, workspaceId: "ws1", kind, args: {}, queuedAt };
}

describe("meta outbox replay decisions (AC6)", () => {
  it("classifies network failures as retry-later (queue survives intact)", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true); // WebKit
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(replayDecision(entry("rename", 1), new TypeError("Failed to fetch"))).toBe(
      "retry-later",
    );
  });

  it("treats a replayed create hitting the PK as already-applied", () => {
    const err = new Error('duplicate key value violates unique constraint "notes_pkey"');
    expect(isDuplicateKeyError(err)).toBe(true);
    expect(replayDecision(entry("create", 1), err)).toBe("applied");
  });

  it("drops server rejections so one poison op can't wedge the queue", () => {
    expect(
      replayDecision(entry("move", 1), new Error("A note cannot be moved into its own subtree.")),
    ).toBe("drop");
    // …but the same rejection on a create-dup is NOT a drop (handled above)
    expect(replayDecision(entry("rename", 1), new Error("You do not have edit access"))).toBe(
      "drop",
    );
  });

  it("success clears the entry", () => {
    expect(replayDecision(entry("archive", 1), null)).toBe("applied");
  });

  it("replays strictly FIFO by queue time then insertion key", () => {
    const order = replayOrder([entry("move", 5, 2), entry("create", 1, 1), entry("rename", 5, 1)]);
    expect(order.map((e) => e.kind)).toEqual(["create", "rename", "move"]);
  });
});
