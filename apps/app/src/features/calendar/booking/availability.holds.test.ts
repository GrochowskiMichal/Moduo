// Offer holds on a link's open times (CALR-19, specs/calendar-rethink.md AC34):
// a held time is busy for every link, whatever its busy list ticks, matching
// booking-public (supabase/functions/_shared/booking-busy.ts).

import { describe, expect, it } from "@rstest/core";

import { openTimes, type OpenTimesInput } from "./availability";
import { DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "./slots";

const MONDAY_MORNING: WeeklyHours = {
  ...DEFAULT_WEEKLY_HOURS,
  mon: [{ start: "09:00", end: "11:00" }],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
};

function input(busyCalendarIds: string[], kind: string): OpenTimesInput {
  return {
    link: {
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      horizonDays: 30,
      minNoticeMinutes: 0,
      hostTimeZone: "UTC",
      weeklyHours: MONDAY_MORNING,
      busyCalendarIds,
      paused: false,
    },
    hostId: "me",
    events: [
      {
        ownerId: "me",
        sourceAccountId: null,
        calendarId: "moduo",
        startsAt: "2030-03-04T09:30:00.000Z",
        endsAt: "2030-03-04T10:00:00.000Z",
        kind,
        deletedAt: null,
      },
    ],
    now: new Date("2030-03-03T00:00:00.000Z"),
    from: new Date("2030-03-04T00:00:00.000Z"),
    to: new Date("2030-03-11T00:00:00.000Z"),
  };
}

const starts = (i: OpenTimesInput) =>
  openTimes(i).times.map((t) => new Date(t.startMs).toISOString());

describe("held times on the week's open times (AC34)", () => {
  it("skips a hold even when the link counts none of your calendars", () => {
    expect(starts(input([], "hold"))).not.toContain("2030-03-04T09:30:00.000Z");
    expect(starts(input(["acct-1"], "hold"))).toHaveLength(3);
  });

  it("an ordinary Moduo event still needs Moduo ticked", () => {
    expect(starts(input([], "event"))).toContain("2030-03-04T09:30:00.000Z");
  });
});
