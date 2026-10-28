// Held times on the grid (CALR-19, specs/calendar-rethink.md AC34): an offer's
// holds are calendar items of kind "hold" that carry their offer; the grid
// draws them as dashed "Held · …" blocks, and the card's Release holds acts on
// the offer.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { isHoldItem } from "./booking/offer";
import { type CalendarEventModel, eventChipsInRange } from "./events";

function event(over: Partial<CalendarEventModel> = {}): CalendarEventModel {
  const start = new Date(2026, 10, 3, 10, 0);
  const end = new Date(2026, 10, 3, 10, 30);
  return {
    id: "h1",
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Held · Investor meeting",
    description: "",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
    kind: "hold",
    offerId: "offer-1",
    ...over,
  };
}

const week = {
  view: "week" as const,
  days: Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 2 + i)),
  startMs: new Date(2026, 10, 2).getTime(),
  endMs: new Date(2026, 10, 9).getTime(),
};

describe("held times (AC34)", () => {
  it("a hold is the kind 'hold', nothing else", () => {
    expect(isHoldItem({ kind: "hold" })).toBe(true);
    expect(isHoldItem({ kind: "focus" })).toBe(false);
    expect(isHoldItem({ kind: "event" })).toBe(false);
    expect(isHoldItem({})).toBe(false);
  });

  it("a hold's chip says it's held and keeps its title", () => {
    const chip = eventChipsInRange([event()], week).timed.get("2026-11-03")?.[0];
    expect(chip?.held).toBe(true);
    expect(chip?.focus).toBe(false);
    expect(chip?.title).toBe("Held · Investor meeting");
  });

  it("an ordinary event's chip isn't held", () => {
    const chip = eventChipsInRange([event({ kind: "event", offerId: null })], week).timed.get(
      "2026-11-03",
    )?.[0];
    expect(chip?.held).toBe(false);
  });

  it("a released hold leaves the grid", () => {
    const gone = eventChipsInRange(
      [event({ deletedAt: new Date(2026, 10, 2).toISOString() })],
      week,
    );
    expect(gone.timed.get("2026-11-03") ?? []).toEqual([]);
  });
});
