// DB-7 AC7 (habits) — the pure habit logic: date math, toggling, streaks.

import { describe, expect, it } from "@rstest/core";

import {
  addDays,
  computeStreak,
  isChecked,
  nextPosition,
  recentDays,
  sortHabits,
  toggleCheck,
} from "./habits";

describe("addDays", () => {
  it("shifts a date key, rolling months/years", () => {
    expect(addDays("2026-07-09", 1)).toBe("2026-07-10");
    expect(addDays("2026-07-09", -1)).toBe("2026-07-08");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("toggleCheck", () => {
  it("adds a missing date and removes a present one, staying sorted + de-duped", () => {
    expect(toggleCheck([], "2026-07-09")).toEqual(["2026-07-09"]);
    expect(toggleCheck(["2026-07-09"], "2026-07-09")).toEqual([]);
    expect(toggleCheck(["2026-07-10"], "2026-07-09")).toEqual(["2026-07-09", "2026-07-10"]);
    expect(toggleCheck(["2026-07-09", "2026-07-09"], "2026-07-10")).toEqual([
      "2026-07-09",
      "2026-07-10",
    ]);
  });
});

describe("isChecked", () => {
  it("reports membership", () => {
    expect(isChecked(["2026-07-09"], "2026-07-09")).toBe(true);
    expect(isChecked(["2026-07-09"], "2026-07-08")).toBe(false);
  });
});

describe("computeStreak", () => {
  const today = "2026-07-09";

  it("is 0 when neither today nor yesterday is checked", () => {
    expect(computeStreak([], today)).toBe(0);
    expect(computeStreak(["2026-07-01"], today)).toBe(0);
  });

  it("counts consecutive days ending today when today is checked", () => {
    expect(computeStreak(["2026-07-09"], today)).toBe(1);
    expect(computeStreak(["2026-07-07", "2026-07-08", "2026-07-09"], today)).toBe(3);
  });

  it("counts back from yesterday when today is not yet checked (active streak)", () => {
    expect(computeStreak(["2026-07-07", "2026-07-08"], today)).toBe(2);
  });

  it("stops at the first gap", () => {
    expect(computeStreak(["2026-07-05", "2026-07-08", "2026-07-09"], today)).toBe(2);
  });
});

describe("recentDays", () => {
  it("returns the last n keys ending today, oldest→newest", () => {
    expect(recentDays("2026-07-09", 3)).toEqual(["2026-07-07", "2026-07-08", "2026-07-09"]);
  });
});

describe("sortHabits + nextPosition", () => {
  const h = (id: string, position: string, createdAt = "2026-01-01") => ({
    id,
    workspaceId: "w",
    name: id,
    emoji: "",
    position,
    checks: [],
    createdAt,
    updatedAt: createdAt,
  });

  it("sorts by position then creation", () => {
    expect(sortHabits([h("b", "a0002"), h("a", "a0001")]).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("nextPosition is collision-free after a removal (max+1, not count)", () => {
    const habits = [h("a", "a0000"), h("c", "a0002")]; // a0001 was removed
    const pos = nextPosition(habits);
    expect(pos).toBe("a0003");
    expect(habits.some((x) => x.position === pos)).toBe(false);
  });

  it("nextPosition starts at a0000 for an empty/legacy set", () => {
    expect(nextPosition([])).toBe("a0000");
    expect(nextPosition([h("a", "")])).toBe("a0000");
  });
});
