// Open times on the week with repeating events: the panel counts every
// occurrence of a Moduo repeat in the week shown, as booking-public does on
// the server (calendar__booking_host_events), not only the series' first
// stored start. A skipped week is free, a moved occurrence blocks its new
// time and frees its original, focus repeats are free unless the link ticks
// focus, and co-hosts' repeats take their times away too.

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { openTimes, type OpenTimesInput } from "./availability";
import { FOCUS_BUSY_ID } from "./model";
import { DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "./slots";

const ME = "user-me";
const KAI = "user-kai";

// Wednesdays 09:00–11:00 Warsaw only.
const WEDNESDAY_MORNING: WeeklyHours = {
  ...DEFAULT_WEEKLY_HOURS,
  mon: [],
  tue: [],
  wed: [{ start: "09:00", end: "11:00" }],
  thu: [],
  fri: [],
};

// Clocks went back on Sun 25 Oct 2026: 09:00 Warsaw is 08:00 UTC this week,
// 07:00 UTC when the series began.
const NOW = new Date("2026-10-26T00:00:00.000Z");
const WEEK_FROM = new Date("2026-10-25T23:00:00.000Z"); // Mon 26 Oct, Warsaw midnight
const WEEK_TO = new Date("2026-11-01T23:00:00.000Z");

const ALL_WEDNESDAY = [
  "2026-10-28T08:00:00.000Z",
  "2026-10-28T08:30:00.000Z",
  "2026-10-28T09:00:00.000Z",
  "2026-10-28T09:30:00.000Z",
];

type Ev = OpenTimesInput["events"][number];

// A weekly 1:1, Wednesdays 09:00 Warsaw, since 7 Oct.
function weekly(over: Partial<Ev> = {}): Ev {
  return {
    id: "series-1",
    ownerId: ME,
    sourceAccountId: null,
    calendarId: "moduo",
    startsAt: "2026-10-07T07:00:00.000Z",
    endsAt: "2026-10-07T07:30:00.000Z",
    rrule: "FREQ=WEEKLY",
    exdates: [],
    kind: "event",
    deletedAt: null,
    ...over,
  };
}

function input(over: Partial<OpenTimesInput> = {}): OpenTimesInput {
  return {
    link: {
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      horizonDays: 30,
      minNoticeMinutes: 0,
      hostTimeZone: "Europe/Warsaw",
      weeklyHours: WEDNESDAY_MORNING,
      busyCalendarIds: ["moduo"],
      paused: false,
    },
    hostId: ME,
    events: [],
    now: NOW,
    from: WEEK_FROM,
    to: WEEK_TO,
    ...over,
  };
}

const starts = (result: ReturnType<typeof openTimes>) =>
  result.times.map((t) => new Date(t.startMs).toISOString());

describe("openTimes · repeating events", () => {
  it("a weekly 1:1 that began three weeks ago blocks this week's slot, at 09:00 Warsaw after the clock change", () => {
    expect(starts(openTimes(input()))).toEqual(ALL_WEDNESDAY);
    expect(starts(openTimes(input({ events: [weekly()] })))).toEqual(ALL_WEDNESDAY.slice(1));
  });

  it("a series that has ended, or is deleted, blocks nothing", () => {
    const ended = weekly({ rrule: "FREQ=WEEKLY;COUNT=2" });
    const deleted = weekly({ deletedAt: "2026-10-20T10:00:00.000Z" });
    expect(starts(openTimes(input({ events: [ended, deleted] })))).toEqual(ALL_WEDNESDAY);
  });

  it("the skipped week is free", () => {
    const skipped = weekly({ exdates: ["2026-10-28T08:00:00.000Z"] });
    expect(starts(openTimes(input({ events: [skipped] })))).toEqual(ALL_WEDNESDAY);
  });

  it("a moved occurrence blocks its new time and frees its original", () => {
    const series = weekly({ exdates: ["2026-10-28T08:00:00.000Z"] });
    const moved: Ev = {
      ...weekly(),
      id: "override-1",
      rrule: null,
      startsAt: "2026-10-28T09:00:00.000Z",
      endsAt: "2026-10-28T09:30:00.000Z",
    };
    expect(starts(openTimes(input({ events: [series, moved] })))).toEqual([
      "2026-10-28T08:00:00.000Z",
      "2026-10-28T08:30:00.000Z",
      "2026-10-28T09:30:00.000Z",
    ]);
  });

  it("weekly focus time is free unless the link ticks focus", () => {
    const focus = weekly({
      id: "focus-1",
      kind: "focus",
      startsAt: "2026-10-07T08:00:00.000Z",
      endsAt: "2026-10-07T09:00:00.000Z",
    });
    expect(starts(openTimes(input({ events: [focus] })))).toEqual(ALL_WEDNESDAY);
    const ticked = input({ events: [focus] });
    ticked.link = { ...ticked.link, busyCalendarIds: ["moduo", FOCUS_BUSY_ID] };
    expect(starts(openTimes(ticked))).toEqual([
      "2026-10-28T08:00:00.000Z",
      "2026-10-28T08:30:00.000Z",
    ]);
  });

  it("a teammate's repeat on the host's week doesn't count", () => {
    expect(starts(openTimes(input({ events: [weekly({ ownerId: KAI })] })))).toEqual(ALL_WEDNESDAY);
  });

  it("an accepted co-host's repeat takes its times away", () => {
    const result = openTimes(
      input({
        hosts: [{ userId: KAI, name: "Kai", status: "accepted" }],
        guestSlots: ALL_WEDNESDAY,
        coHostBusy: [
          weekly({
            id: "kai-1",
            ownerId: KAI,
            startsAt: "2026-10-07T08:30:00.000Z",
            endsAt: "2026-10-07T09:00:00.000Z",
          }),
        ],
      }),
    );
    expect(starts(result)).toEqual([
      "2026-10-28T08:00:00.000Z",
      "2026-10-28T08:30:00.000Z",
      "2026-10-28T09:00:00.000Z",
    ]);
  });
});
