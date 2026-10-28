// CALR-9 contract: ⇥ / ⇧⇥ hop the draft to the next / previous free time;
// N opens at the next free time; a clash leads the echo (AC16, AC17).

import { describe, expect, it } from "@rstest/core";

import type { ComposerBusy } from "./parse";
import { clashFor, hopFreeTime, openingSlot } from "./hops";

const NOW = new Date(2026, 9, 28, 10, 7).getTime(); // Wed
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const WORK = { workStartMinute: 9 * 60, workEndMinute: 18 * 60 };

function busyOn(map: Record<number, ComposerBusy[]>) {
  return (dayStartMs: number) => map[new Date(dayStartMs).getDate()] ?? [];
}

describe("free-time hops", () => {
  const busy = busyOn({
    28: [
      { startMs: at(28, 11), endMs: at(28, 12), title: "Legal review" },
      { startMs: at(28, 13), endMs: at(28, 17, 45), title: "Workshop" },
    ],
    29: [{ startMs: at(29, 9), endMs: at(29, 9, 30), title: "Standup" }],
  });

  it("⇥ moves to the next free slot of the same length, past busy time", () => {
    const next = hopFreeTime({
      startMs: at(28, 10, 30),
      endMs: at(28, 11),
      direction: 1,
      nowMs: NOW,
      busyOn: busy,
      ...WORK,
    });
    expect(next).toEqual({ startMs: at(28, 12), endMs: at(28, 12, 30) });
  });

  it("⇥ crosses into the next day when today is full", () => {
    const next = hopFreeTime({
      startMs: at(28, 12, 30),
      endMs: at(28, 13, 30),
      direction: 1,
      nowMs: NOW,
      busyOn: busy,
      ...WORK,
    });
    expect(next).toEqual({ startMs: at(29, 9, 30), endMs: at(29, 10, 30) });
  });

  it("⇧⇥ moves back to the previous free slot, never before now", () => {
    const prev = hopFreeTime({
      startMs: at(28, 12, 15),
      endMs: at(28, 12, 45),
      direction: -1,
      nowMs: NOW,
      busyOn: busy,
      ...WORK,
    });
    expect(prev).toEqual({ startMs: at(28, 12), endMs: at(28, 12, 30) });
    const before = hopFreeTime({
      startMs: at(28, 12),
      endMs: at(28, 12, 30),
      direction: -1,
      nowMs: NOW,
      busyOn: busy,
      ...WORK,
    });
    expect(before).toEqual({ startMs: at(28, 10, 30), endMs: at(28, 11) });
    const none = hopFreeTime({
      startMs: at(28, 10, 15),
      endMs: at(28, 10, 45),
      direction: -1,
      nowMs: NOW,
      busyOn: busy,
      ...WORK,
    });
    expect(none).toBeNull();
  });

  it("N opens at the next free 30 minutes from now, or at the cursor", () => {
    expect(openingSlot({ nowMs: NOW, cursor: null, busyOn: busy, ...WORK })).toEqual({
      dayStartMs: new Date(2026, 9, 28).getTime(),
      startMinute: 10 * 60 + 15,
    });
    expect(
      openingSlot({
        nowMs: NOW,
        cursor: { dayStartMs: new Date(2026, 9, 30).getTime(), minute: 14 * 60 },
        busyOn: busy,
        ...WORK,
      }),
    ).toEqual({ dayStartMs: new Date(2026, 9, 30).getTime(), startMinute: 14 * 60 });
  });

  it("after hours, N opens at the next working day's first free time", () => {
    expect(
      openingSlot({ nowMs: at(28, 18, 30), cursor: null, busyOn: busy, ...WORK }),
    ).toEqual({ dayStartMs: new Date(2026, 9, 29).getTime(), startMinute: 9 * 60 + 30 });
  });

  it("a clash names what it overlaps", () => {
    expect(clashFor(at(28, 11, 30), at(28, 12, 30), busy)?.title).toBe("Legal review");
    expect(clashFor(at(28, 12), at(28, 12, 30), busy)).toBeNull();
  });
});
