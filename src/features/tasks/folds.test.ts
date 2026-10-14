// TV-U8 · Folds follow the person: a List's or Board's fold shows at once,
// and the burst is written to the synced preferences in one write.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { currentPreferences } from "../../lib/preferences";
import {
  boardFoldKey,
  FOLDS_WRITE_DELAY_MS,
  flushFolds,
  listFoldKey,
  readFolds,
  resetFoldsForTests,
  writeFold,
} from "./folds";

afterEach(() => {
  rs.useRealTimers();
  resetFoldsForTests();
});

describe("folds", () => {
  it("keys name the workspace, the place and the grouping (a view keeps its own)", () => {
    expect(listFoldKey("w1", "all", "bucket")).toBe("w1:all:bucket");
    expect(boardFoldKey("w1", "view:abc", "status")).toBe("w1:view:abc:board:status");
  });

  it("a fold reads back at once and is written once, a moment later", () => {
    rs.useFakeTimers();
    const key = listFoldKey("w1", "all", "bucket");
    writeFold(key, "p1", true);
    writeFold(key, "p2", false);
    expect(readFolds(key)).toEqual({ p1: true, p2: false });
    expect(currentPreferences().tasksFolds[key]).toBeUndefined();
    rs.advanceTimersByTime(FOLDS_WRITE_DELAY_MS);
    expect(currentPreferences().tasksFolds[key]?.folds).toEqual({ p1: true, p2: false });
    // A later fold joins what was written.
    writeFold(key, "p1", false);
    flushFolds();
    expect(readFolds(key)).toEqual({ p1: false, p2: false });
  });

  it("no key, nothing remembered", () => {
    writeFold(null, "p1", true);
    flushFolds();
    expect(readFolds(null)).toEqual({});
    expect(currentPreferences().tasksFolds).toEqual({});
  });
});
