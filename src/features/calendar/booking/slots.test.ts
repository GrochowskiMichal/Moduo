import { describe, expect, test } from "vitest";
import { computeOpenSlots, DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "./slots";

const MONDAY_ONLY: WeeklyHours = {
  ...DEFAULT_WEEKLY_HOURS,
  sun: [],
  mon: [{ start: "09:00", end: "10:00" }],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
};

describe("computeOpenSlots", () => {
  test("offers duration-aligned times inside weekly hours, in the host timezone", () => {
    const slots = computeOpenSlots({
      now: new Date("2026-10-01T00:00:00.000Z"),
      hostTimeZone: "Europe/Warsaw",
      weeklyHours: MONDAY_ONLY,
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      horizonDays: 7,
      minNoticeMinutes: 0,
      busy: [],
    });
    // 2026-10-05 is Monday. 09:00 Warsaw (CEST, UTC+2) is 07:00Z.
    expect(slots.map((slot) => slot.toISOString())).toEqual([
      "2026-10-05T07:00:00.000Z",
      "2026-10-05T07:30:00.000Z",
    ]);
  });

  test("hides a slot that would sit inside the buffer after a busy block", () => {
    const slots = computeOpenSlots({
      now: new Date("2026-10-01T00:00:00.000Z"),
      hostTimeZone: "Europe/Warsaw",
      weeklyHours: MONDAY_ONLY,
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 15,
      horizonDays: 7,
      minNoticeMinutes: 0,
      busy: [
        {
          start: new Date("2026-10-05T07:00:00.000Z"),
          end: new Date("2026-10-05T07:30:00.000Z"),
        },
      ],
    });
    expect(slots).toEqual([]);
  });

  test("respects minimum notice", () => {
    const slots = computeOpenSlots({
      now: new Date("2026-10-05T06:50:00.000Z"),
      hostTimeZone: "Europe/Warsaw",
      weeklyHours: MONDAY_ONLY,
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      horizonDays: 1,
      minNoticeMinutes: 30,
      busy: [],
    });
    expect(slots.map((slot) => slot.toISOString())).toEqual(["2026-10-05T07:30:00.000Z"]);
  });
});
