import { describe, expect, it } from "@rstest/core";

import { removePatch, tookLongerDeltaSeconds, tookLongerTotalSeconds } from "./triage";

describe("triage — took-longer semantics (AC8)", () => {
  it("adds the block's planned span to the tracked time", () => {
    expect(tookLongerDeltaSeconds({ durationMinutes: 90 })).toBe(90 * 60);
  });

  it("defaults a duration-less block to the 30-minute span", () => {
    expect(tookLongerDeltaSeconds({ durationMinutes: null })).toBe(30 * 60);
    expect(tookLongerDeltaSeconds({ durationMinutes: 0 })).toBe(30 * 60);
  });

  it("folds the span into the existing total (no remainder object)", () => {
    // The task already had 20 minutes tracked; +90 planned → 110 minutes.
    expect(tookLongerTotalSeconds(20 * 60, { durationMinutes: 90 })).toBe(110 * 60);
  });

  it("never returns a status — took-longer keeps the task open", () => {
    // The delta is purely additive time; the caller changes no status.
    const delta = tookLongerDeltaSeconds({ durationMinutes: 45 });
    expect(typeof delta).toBe("number");
    expect(delta).toBeGreaterThan(0);
  });
});

describe("triage — remove semantics (AC8)", () => {
  it("clears the schedule and nothing else", () => {
    const patch = removePatch();
    expect(Object.keys(patch)).toEqual(["scheduledAt"]);
    expect(patch.scheduledAt).toBeNull();
  });
});
