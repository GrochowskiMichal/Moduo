import { describe, expect, it } from "@rstest/core";

import {
  liftSearchFrom,
  nudgePlacement,
  type Placement,
  placementBusy,
  placementMinutes,
  slotAtPointer,
} from "./place-task";

const at = (d: number, h: number, m = 0) => new Date(2026, 6, d, h, m).getTime();
const placed = (startMs: number, durationMinutes = 60): Placement => ({
  taskId: "t1",
  startMs,
  durationMinutes,
});

describe("placing a task by keys (CALR-5, AC20)", () => {
  it("↑↓ move it 15 minutes, never off its day", () => {
    expect(nudgePlacement(placed(at(2, 10)), "later").startMs).toBe(at(2, 10, 15));
    expect(nudgePlacement(placed(at(2, 10)), "earlier").startMs).toBe(at(2, 9, 45));
    expect(nudgePlacement(placed(at(2, 0)), "earlier").startMs).toBe(at(2, 0));
    // A 60-minute task can't run past midnight.
    expect(nudgePlacement(placed(at(2, 23)), "later").startMs).toBe(at(2, 23));
  });

  it("←→ move it a day at the same wall-clock time, keeping its length", () => {
    const next = nudgePlacement(placed(at(2, 14, 30), 90), "next-day");
    expect(next).toEqual({ taskId: "t1", startMs: at(3, 14, 30), durationMinutes: 90 });
    expect(nudgePlacement(placed(at(2, 14, 30)), "prev-day").startMs).toBe(at(1, 14, 30));
  });

  it("a click in a free slot starts the task there, snapped, and keeps it inside the slot", () => {
    const slot = { startMs: at(2, 13), endMs: at(2, 15) };
    expect(slotAtPointer(slot, at(2, 13, 20), 60)).toBe(at(2, 13, 15));
    // Near the slot's end the task is pulled back so it still fits.
    expect(slotAtPointer(slot, at(2, 14, 40), 60)).toBe(at(2, 14));
    expect(slotAtPointer(slot, at(2, 12), 60)).toBe(at(2, 13));
  });

  it("the estimate decides the length; no estimate is 30 minutes", () => {
    expect(placementMinutes({ durationMinutes: 90 })).toBe(90);
    expect(placementMinutes({ durationMinutes: null })).toBe(30);
    expect(placementMinutes({ durationMinutes: 0 })).toBe(30);
  });

  it("the search starts from today, or the week shown, or its due day if that is earlier", () => {
    const now = at(2, 9, 10); // Thu Jul 2
    const thisWeek = [new Date(2026, 5, 29), new Date(2026, 6, 5)];
    const nextWeek = [new Date(2026, 6, 6), new Date(2026, 6, 12)];
    const lastWeek = [new Date(2026, 5, 22), new Date(2026, 5, 28)];
    expect(liftSearchFrom({ nowMs: now, visibleDays: thisWeek, dueDate: null })).toBe(now);
    expect(liftSearchFrom({ nowMs: now, visibleDays: lastWeek, dueDate: null })).toBe(now);
    expect(liftSearchFrom({ nowMs: now, visibleDays: nextWeek, dueDate: null })).toBe(at(6, 0));
    // Due Friday while next week is shown: its due day comes first.
    const friday = new Date(2026, 6, 3).toISOString();
    expect(liftSearchFrom({ nowMs: now, visibleDays: nextWeek, dueDate: friday })).toBe(at(3, 0));
    // Overdue: never in the past.
    const old = new Date(2026, 5, 1).toISOString();
    expect(liftSearchFrom({ nowMs: now, visibleDays: nextWeek, dueDate: old })).toBe(at(6, 0));
  });

  it("busy time is every timed event and every other task's block, never its own", () => {
    const events = new Map([["2026-07-02", [{ startMs: at(2, 9), endMs: at(2, 10) }]]]);
    const blocks = new Map([
      [
        "2026-07-02",
        [
          { taskId: "t1", startMs: at(2, 11), endMs: at(2, 12) },
          { taskId: "t2", startMs: at(2, 13), endMs: at(2, 14) },
        ],
      ],
    ]);
    expect(placementBusy(events, blocks, "t1")).toEqual([
      { startMs: at(2, 9), endMs: at(2, 10) },
      { startMs: at(2, 13), endMs: at(2, 14) },
    ]);
  });
});
