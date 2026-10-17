// TV-F8: your usual pace (call 10; spec §7, AC8.10): nine timed tasks show
// nothing, the tenth shows "≈ … at your usual pace", the setting hides it, and
// Timer: Off never shows it (63).

import { describe, expect, it } from "@rstest/core";

import { PACE_MIN_TASKS, type PaceTask, paceText, usualPace } from "./pace";

const ME = "u-me";

function finished(i: number, over: Partial<PaceTask> = {}): PaceTask {
  return {
    status: "done",
    completedBy: ME,
    completedAt: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`,
    updatedAt: "2026-10-01T10:00:00Z",
    // 30 minutes estimated, 45 tracked: a 1.5× pace.
    estimate: 30,
    timeSpentSeconds: 45 * 60,
    ...over,
  };
}

const many = (n: number, over: Partial<PaceTask> = {}) =>
  Array.from({ length: n }, (_, i) => finished(i, over));

describe("usual pace after ~10 tasks", () => {
  it("nine timed tasks show nothing; the tenth shows the line", () => {
    expect(usualPace(many(PACE_MIN_TASKS - 1), ME)).toBeNull();
    const ratio = usualPace(many(PACE_MIN_TASKS), ME);
    expect(ratio).toBeCloseTo(1.5);
    expect(paceText({ minutes: 300, ratio, enabled: true, timed: true })).toBe(
      "≈ 7h 30m at your usual pace",
    );
  });

  it("the setting hides it, and so does Timer: Off", () => {
    const ratio = usualPace(many(12), ME);
    expect(paceText({ minutes: 60, ratio, enabled: false, timed: true })).toBeNull();
    expect(paceText({ minutes: 60, ratio, enabled: true, timed: false })).toBeNull();
  });

  it("counts only tasks I finished, with an estimate and at least a minute tracked", () => {
    const noise = [
      ...many(5, { completedBy: "someone-else" }),
      ...many(5, { estimate: null }),
      ...many(5, { timeSpentSeconds: 30 }),
      ...many(5, { status: "todo" }),
    ];
    expect(usualPace([...many(9), ...noise], ME)).toBeNull();
    expect(usualPace([...many(10), ...noise], ME)).toBeCloseTo(1.5);
  });

  it("nothing estimated ahead shows nothing; no person, no pace", () => {
    expect(paceText({ minutes: 0, ratio: 1.2, enabled: true, timed: true })).toBeNull();
    expect(usualPace(many(12), null)).toBeNull();
  });

  it("one wild task can't swing it past five times", () => {
    const ratio = usualPace(many(10, { estimate: 1, timeSpentSeconds: 10 * 3600 }), ME);
    expect(ratio).toBe(5);
  });
});
