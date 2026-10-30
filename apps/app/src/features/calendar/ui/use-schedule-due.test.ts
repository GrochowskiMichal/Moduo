import { describe, expect, it } from "@rstest/core";

import type { BusyInterval } from "../gap-finder";
import { localDayKey } from "../lens";
import { findDueSlot } from "./use-schedule-due";

// Working hours 08:00–18:00; "now" is Fri Oct 30 2026, 10:07.
const prefs = { workStartMinute: 8 * 60, workEndMinute: 18 * 60 };
const NOW = new Date(2026, 9, 30, 10, 7).getTime();
const TODAY = new Date(2026, 9, 30);
const none = new Map<string, BusyInterval[]>();

function slot(day: Date, busy = none) {
  return findDueSlot({
    day,
    nowMs: NOW,
    prefs,
    durationMinutes: 30,
    busyOn: (d: Date) => busy.get(localDayKey(d)) ?? [],
  });
}

describe("findDueSlot", () => {
  it("books an overdue task from a past day into today's first free time", () => {
    const r = slot(new Date(2026, 9, 23));
    expect(r.dayStartMs).toBe(TODAY.getTime());
    expect(r.gapMs).toBe(new Date(2026, 9, 30, 10, 15).getTime());
  });

  it("checks today's events, not the past day's, for an overdue task", () => {
    const busyToday = new Map([
      [
        localDayKey(TODAY),
        [
          {
            startMs: new Date(2026, 9, 30, 10, 15).getTime(),
            endMs: new Date(2026, 9, 30, 11, 0).getTime(),
          },
        ],
      ],
    ]);
    expect(slot(new Date(2026, 9, 23), busyToday).gapMs).toBe(
      new Date(2026, 9, 30, 11, 0).getTime(),
    );
  });

  it("keeps a future day's task on that day", () => {
    const r = slot(new Date(2026, 10, 2));
    expect(r.dayStartMs).toBe(new Date(2026, 10, 2).getTime());
    expect(r.gapMs).toBe(new Date(2026, 10, 2, 8, 0).getTime());
  });
});
