import { describe, expect, it } from "vitest";

import { planRollForward, rollForwardMessage, undoRollForward, type RollContext } from "./roll-forward";
import type { BusyInterval } from "./gap-finder";
import type { StripItem } from "./strip";

const dayStartMs = new Date(2026, 6, 10).getTime();
function at(h: number, m = 0): number {
  return new Date(2026, 6, 10, h, m).getTime();
}
function item(id: string, fromH: number, duration: number): StripItem {
  return {
    taskId: id,
    title: id,
    scheduledAtMs: new Date(2026, 6, 9, fromH, 0).getTime(), // yesterday
    durationMinutes: duration,
  };
}
function ctx(over: Partial<RollContext> = {}): RollContext {
  return {
    nowMs: over.nowMs ?? at(10, 0),
    dayStartMs,
    workStartMinute: 8 * 60,
    workEndMinute: 18 * 60,
    busy: over.busy ?? [],
    stepMinutes: over.stepMinutes,
  };
}

describe("roll-forward — placement plan + undo plan (AC9)", () => {
  it("places queued items in order into real gaps after now", () => {
    const plan = planRollForward(
      [item("a", 9, 60), item("b", 10, 30)],
      ctx({ nowMs: at(10, 0) }),
    );
    expect(plan.notPlaced).toEqual([]);
    // a → 10:00–11:00, then b avoids it → 11:00–11:30.
    expect(plan.placements.map((p) => p.toMs)).toEqual([at(10, 0), at(11, 0)]);
  });

  it("skips existing meetings when placing", () => {
    const busy: BusyInterval[] = [{ startMs: at(10, 0), endMs: at(11, 0) }];
    const plan = planRollForward([item("a", 9, 30)], ctx({ nowMs: at(9, 30), busy }));
    // now 9:30, meeting 10:00–11:00. A 30-min block fits 9:30–10:00.
    expect(plan.placements[0].toMs).toBe(at(9, 30));
  });

  it("reports items that don't fit and still places the ones that do", () => {
    // A meeting fills 10:00–17:45; a 60-min item can't fit, a 15-min can (17:45).
    const busy: BusyInterval[] = [{ startMs: at(10, 0), endMs: at(17, 45) }];
    const plan = planRollForward(
      [item("big", 9, 60), item("tiny", 9, 15)],
      ctx({ nowMs: at(10, 0), busy }),
    );
    expect(plan.notPlaced).toEqual(["big"]);
    expect(plan.placements.map((p) => p.taskId)).toEqual(["tiny"]);
    expect(plan.placements[0].toMs).toBe(at(17, 45));
  });

  it("the inverse plan restores every original time", () => {
    const items = [item("a", 9, 60), item("b", 10, 30)];
    const plan = planRollForward(items, ctx({ nowMs: at(10, 0) }));
    const undo = undoRollForward(plan.placements);
    expect(undo).toEqual([
      { taskId: "a", toMs: items[0].scheduledAtMs },
      { taskId: "b", toMs: items[1].scheduledAtMs },
    ]);
  });

  it("summarizes the result honestly", () => {
    expect(rollForwardMessage({ placements: [], notPlaced: ["x"] })).toBe("No room left today.");
    expect(
      rollForwardMessage({
        placements: [{ taskId: "a", fromMs: 1, toMs: 2, durationMinutes: 30 }],
        notPlaced: [],
      }),
    ).toBe("Moved 1 to today");
    expect(
      rollForwardMessage({
        placements: [{ taskId: "a", fromMs: 1, toMs: 2, durationMinutes: 30 }],
        notPlaced: ["b"],
      }),
    ).toBe("1 moved · 1 didn't fit");
  });
});
