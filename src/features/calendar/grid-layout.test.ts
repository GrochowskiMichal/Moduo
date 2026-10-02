// NOTE: the DST suite pins TZ before any Date math. Vitest isolates each test
// file in its own environment (default isolate:true), so this never leaks into
// other files.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "vitest";

import {
  chipSpanInDay,
  dayGeometry,
  type LayoutChip,
  layoutDayChips,
  minutesIntoDay,
  wallClockToRealMinutes,
} from "./grid-layout";

function chip(id: string, startHour: number, endHour: number): LayoutChip {
  // An ordinary (non-DST) local day.
  const day = new Date(2026, 5, 30);
  const at = (h: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(h), (h % 1) * 60);
  return { id, startMs: at(startHour).getTime(), endMs: at(endHour).getTime() };
}

describe("layoutDayChips — overlap clusters", () => {
  it("non-overlapping chips each get the full width", () => {
    const { placed, overflow } = layoutDayChips([chip("a", 9, 10), chip("b", 11, 12)]);
    expect(overflow).toHaveLength(0);
    expect(placed).toEqual([
      { id: "a", col: 0, cols: 1 },
      { id: "b", col: 0, cols: 1 },
    ]);
  });

  it("three overlapping chips split the column side-by-side", () => {
    const { placed, overflow } = layoutDayChips([
      chip("a", 9, 10.5),
      chip("b", 9.5, 11),
      chip("c", 10, 12),
    ]);
    expect(overflow).toHaveLength(0);
    expect(placed.map((p) => p.cols)).toEqual([3, 3, 3]);
    expect(new Set(placed.map((p) => p.col))).toEqual(new Set([0, 1, 2]));
  });

  it("a fourth overlapping chip collapses into '+1'", () => {
    const { placed, overflow } = layoutDayChips([
      chip("a", 9, 12),
      chip("b", 9, 12),
      chip("c", 9, 12),
      chip("d", 9.25, 12),
    ]);
    expect(placed).toHaveLength(3);
    expect(placed.every((p) => p.cols === 3)).toBe(true);
    expect(overflow).toHaveLength(1);
    expect(overflow[0].ids).toEqual(["d"]);
    expect(overflow[0].startMs).toBe(chip("d", 9.25, 12).startMs);
  });

  it("a chip after a freed column reuses it (cluster columns are greedy)", () => {
    const { placed } = layoutDayChips([
      chip("a", 9, 10),
      chip("b", 9, 12),
      chip("c", 10.5, 11.5), // overlaps only b — reuses a's column
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    // Longer chips sort first: b takes col 0, a col 1; c reuses a's freed col.
    expect(byId.b.col).toBe(0);
    expect(byId.a.col).toBe(1);
    expect(byId.c.col).toBe(1);
    expect(byId.c.cols).toBe(2);
  });

  it("separate clusters don't share width", () => {
    const { placed } = layoutDayChips([chip("a", 9, 10), chip("b", 9, 10), chip("c", 14, 15)]);
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(byId.a.cols).toBe(2);
    expect(byId.c.cols).toBe(1);
  });
});

describe("dayGeometry — DST days (real instants, not hour indices)", () => {
  it("an ordinary day is 1440 minutes with 24 hour marks", () => {
    const geom = dayGeometry(new Date(2026, 5, 30));
    expect(geom.totalMinutes).toBe(1440);
    expect(geom.hourMarks).toHaveLength(24);
    expect(geom.hourMarks[9]).toEqual({ minuteOfDay: 540, hour: 9 });
  });

  it("the spring-forward day (Warsaw 2026-03-29) is 23 real hours", () => {
    const geom = dayGeometry(new Date(2026, 2, 29));
    expect(geom.totalMinutes).toBe(1380);
    expect(geom.hourMarks).toHaveLength(23);
    // 02:00 doesn't exist — the mark after 01:00 labels 03:00.
    const labels = geom.hourMarks.map((m) => m.hour);
    expect(labels).not.toContain(2);
    expect(labels[1]).toBe(1);
    expect(labels[2]).toBe(3);
  });

  it("the fall-back day (Warsaw 2026-10-25) is 25 real hours", () => {
    const geom = dayGeometry(new Date(2026, 9, 25));
    expect(geom.totalMinutes).toBe(1500);
    expect(geom.hourMarks).toHaveLength(25);
    // 02:00 occurs twice.
    const twos = geom.hourMarks.filter((m) => m.hour === 2);
    expect(twos).toHaveLength(2);
  });

  it("chips after the transition don't drift — positions use real elapsed minutes", () => {
    const geom = dayGeometry(new Date(2026, 2, 29)); // 23h day
    // A 9:00 local meeting is 8 real hours after midnight (02:00 skipped).
    const nine = new Date(2026, 2, 29, 9, 0).getTime();
    const span = chipSpanInDay(nine, nine + 30 * 60_000, geom);
    expect(span).toEqual({ topMinutes: 480, heightMinutes: 30 });
    // The 9:00 hour mark sits at the same real minute — chip and line agree.
    const nineMark = geom.hourMarks.find((m) => m.hour === 9);
    expect(nineMark?.minuteOfDay).toBe(480);
  });

  it("clamps chips that cross the day boundary and rejects outside chips", () => {
    const geom = dayGeometry(new Date(2026, 5, 30));
    const lateStart = new Date(2026, 5, 30, 23, 30).getTime();
    expect(chipSpanInDay(lateStart, lateStart + 60 * 60_000, geom)).toEqual({
      topMinutes: 1410,
      heightMinutes: 30,
    });
    const yesterday = new Date(2026, 5, 29, 10, 0).getTime();
    expect(chipSpanInDay(yesterday, yesterday + 30 * 60_000, geom)).toBeNull();
  });

  it("wallClockToRealMinutes maps prefs times through the DST shift", () => {
    // Ordinary day: wall-clock == real.
    expect(wallClockToRealMinutes(480, dayGeometry(new Date(2026, 5, 30)))).toBe(480);
    // Spring-forward day: 08:00 local is only 7 real hours after midnight.
    expect(wallClockToRealMinutes(480, dayGeometry(new Date(2026, 2, 29)))).toBe(420);
    // Fall-back day: 08:00 local is 9 real hours after midnight.
    expect(wallClockToRealMinutes(480, dayGeometry(new Date(2026, 9, 25)))).toBe(540);
    // Clamped to the day's real span.
    expect(wallClockToRealMinutes(1500, dayGeometry(new Date(2026, 5, 30)))).toBe(1440);
  });

  it("minutesIntoDay places the now-line only inside its day", () => {
    const geom = dayGeometry(new Date(2026, 5, 30));
    expect(minutesIntoDay(new Date(2026, 5, 30, 11, 37).getTime(), geom)).toBe(697);
    expect(minutesIntoDay(new Date(2026, 6, 1, 0, 0).getTime(), geom)).toBeNull();
  });
});
