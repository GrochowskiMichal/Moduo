// The Home Today widget's now-and-next (CALR-21, specs/calendar-rethink.md
// §Assumptions "Dashboard widget") reads the same items as the Calendar
// toolbar (CALR-2, AC11): today's timed meetings, occurrences of repeats
// included, with each one's join link. Focus time is your own work and a hold
// is a time you offered, so neither is a meeting to join; nor is anything on
// another day or all day. Your own week only: teammates' events leave it.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import type { CalendarEventModel } from "./events";
import { nowAndNext, nowNextItems, todayNowNext } from "./now-next";

const ME = "u-me";
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

function event(
  over: Partial<CalendarEventModel> & { start: number; end: number },
): CalendarEventModel {
  const { start, end, ...rest } = over;
  return {
    id: "e1",
    workspaceId: "w1",
    ownerId: ME,
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Meeting",
    description: "",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: new Date(start).toISOString(),
    updatedAt: new Date(start).toISOString(),
    deletedAt: null,
    kind: "event",
    ...rest,
  };
}

const legal = event({
  id: "legal",
  title: "Legal review with Tom",
  start: at(4, 10),
  end: at(4, 11, 15),
  conferenceUrl: "https://meet.google.com/abc-defg-hij",
});
const oneOnOne = event({ id: "ana", title: "1:1 with Ana", start: at(4, 11, 30), end: at(4, 12) });
const focus = event({
  id: "focus",
  title: "Deep work",
  kind: "focus",
  start: at(4, 10, 30),
  end: at(4, 12, 30),
});
const hold = event({
  id: "hold",
  title: "Held · Intro call",
  kind: "hold",
  start: at(4, 11, 20),
  end: at(4, 11, 50),
});
const tomorrow = event({ id: "tmrw", title: "Board review", start: at(5, 9), end: at(5, 10) });
const allDay = event({
  id: "trip",
  title: "Lisbon trip",
  allDay: true,
  start: at(4, 0),
  end: at(5, 0),
});

describe("now-next items for today", () => {
  it("keeps today's timed meetings with their join links", () => {
    const items = nowNextItems([legal, oneOnOne, tomorrow, allDay], at(4, 10, 30));
    expect(items.map((i) => i.eventId).sort()).toEqual(["ana", "legal"]);
    expect(items.find((i) => i.eventId === "legal")?.joinUrl).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(items.find((i) => i.eventId === "ana")?.joinUrl).toBeNull();
  });

  it("leaves out focus time and held times", () => {
    const items = nowNextItems([legal, focus, hold, oneOnOne], at(4, 10, 30));
    expect(items.map((i) => i.eventId).sort()).toEqual(["ana", "legal"]);
  });

  it("counts today's occurrence of a repeat that began earlier", () => {
    // Wednesdays at 9:00 since 21 Oct (before the clocks went back on 25 Oct).
    const weekly = event({
      id: "standup",
      title: "Standup",
      rrule: "FREQ=WEEKLY",
      start: new Date(2026, 9, 21, 9).getTime(),
      end: new Date(2026, 9, 21, 9, 15).getTime(),
    });
    const items = nowNextItems([weekly], at(4, 8));
    expect(items).toHaveLength(1);
    expect(items[0]!.startMs).toBe(at(4, 9));
  });

  it("untitled reads Untitled", () => {
    const items = nowNextItems([{ ...oneOnOne, title: "" }], at(4, 10));
    expect(items[0]!.title).toBe("Untitled");
  });
});

describe("today's now and next", () => {
  it("names the meeting in progress and the one after it", () => {
    const out = todayNowNext([oneOnOne, legal, focus, tomorrow], at(4, 10, 45), ME);
    expect(out?.now?.eventId).toBe("legal");
    expect(out?.next?.eventId).toBe("ana");
  });

  it("is the same answer the toolbar gives", () => {
    const events = [oneOnOne, legal, hold, focus];
    const nowMs = at(4, 11, 20);
    expect(todayNowNext(events, nowMs, ME)).toEqual(nowAndNext(nowNextItems(events, nowMs), nowMs));
  });

  it("leaves a teammate's event out, and keeps yours on their calendar", () => {
    const theirs = event({
      id: "kai",
      ownerId: "u-kai",
      calendarRef: "cal-kai",
      title: "Kai: hiring sync",
      start: at(4, 10),
      end: at(4, 11),
    });
    const mineOnTheirs = event({
      id: "mine",
      ownerId: ME,
      calendarRef: "cal-kai",
      title: "Pairing with Kai",
      start: at(4, 13),
      end: at(4, 14),
    });
    const out = todayNowNext([theirs, mineOnTheirs], at(4, 10, 30), ME, [
      { calendarId: "cal-kai" },
    ]);
    expect(out?.now).toBeNull();
    expect(out?.next?.eventId).toBe("mine");
  });

  it("with nothing left today, says nothing", () => {
    expect(todayNowNext([legal, oneOnOne, tomorrow], at(4, 18), ME)).toBeNull();
  });
});
