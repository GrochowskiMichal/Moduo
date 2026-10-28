// CALR-16 contract (specs/calendar-rethink.md AC30, §Sharing "Shared with
// you"): teammates who share with you are listed with their level, off until
// turned on, then drawn as lanes at each day's edge in a hue of their own,
// with a legend. Their events never mix into your week.
//
// `teammates.ts` is pure. Its inputs are what the server already masked:
// `calendar_shared_with_me` rows (SharedCalendar), the masked read's rows on a
// teammate's calendar (a private one already says "Busy"), and the busy blocks
// (`calendar_busy_blocks`, one row per occurrence, mapped by
// `busyBlockToEvent`). It never masks anything itself.

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import type { CalendarEventModel } from "./events";
import {
  busyBlockToEvent,
  laneOwners,
  lanesForDay,
  legendLine,
  type SharedCalendar,
  splitTeammateEvents,
  teammateBlocks,
  teammateHues,
  teammatesSharing,
  toggleTeammate,
} from "./teammates";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const iso = (d: number, h: number, m = 0) => at(d, h, m).toISOString();

function ev(over: Partial<CalendarEventModel> & { id: string }): CalendarEventModel {
  return {
    workspaceId: "w",
    ownerId: "me",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Event",
    description: "",
    startsAt: iso(3, 10),
    endsAt: iso(3, 11),
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: iso(1, 0),
    updatedAt: iso(1, 0),
    deletedAt: null,
    calendarRef: "c-mine",
    ...over,
  };
}

const MEMBERS = [
  { userId: "me", name: "Robin Hale" },
  { userId: "kai", name: "Kai Ito" },
  { userId: "nora", name: "Nora Ruiz" },
  { userId: "ana", name: "Ana Lim" },
];
const SHARED: SharedCalendar[] = [
  { calendarId: "c-kai", ownerId: "kai", level: "view" },
  { calendarId: "c-kai-family", ownerId: "kai", level: "freebusy" },
  { calendarId: "c-nora", ownerId: "nora", level: "freebusy" },
];

describe("busy blocks name their owner", () => {
  it("maps a calendar_busy_blocks row to a busy event carrying owner, calendar, kind and all-day", () => {
    const e = busyBlockToEvent(
      {
        calendar_id: "c-nora",
        owner_id: "nora",
        start_time: "2026-11-03T09:00:00Z",
        end_time: "2026-11-03T10:00:00Z",
        kind: "focus",
        all_day: false,
      },
      "w",
      2,
    );
    expect(e.id).toBe("busy:c-nora:2026-11-03T09:00:00Z:2");
    expect(e.title).toBe("Busy");
    expect(e.calendarId).toBe("busy");
    expect(e.calendarRef).toBe("c-nora");
    expect(e.ownerId).toBe("nora");
    expect(e.kind).toBe("focus");
    expect(e.allDay).toBe(false);
    expect(e.rrule).toBeNull(); // the server expanded it: one row is one occurrence
    expect(e.workspaceId).toBe("w");
    expect(e.startsAt).toBe("2026-11-03T09:00:00Z");
    expect(e.endsAt).toBe("2026-11-03T10:00:00Z");
  });

  it("reads an older reply (no owner, kind or all-day) without failing", () => {
    const e = busyBlockToEvent(
      { calendar_id: "c1", start_time: "2026-11-03T09:00:00Z", end_time: "2026-11-03T10:00:00Z" },
      "w",
      0,
    );
    expect(e.ownerId).toBeNull();
    expect(e.kind).toBe("event");
    expect(e.allDay).toBe(false);
  });
});

describe("shared with you", () => {
  it("lists each teammate once with their highest level, by name, never you", () => {
    const list = teammatesSharing(
      [...SHARED, { calendarId: "c-own", ownerId: "me", level: "view" }],
      MEMBERS,
      "me",
    );
    expect(list).toEqual([
      { userId: "kai", name: "Kai Ito", level: "view" },
      { userId: "nora", name: "Nora Ruiz", level: "freebusy" },
    ]);
  });

  it("skips a calendar whose owner isn't a member any more", () => {
    const list = teammatesSharing(
      [{ calendarId: "c-gone", ownerId: "gone", level: "view" }],
      MEMBERS,
      "me",
    );
    expect(list).toEqual([]);
  });

  it("is off until turned on, and toggles", () => {
    expect(toggleTeammate([], "kai")).toEqual(["kai"]);
    expect(toggleTeammate(["kai", "nora"], "kai")).toEqual(["nora"]);
    expect(toggleTeammate(["nora"], "kai")).toEqual(["nora", "kai"]);
  });

  it("lanes show the teammates turned on, then the ones named in the box", () => {
    expect(laneOwners([], [])).toEqual([]);
    expect(laneOwners(["nora"], ["kai", "nora"])).toEqual(["nora", "kai"]);
  });

  it("the legend names each shown teammate's level, then Hide sits beside it", () => {
    expect(
      legendLine([
        { userId: "kai", name: "Kai Ito", level: "view" },
        { userId: "nora", name: "Nora Ruiz", level: "freebusy" },
      ]),
    ).toBe("Beside your week · Kai Ito all details · Nora Ruiz busy only");
    expect(legendLine([])).toBe("");
  });
});

describe("teammates' events leave your week", () => {
  const mine = ev({ id: "m1", calendarRef: "c-mine" });
  const kaiOnMine = ev({ id: "m2", ownerId: "kai", calendarRef: "c-mine" }); // Kai can edit your calendar
  const kais = ev({ id: "k1", ownerId: "kai", calendarRef: "c-kai", title: "Design review" });
  const busy = busyBlockToEvent(
    {
      calendar_id: "c-nora",
      owner_id: "nora",
      start_time: iso(3, 9),
      end_time: iso(3, 10),
      kind: "event",
      all_day: false,
    },
    "w",
    0,
  );

  it("splits on the teammate's calendars and busy blocks; an event on your calendar stays yours", () => {
    const { mine: left, theirs } = splitTeammateEvents([mine, kaiOnMine, kais, busy], SHARED);
    expect(left.map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(theirs.map((e) => e.id)).toEqual(["k1", busy.id]);
  });
});

describe("lanes", () => {
  const week = { startMs: at(2, 0).getTime(), endMs: at(9, 0).getTime() };
  const series = ev({
    id: "k-standup",
    ownerId: "kai",
    calendarRef: "c-kai",
    title: "Standup",
    startsAt: iso(2, 9),
    endsAt: iso(2, 9, 15),
    rrule: "FREQ=DAILY",
    exdates: [iso(4, 9), iso(5, 9)], // deleted Wednesday; Thursday's replaced by the override
  });
  const override = ev({
    id: "k-standup-thu",
    ownerId: "kai",
    calendarRef: "c-kai",
    title: "Standup (late)",
    startsAt: iso(5, 11),
    endsAt: iso(5, 11, 15),
    seriesId: "k-standup",
    originalStart: iso(5, 9),
  });
  const privateOne = ev({
    id: "k-private",
    ownerId: "kai",
    calendarRef: "c-kai",
    title: "Busy", // the masked read already said so
    isPrivate: true,
    startsAt: iso(3, 14),
    endsAt: iso(3, 15),
  });
  const allDay = ev({
    id: "k-offsite",
    ownerId: "kai",
    calendarRef: "c-kai",
    allDay: true,
    startsAt: iso(6, 0),
    endsAt: iso(7, 0),
  });
  const noraBusy = busyBlockToEvent(
    {
      calendar_id: "c-nora",
      owner_id: "nora",
      start_time: iso(3, 9),
      end_time: iso(3, 10),
      kind: "focus",
      all_day: false,
    },
    "w",
    0,
  );

  const blocks = teammateBlocks([series, override, privateOne, allDay, noraBusy], SHARED, week);

  it("expands a teammate's repeat honouring its exdates; the override sits at its own time", () => {
    const kai = blocks.filter((b) => b.ownerId === "kai" && b.eventId === "k-standup");
    expect(kai.map((b) => new Date(b.startMs).getDate())).toEqual([2, 3, 6, 7, 8]);
    const thu = blocks.filter((b) => b.eventId === "k-standup-thu");
    expect(thu).toHaveLength(1);
    expect(thu[0].startMs).toBe(at(5, 11).getTime());
    expect(thu[0].title).toBe("Standup (late)");
  });

  it("keeps the server's words: a private event is the masked read's “Busy”, a busy block has no title", () => {
    expect(blocks.find((b) => b.eventId === "k-private")?.title).toBe("Busy");
    const nora = blocks.filter((b) => b.ownerId === "nora");
    expect(nora).toHaveLength(1);
    expect(nora[0].title).toBeNull();
    expect(nora[0].eventId).toBeNull();
    expect(nora[0].kind).toBe("focus");
    expect(nora[0].calendarId).toBe("c-nora");
  });

  it("lanes hold timed blocks only, ordered by start", () => {
    expect(blocks.some((b) => b.eventId === "k-offsite")).toBe(false);
    const starts = blocks.map((b) => b.startMs);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("a day has one lane per shown teammate, in the order shown, each with that day's blocks", () => {
    const tue = lanesForDay(blocks, ["nora", "kai"], at(3, 0).getTime(), at(4, 0).getTime());
    expect(tue.map((l) => l.ownerId)).toEqual(["nora", "kai"]);
    expect(tue[0].blocks).toHaveLength(1);
    expect(tue[1].blocks.map((b) => b.title)).toEqual(["Standup", "Busy"]);
    const wed = lanesForDay(blocks, ["kai"], at(4, 0).getTime(), at(5, 0).getTime());
    expect(wed).toEqual([{ ownerId: "kai", blocks: [] }]);
    expect(lanesForDay(blocks, [], at(3, 0).getTime(), at(4, 0).getTime())).toEqual([]);
  });
});

describe("teammate hues", () => {
  it("never match your calendars' hues while any is free, and never sit side by side", () => {
    const hues = teammateHues(["kai", "nora", "ana"], ["blue", "green"]);
    expect(Object.keys(hues)).toEqual(["kai", "nora", "ana"]);
    for (const h of Object.values(hues)) {
      expect(["blue", "green", "gray"]).not.toContain(h);
    }
    expect(hues.kai).not.toBe(hues.nora);
    expect(hues.nora).not.toBe(hues.ana);
  });

  it("are stable for the same input", () => {
    expect(teammateHues(["kai", "nora"], ["blue"])).toEqual(
      teammateHues(["kai", "nora"], ["blue"]),
    );
  });

  it("still differ from the neighbour when every hue is taken", () => {
    const hues = teammateHues(
      ["a", "b", "c"],
      ["blue", "green", "amber", "red", "violet", "teal", "pink"],
    );
    expect(hues.a).not.toBe(hues.b);
    expect(hues.b).not.toBe(hues.c);
    for (const h of Object.values(hues)) expect(h).not.toBe("gray");
  });
});
