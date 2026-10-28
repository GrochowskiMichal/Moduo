// CALR-16 review fixes: your own event on a teammate's calendar stays in your
// week, and busy blocks are read for the days on screen plus the composer's
// horizon, never the months-wide fetch window.

import { describe, expect, it } from "@rstest/core";

import type { CalendarEventModel } from "./events";
import { splitTeammateEvents } from "./teammates";
import { busyWindowFor, windowCovers } from "./window";

const ev = (id: string, ownerId: string, calendarRef: string): CalendarEventModel => ({
  id,
  workspaceId: "w",
  ownerId,
  sourceAccountId: null,
  externalEventId: null,
  calendarId: "moduo",
  title: id,
  description: "",
  startsAt: "2026-11-03T10:00:00Z",
  endsAt: "2026-11-03T11:00:00Z",
  allDay: false,
  rrule: null,
  status: "confirmed",
  color: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  deletedAt: null,
  calendarRef,
});

describe("mine on theirs", () => {
  it("your event on Kai's calendar stays yours; Kai's own leaves", () => {
    const shared = [{ calendarId: "c-kai", ownerId: "kai", level: "view" as const }];
    const { mine, theirs } = splitTeammateEvents(
      [ev("yours-on-kai", "me", "c-kai"), ev("kais", "kai", "c-kai")],
      shared,
      "me",
    );
    expect(mine.map((e) => e.id)).toEqual(["yours-on-kai"]);
    expect(theirs.map((e) => e.id)).toEqual(["kais"]);
  });
});

describe("busy window", () => {
  const from = new Date("2026-11-02T00:00:00Z");
  const to = new Date("2026-11-09T00:00:00Z");

  it("is the days on screen, a day before and three weeks after", () => {
    expect(busyWindowFor(from, to)).toEqual({
      fromIso: "2026-11-01T00:00:00.000Z",
      toIso: "2026-11-30T00:00:00.000Z",
    });
  });

  it("covers the next week without a new read, and not the month after", () => {
    const w = busyWindowFor(from, to);
    expect(
      windowCovers(w, new Date("2026-11-09T00:00:00Z"), new Date("2026-11-16T00:00:00Z")),
    ).toBe(true);
    expect(
      windowCovers(w, new Date("2026-11-30T00:00:00Z"), new Date("2026-12-07T00:00:00Z")),
    ).toBe(false);
    expect(windowCovers(null, from, to)).toBe(false);
  });
});
