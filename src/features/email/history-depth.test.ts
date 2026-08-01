import { describe, expect, it } from "vitest";

import {
  asHistoryDepth,
  DEFAULT_HISTORY_DEPTH,
  describeDepthChange,
  EMAIL_HISTORY_DEPTHS,
  type EmailHistoryDepth,
  historyDepthLabel,
} from "./history-depth";

describe("email history depth (IM-2c)", () => {
  it("offers the four specced choices, defaulting to 12 months", () => {
    expect(EMAIL_HISTORY_DEPTHS).toEqual([
      "threeMonths",
      "sixMonths",
      "twelveMonths",
      "everything",
    ]);
    expect(DEFAULT_HISTORY_DEPTH).toBe("twelveMonths");
    expect(EMAIL_HISTORY_DEPTHS.map(historyDepthLabel)).toEqual([
      "3 months",
      "6 months",
      "12 months",
      "Everything",
    ]);
    // The order is the depth order — `describeDepthChange` reads it as such.
    expect(EMAIL_HISTORY_DEPTHS.indexOf("everything")).toBe(EMAIL_HISTORY_DEPTHS.length - 1);
  });

  it("coerces an unknown stored depth to the default instead of breaking the picker", () => {
    // The desktop binary is drop-in replaced, so an account written by a NEWER
    // build can carry a depth this one has never heard of. The picker must still
    // render, and must not claim a depth the engine isn't using.
    expect(asHistoryDepth("twentyFourMonths")).toBe(DEFAULT_HISTORY_DEPTH);
    expect(asHistoryDepth(undefined)).toBe(DEFAULT_HISTORY_DEPTH);
    expect(asHistoryDepth(null)).toBe(DEFAULT_HISTORY_DEPTH);
    expect(asHistoryDepth(12)).toBe(DEFAULT_HISTORY_DEPTH);
    for (const depth of EMAIL_HISTORY_DEPTHS) expect(asHistoryDepth(depth)).toBe(depth);
  });

  it("tells the user that lowering the depth deletes nothing", () => {
    // The asymmetry is the whole point and is not guessable from a dropdown:
    // deeper backfills in the background, shallower is NOT destructive.
    const deeper = describeDepthChange("threeMonths", "twelveMonths");
    expect(deeper).toMatch(/starts fetching older mail/i);
    // Deliberately NOT "in the background" — there is no background driver yet.
    expect(deeper).not.toMatch(/in the background/i);
    expect(deeper).toMatch(/12 months/);

    const shallower = describeDepthChange("twelveMonths", "threeMonths");
    expect(shallower).toMatch(/stops fetching/i);
    expect(shallower).toMatch(/nothing already synced is deleted/i);

    // Every downgrade says so — not just the one pair above.
    for (const from of EMAIL_HISTORY_DEPTHS) {
      for (const to of EMAIL_HISTORY_DEPTHS) {
        const line = describeDepthChange(from, to);
        if (from === to) {
          expect(line).toBeNull();
          continue;
        }
        const isDeeper = EMAIL_HISTORY_DEPTHS.indexOf(to) > EMAIL_HISTORY_DEPTHS.indexOf(from);
        expect(line).not.toBeNull();
        expect(/deleted/i.test(line!)).toBe(!isDeeper);
      }
    }
  });

  it("says nothing when the depth hasn't changed", () => {
    for (const depth of EMAIL_HISTORY_DEPTHS) {
      expect(describeDepthChange(depth, depth as EmailHistoryDepth)).toBeNull();
    }
  });
});
