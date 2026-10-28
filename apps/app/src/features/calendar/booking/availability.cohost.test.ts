// Co-hosts' time the app can read (their events and busy blocks) only ever
// takes times away from the guest page's answer (CALR-17, AC32).

import { describe, expect, it } from "@rstest/core";

import { openTimes } from "./availability";
import { DEFAULT_WEEKLY_HOURS } from "./slots";

const hours = {
  ...DEFAULT_WEEKLY_HOURS,
  mon: [{ start: "09:00", end: "10:00" }],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
};

const base = {
  link: {
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    horizonDays: 30,
    minNoticeMinutes: 0,
    hostTimeZone: "UTC",
    weeklyHours: hours,
    busyCalendarIds: ["moduo"],
    paused: false,
  },
  hostId: "me",
  events: [],
  hosts: [{ userId: "kai", name: "Kai Ito", status: "accepted" }],
  guestSlots: ["2030-03-04T09:00:00.000Z", "2030-03-04T09:30:00.000Z"],
  now: new Date("2030-03-03T00:00:00.000Z"),
  from: new Date("2030-03-04T00:00:00.000Z"),
  to: new Date("2030-03-11T00:00:00.000Z"),
};

describe("openTimes · co-hosts' readable busy time", () => {
  it("hides a time a co-host is busy, even when the guest page still offers it", () => {
    const result = openTimes({
      ...base,
      coHostBusy: [{ startsAt: "2030-03-04T09:00:00.000Z", endsAt: "2030-03-04T09:30:00.000Z" }],
    });
    expect(result.times.map((t) => new Date(t.startMs).toISOString())).toEqual([
      "2030-03-04T09:30:00.000Z",
    ]);
  });

  it("never adds a time the guest page doesn't offer", () => {
    const result = openTimes({ ...base, guestSlots: ["2030-03-04T09:30:00.000Z"], coHostBusy: [] });
    expect(result.times).toHaveLength(1);
  });
});
