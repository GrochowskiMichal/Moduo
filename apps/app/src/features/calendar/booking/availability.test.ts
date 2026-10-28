// Open times on the week (CALR-17, specs/calendar-rethink.md AC31, AC32): a
// booking link's open times, as the panel outlines them on the week. They
// match the guest page's (the same busy rule and slot maths as booking-public),
// skip holds, skip focus time only when the link ticks it, update as the week
// fills, and on a co-host link need every co-host to have accepted and every
// host free (the guest page's answer, which intersects the hosts).

import { describe, expect, it } from "@rstest/core";

import {
  busyFromHostEvents,
  type HostEventRow,
} from "../../../../../../supabase/functions/_shared/booking-busy";
import { openTimes, type OpenTimesInput } from "./availability";
import { FOCUS_BUSY_ID, TASKS_BUSY_ID } from "./model";
import { computeOpenSlots, DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "./slots";

const ME = "user-me";
const KAI = "user-kai";

// Monday 9–11 only, in UTC, so every expected instant reads plainly.
const MONDAY_MORNING: WeeklyHours = {
  ...DEFAULT_WEEKLY_HOURS,
  mon: [{ start: "09:00", end: "11:00" }],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
};

// Sunday 1 March 2030, midnight UTC; the week shown is Mon 4 – Sun 10 March.
const NOW = new Date("2030-03-03T00:00:00.000Z");
const WEEK_FROM = new Date("2030-03-04T00:00:00.000Z");
const WEEK_TO = new Date("2030-03-11T00:00:00.000Z");

type Ev = OpenTimesInput["events"][number];

function ev(over: Partial<Ev> = {}): Ev {
  return {
    ownerId: ME,
    sourceAccountId: null,
    calendarId: "moduo",
    startsAt: "2030-03-04T09:00:00.000Z",
    endsAt: "2030-03-04T09:30:00.000Z",
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
      hostTimeZone: "UTC",
      weeklyHours: MONDAY_MORNING,
      busyCalendarIds: ["moduo", TASKS_BUSY_ID],
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

const iso = (ms: number) => new Date(ms).toISOString();

function starts(result: ReturnType<typeof openTimes>): string[] {
  return result.times.map((t) => iso(t.startMs));
}

const ALL_MONDAY = [
  "2030-03-04T09:00:00.000Z",
  "2030-03-04T09:30:00.000Z",
  "2030-03-04T10:00:00.000Z",
  "2030-03-04T10:30:00.000Z",
];

describe("openTimes · the link's open times on the week shown (AC31)", () => {
  it("lists the week's open times inside the link's hours, each as long as the meeting", () => {
    const result = openTimes(input());
    expect(result.state).toBe("open");
    expect(starts(result)).toEqual(ALL_MONDAY);
    for (const t of result.times) expect(t.endMs - t.startMs).toBe(30 * 60_000);
  });

  it("keeps to the week shown, not the whole horizon", () => {
    // The horizon reaches the next Monday too; the week ends before it.
    const result = openTimes(input());
    expect(result.times.every((t) => t.startMs >= WEEK_FROM.getTime())).toBe(true);
    expect(result.times.every((t) => t.startMs < WEEK_TO.getTime())).toBe(true);
    const next = openTimes(
      input({
        from: new Date("2030-03-11T00:00:00.000Z"),
        to: new Date("2030-03-18T00:00:00.000Z"),
      }),
    );
    expect(starts(next)[0]).toBe("2030-03-11T09:00:00.000Z");
  });

  it("an event on Moduo's calendar hides the times it covers", () => {
    const result = openTimes(input({ events: [ev()] }));
    expect(starts(result)).toEqual(ALL_MONDAY.slice(1));
  });

  it("updates as the week fills: a new event takes its time away", () => {
    const before = openTimes(input({ events: [ev()] }));
    const after = openTimes(
      input({
        events: [
          ev(),
          ev({ startsAt: "2030-03-04T10:00:00.000Z", endsAt: "2030-03-04T11:00:00.000Z" }),
        ],
      }),
    );
    expect(before.times).toHaveLength(3);
    expect(starts(after)).toEqual(["2030-03-04T09:30:00.000Z"]);
  });

  it("skips held times (a hold is busy like any event)", () => {
    const hold = ev({
      kind: "hold",
      startsAt: "2030-03-04T09:30:00.000Z",
      endsAt: "2030-03-04T10:00:00.000Z",
    });
    expect(starts(openTimes(input({ events: [hold] })))).not.toContain("2030-03-04T09:30:00.000Z");
  });

  it("focus time stays open unless the link ticks Focus time", () => {
    const focus = ev({
      kind: "focus",
      startsAt: "2030-03-04T09:00:00.000Z",
      endsAt: "2030-03-04T10:00:00.000Z",
    });
    expect(starts(openTimes(input({ events: [focus] })))).toEqual(ALL_MONDAY);
    const ticked = openTimes(
      input({
        events: [focus],
        link: { ...input().link, busyCalendarIds: ["moduo", FOCUS_BUSY_ID] },
      }),
    );
    expect(starts(ticked)).toEqual(ALL_MONDAY.slice(2));
  });

  it("an event on a calendar the link doesn't count stays open; a ticked one hides", () => {
    const google = ev({ sourceAccountId: "acct-g", calendarId: "primary" });
    expect(starts(openTimes(input({ events: [google] })))).toEqual(ALL_MONDAY);
    const counted = openTimes(
      input({ events: [google], link: { ...input().link, busyCalendarIds: ["moduo", "acct-g"] } }),
    );
    expect(starts(counted)).toEqual(ALL_MONDAY.slice(1));
  });

  it("only the host's own events count: a teammate's and a deleted one don't", () => {
    const teammate = ev({ ownerId: KAI });
    const deleted = ev({
      startsAt: "2030-03-04T10:00:00.000Z",
      endsAt: "2030-03-04T10:30:00.000Z",
      deletedAt: "2030-03-01T00:00:00.000Z",
    });
    expect(starts(openTimes(input({ events: [teammate, deleted] })))).toEqual(ALL_MONDAY);
  });

  it("work sessions hide times only when the link counts Tasks, and only the host's", () => {
    const session = {
      userId: ME,
      startsAt: "2030-03-04T09:00:00.000Z",
      endsAt: "2030-03-04T09:30:00.000Z",
    };
    const theirs = {
      ...session,
      userId: KAI,
      startsAt: "2030-03-04T10:00:00.000Z",
      endsAt: "2030-03-04T10:30:00.000Z",
    };
    expect(starts(openTimes(input({ sessions: [session, theirs] })))).toEqual(ALL_MONDAY.slice(1));
    const without = openTimes(
      input({ sessions: [session], link: { ...input().link, busyCalendarIds: ["moduo"] } }),
    );
    expect(starts(without)).toEqual(ALL_MONDAY);
  });

  it("a booked time is taken", () => {
    const booked = { startsAt: "2030-03-04T10:30:00.000Z", endsAt: "2030-03-04T11:00:00.000Z" };
    expect(starts(openTimes(input({ bookings: [booked] })))).toEqual(ALL_MONDAY.slice(0, 3));
  });

  it("keeps the link's buffers and notice", () => {
    const buffered = openTimes(
      input({ events: [ev()], link: { ...input().link, bufferAfterMinutes: 15 } }),
    );
    expect(starts(buffered)).toEqual(ALL_MONDAY.slice(2));
    const notice = openTimes(
      input({
        now: new Date("2030-03-04T09:10:00.000Z"),
        link: { ...input().link, minNoticeMinutes: 60 },
      }),
    );
    expect(starts(notice)).toEqual(["2030-03-04T10:30:00.000Z"]);
  });

  it("follows the link's own time zone for its hours", () => {
    const warsaw = openTimes(input({ link: { ...input().link, hostTimeZone: "Europe/Warsaw" } }));
    // 9:00 in Warsaw is 8:00 UTC in March (CET).
    expect(starts(warsaw)[0]).toBe("2030-03-04T08:00:00.000Z");
  });

  it("matches the guest page: the same busy rule and slots as booking-public", () => {
    const events: Ev[] = [
      ev(),
      ev({
        kind: "focus",
        startsAt: "2030-03-04T10:00:00.000Z",
        endsAt: "2030-03-04T10:30:00.000Z",
      }),
      ev({
        kind: "hold",
        startsAt: "2030-03-04T10:30:00.000Z",
        endsAt: "2030-03-04T11:00:00.000Z",
      }),
      ev({
        sourceAccountId: "acct-g",
        calendarId: "primary",
        startsAt: "2030-03-04T09:30:00.000Z",
        endsAt: "2030-03-04T10:00:00.000Z",
      }),
    ];
    const link = { ...input().link, busyCalendarIds: ["moduo", "acct-g"] };
    const rows: HostEventRow[] = events.map((e) => ({
      start_time: e.startsAt,
      end_time: e.endsAt,
      source_account_id: e.sourceAccountId,
      calendar_id: e.calendarId,
      kind: e.kind,
    }));
    const server = computeOpenSlots({
      now: NOW,
      hostTimeZone: link.hostTimeZone,
      weeklyHours: link.weeklyHours as WeeklyHours,
      durationMinutes: link.durationMinutes,
      bufferBeforeMinutes: link.bufferBeforeMinutes,
      bufferAfterMinutes: link.bufferAfterMinutes,
      horizonDays: link.horizonDays,
      minNoticeMinutes: link.minNoticeMinutes,
      busy: busyFromHostEvents(rows, link.busyCalendarIds),
    })
      .filter((d) => d >= WEEK_FROM && d < WEEK_TO)
      .map((d) => d.toISOString());
    const result = openTimes(input({ events, link }));
    expect(starts(result)).toEqual(server);
    // Focus is free here, so 10:00 stays; Moduo, the hold and Google hide the rest.
    expect(server).toEqual(["2030-03-04T10:00:00.000Z"]);
  });

  it("is limited to the guest page's answer once it has one", () => {
    const result = openTimes(
      input({ guestSlots: ["2030-03-04T09:30:00.000Z", "2030-03-04T10:30:00.000Z"] }),
    );
    expect(starts(result)).toEqual(["2030-03-04T09:30:00.000Z", "2030-03-04T10:30:00.000Z"]);
    // A local event still takes its time away before the guest page is read again.
    const filled = openTimes(
      input({
        guestSlots: ["2030-03-04T09:30:00.000Z", "2030-03-04T10:30:00.000Z"],
        events: [ev({ startsAt: "2030-03-04T09:30:00.000Z", endsAt: "2030-03-04T10:00:00.000Z" })],
      }),
    );
    expect(starts(filled)).toEqual(["2030-03-04T10:30:00.000Z"]);
    expect(openTimes(input({ guestSlots: [] })).times).toEqual([]);
    expect(starts(openTimes(input({ guestSlots: null })))).toEqual(ALL_MONDAY);
  });

  it("a paused link has no open times", () => {
    const result = openTimes(input({ link: { ...input().link, paused: true } }));
    expect(result.state).toBe("paused");
    expect(result.times).toEqual([]);
  });
});

describe("openTimes · co-hosts (AC32)", () => {
  it("stays paused until every co-host accepts, naming who it waits on", () => {
    const result = openTimes(
      input({
        hosts: [
          { userId: KAI, name: "Kai Ito", status: "pending" },
          { userId: "user-mei", name: "Mei Tan", status: "accepted" },
        ],
      }),
    );
    expect(result.state).toBe("waiting");
    expect(result.times).toEqual([]);
    expect(result.state === "waiting" ? result.waitingOn : null).toEqual(["Kai Ito"]);
  });

  it("a declined co-host keeps it paused too", () => {
    const result = openTimes(
      input({ hosts: [{ userId: KAI, name: "Kai Ito", status: "declined" }] }),
    );
    expect(result.state).toBe("waiting");
    expect(result.times).toEqual([]);
  });

  it("with every co-host accepted, shows only times all hosts are free", () => {
    // The guest page intersects the hosts' calendars; Kai is busy at 9:00 and 10:00.
    const result = openTimes(
      input({
        hosts: [{ userId: KAI, name: "Kai Ito", status: "accepted" }],
        guestSlots: ["2030-03-04T09:30:00.000Z", "2030-03-04T10:30:00.000Z"],
        events: [ev({ startsAt: "2030-03-04T10:30:00.000Z", endsAt: "2030-03-04T11:00:00.000Z" })],
      }),
    );
    expect(result.state).toBe("open");
    expect(starts(result)).toEqual(["2030-03-04T09:30:00.000Z"]);
  });

  it("before the guest page answers, a co-host link offers nothing rather than times a co-host may not have", () => {
    const result = openTimes(
      input({ hosts: [{ userId: KAI, name: "Kai Ito", status: "accepted" }], guestSlots: null }),
    );
    expect(result.times).toEqual([]);
  });
});
