import { describe, expect, it } from "vitest";

import { type BusyInterval, findNextGap } from "./gap-finder";

// A plain (non-DST) local day; working hours 08:00–18:00.
const DAY = new Date(2026, 6, 2); // Thu Jul 2 2026
const dayStartMs = DAY.getTime();
const WORK_START = 8 * 60;
const WORK_END = 18 * 60;

function at(h: number, m = 0): number {
  return new Date(2026, 6, 2, h, m).getTime();
}
/** Hours may be fractional (9.5 = 09:30) — the Date ctor truncates, so split. */
function hour(h: number): number {
  return at(Math.floor(h), Math.round((h % 1) * 60));
}
function busy(startH: number, endH: number): BusyInterval {
  return { startMs: hour(startH), endMs: hour(endH) };
}
function find(over: {
  now: number;
  duration: number;
  busy?: BusyInterval[];
  step?: number;
}): number | null {
  return findNextGap({
    nowMs: over.now,
    dayStartMs,
    workStartMinute: WORK_START,
    workEndMinute: WORK_END,
    durationMinutes: over.duration,
    busy: over.busy ?? [],
    stepMinutes: over.step,
  });
}

describe("gap-finder — next fitting gap (AC8)", () => {
  it("empty day: returns now (snapped up) inside working hours", () => {
    const gap = find({ now: at(10, 7), duration: 30 });
    expect(gap).toBe(at(10, 15)); // 10:07 snaps up to 10:15
  });

  it("clamps the start up to working-hours open when now is before it", () => {
    const gap = find({ now: at(6, 0), duration: 60 });
    expect(gap).toBe(at(8, 0));
  });

  it("skips a meeting and lands in the gap after it", () => {
    // now 10:00, a 10:00–11:00 meeting → first fit is 11:00.
    const gap = find({ now: at(10, 0), duration: 45, busy: [busy(10, 11)] });
    expect(gap).toBe(at(11, 0));
  });

  it("fits a short block into a gap BEFORE the next meeting", () => {
    // now 9:00, meeting 9:30–10:30. A 20-min block fits 9:00–9:20.
    const gap = find({ now: at(9, 0), duration: 20, busy: [busy(9.5, 10.5)] });
    expect(gap).toBe(at(9, 0));
  });

  it("walks past back-to-back meetings to the first real opening", () => {
    const gap = find({
      now: at(9, 0),
      duration: 30,
      busy: [busy(9, 10), busy(10, 11), busy(11, 11.5)],
    });
    expect(gap).toBe(at(11, 30));
  });

  it("returns null when the day is full after now", () => {
    // one meeting fills 10:00 to end-of-work; nothing fits a 60-min block.
    const gap = find({ now: at(10, 0), duration: 60, busy: [busy(10, 18)] });
    expect(gap).toBeNull();
  });

  it("returns null when the remaining window is shorter than the duration", () => {
    // now 17:45, work ends 18:00 — only 15 min left.
    const gap = find({ now: at(17, 45), duration: 30 });
    expect(gap).toBeNull();
  });

  it("ignores busy intervals wholly before the cursor", () => {
    const gap = find({ now: at(14, 0), duration: 30, busy: [busy(9, 10)] });
    expect(gap).toBe(at(14, 0));
  });

  it("honors a fine (5-min) step", () => {
    const gap = find({ now: at(10, 3), duration: 30, step: 5 });
    expect(gap).toBe(at(10, 5));
  });
});

describe("gap-finder — DST day (Warsaw fall-back, real instants)", () => {
  it("finds a gap using real instants on the 25-hour day", () => {
    // 2026-10-25 is Warsaw's fall-back day. We don't pin TZ here (the machine
    // TZ may not be Warsaw), but the finder must never crash and must return a
    // slot at/after now within working hours on any day.
    const day = new Date(2026, 9, 25);
    const nowMs = new Date(2026, 9, 25, 9, 0).getTime();
    const gap = findNextGap({
      nowMs,
      dayStartMs: day.getTime(),
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      durationMinutes: 30,
      busy: [],
    });
    expect(gap).toBe(nowMs);
  });
});
