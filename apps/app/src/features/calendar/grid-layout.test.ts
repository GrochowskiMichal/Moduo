// NOTE: the DST suite pins TZ before any Date math. Rstest isolates each test
// file in its own environment, so this never leaks into other files.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { type CalendarEventModel, continuationLabel, eventChipsInRange } from "./events";
import {
  chipSpanInDay,
  DAY_COLUMNS,
  dayGeometry,
  GRID_LAYER,
  instantAtWallMinute,
  type LayoutChip,
  layoutDayChips,
  minutesIntoDay,
  WEEK_COLUMNS,
} from "./grid-layout";

const MIN = 60_000;

function chip(id: string, startHour: number, endHour: number): LayoutChip {
  // An ordinary (non-DST) local day.
  const at = (h: number) => new Date(2026, 5, 30, Math.floor(h), Math.round((h % 1) * 60)).getTime();
  return { id, startMs: at(startHour), endMs: at(endHour) };
}

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  return Object.fromEntries(list.map((p) => [p.id, p]));
}

// ── AC1 ─────────────────────────────────────────────────────────────────────

describe("clock-change week keeps wall-clock hours", () => {
  // Mon 19 Oct – Sun 25 Oct 2026; Warsaw falls back on Sunday 25 Oct at 03:00.
  const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 19 + i));

  it("every day of the week has 24 hour labels, each on the hour it names", () => {
    for (const day of week) {
      const geom = dayGeometry(day);
      expect(geom.totalMinutes).toBe(1440);
      expect(geom.hourMarks).toHaveLength(24);
      for (const mark of geom.hourMarks) expect(mark.minuteOfDay).toBe(mark.hour * 60);
    }
  });

  it("an event on the clock-change day sits on the hour its label shows", () => {
    const geom = dayGeometry(new Date(2026, 9, 25));
    const three = new Date(2026, 9, 25, 15, 0).getTime();
    const span = chipSpanInDay(three, three + 60 * MIN, geom);
    expect(span).toEqual({ topMinutes: 15 * 60, heightMinutes: 60 });
    const mark = geom.hourMarks.find((m) => m.hour === 15);
    expect(mark?.minuteOfDay).toBe(span?.topMinutes);
  });

  it("a click at the 3 PM line saves 3 PM on the clock-change day", () => {
    const geom = dayGeometry(new Date(2026, 9, 25));
    const clickedMinute = geom.totalMinutes * (15 / 24);
    expect(instantAtWallMinute(clickedMinute, geom)).toBe(new Date(2026, 9, 25, 15, 0).getTime());
  });

  it("the spring-forward day keeps 24 wall-clock rows too", () => {
    const geom = dayGeometry(new Date(2026, 2, 29));
    expect(geom.hourMarks.map((m) => m.hour)).toEqual(Array.from({ length: 24 }, (_, h) => h));
    const nine = new Date(2026, 2, 29, 9, 0).getTime();
    expect(chipSpanInDay(nine, nine + 30 * MIN, geom)).toEqual({
      topMinutes: 540,
      heightMinutes: 30,
    });
  });

  it("the now line sits on the wall clock, and only inside its day", () => {
    const geom = dayGeometry(new Date(2026, 9, 25));
    expect(minutesIntoDay(new Date(2026, 9, 25, 11, 37).getTime(), geom)).toBe(697);
    expect(minutesIntoDay(new Date(2026, 9, 26, 0, 0).getTime(), geom)).toBeNull();
  });
});

// ── AC8 ─────────────────────────────────────────────────────────────────────

describe("overlaps split, cascade and fold", () => {
  it("non-overlapping events each take the full width", () => {
    const { placed, overflow } = layoutDayChips([chip("a", 9, 10), chip("b", 11, 12)], WEEK_COLUMNS);
    expect(overflow).toHaveLength(0);
    expect(byId(placed).a).toMatchObject({ left: 0, width: 1, coveredFromMs: null });
    expect(byId(placed).b).toMatchObject({ left: 0, width: 1, coveredFromMs: null });
  });

  it("starts within 30 minutes sit side by side", () => {
    const { placed } = layoutDayChips([chip("a", 9, 10), chip("b", 9.25, 10)], WEEK_COLUMNS);
    const p = byId(placed);
    expect(p.a).toMatchObject({ left: 0, width: 0.5 });
    expect(p.b).toMatchObject({ left: 0.5, width: 0.5 });
  });

  it("Week shows two side by side and folds the rest into +N", () => {
    const { placed, overflow } = layoutDayChips(
      [chip("a", 9, 11), chip("b", 9 + 10 / 60, 11), chip("c", 9 + 20 / 60, 11)],
      WEEK_COLUMNS,
    );
    expect(placed.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(overflow).toHaveLength(1);
    expect(overflow[0].ids).toEqual(["c"]);
    expect(overflow[0].startMs).toBe(chip("c", 9 + 20 / 60, 11).startMs);
  });

  it("Day shows four side by side and folds the fifth", () => {
    const five = ["a", "b", "c", "d", "e"].map((id, i) => chip(id, 9 + (i * 5) / 60, 11));
    const { placed, overflow } = layoutDayChips(five, DAY_COLUMNS);
    expect(placed).toHaveLength(4);
    expect(placed.every((p) => p.width === 0.25)).toBe(true);
    expect(overflow.map((o) => o.ids)).toEqual([["e"]]);
  });

  it("a start 30+ minutes into an earlier event cascades over it from 25%", () => {
    const { placed, overflow } = layoutDayChips([chip("a", 9, 11), chip("b", 10, 11)], WEEK_COLUMNS);
    expect(overflow).toHaveLength(0);
    const p = byId(placed);
    // The covered card keeps full width; it knows where it starts being covered.
    expect(p.a).toMatchObject({ left: 0, width: 1, coveredFromMs: chip("b", 10, 11).startMs });
    expect(p.b).toMatchObject({ left: 0.25, width: 0.75, coveredFromMs: null });
    expect(p.b.layer).toBeGreaterThan(p.a.layer);
  });

  it("the 30-minute line: 29 minutes splits, 30 cascades", () => {
    const split = byId(layoutDayChips([chip("a", 9, 11), chip("b", 9 + 29 / 60, 11)], WEEK_COLUMNS).placed);
    expect(split.b).toMatchObject({ left: 0.5, width: 0.5 });
    const cascade = byId(layoutDayChips([chip("a", 9, 11), chip("b", 9.5, 11)], WEEK_COLUMNS).placed);
    expect(cascade.b).toMatchObject({ left: 0.25, width: 0.75 });
  });

  it("a later event cascades over a side-by-side pair", () => {
    const { placed } = layoutDayChips(
      [chip("a", 9, 12), chip("b", 9 + 10 / 60, 12), chip("c", 10.5, 11.5)],
      WEEK_COLUMNS,
    );
    const p = byId(placed);
    expect(p.a).toMatchObject({ left: 0, width: 0.5 });
    expect(p.b).toMatchObject({ left: 0.5, width: 0.5 });
    expect(p.c).toMatchObject({ left: 0.25, width: 0.75 });
    expect(p.c.layer).toBeGreaterThan(Math.max(p.a.layer, p.b.layer));
    expect(p.c.layer).toBeLessThanOrEqual(GRID_LAYER.chipMax);
  });
});

// ── AC9 ─────────────────────────────────────────────────────────────────────

function event(id: string, start: Date, end: Date): CalendarEventModel {
  return {
    id,
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "c1",
    title: id,
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
  };
}

const weekRange = {
  view: "week" as const,
  days: Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 19 + i)),
  startMs: new Date(2026, 9, 19).getTime(),
  endMs: new Date(2026, 9, 26).getTime(),
};

const clock24 = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

describe("overnight events cross midnight", () => {
  const wed = new Date(2026, 9, 21);
  const thu = new Date(2026, 9, 22);
  const red = event("red-eye", new Date(2026, 9, 21, 22, 40), new Date(2026, 9, 22, 7, 10));

  it("shows on both days with its continuation labels", () => {
    const { timed } = eventChipsInRange([red], weekRange);
    const first = timed.get("2026-10-21")?.[0];
    const second = timed.get("2026-10-22")?.[0];
    expect(first?.eventId).toBe("red-eye");
    expect(second?.eventId).toBe("red-eye");
    expect(continuationLabel(first!, clock24)).toBe("→ Thu 7:10");
    expect(continuationLabel(second!, clock24)).toBe("from Wed 22:40");
    expect(chipSpanInDay(first!.startMs, first!.endMs, dayGeometry(wed))).toEqual({
      topMinutes: 22 * 60 + 40,
      heightMinutes: 80,
    });
    expect(chipSpanInDay(second!.startMs, second!.endMs, dayGeometry(thu))).toEqual({
      topMinutes: 0,
      heightMinutes: 7 * 60 + 10,
    });
  });

  it("an event ending exactly at midnight stays on its own day, with no label", () => {
    const late = event("late", new Date(2026, 9, 21, 23, 0), new Date(2026, 9, 22, 0, 0));
    const { timed } = eventChipsInRange([late], weekRange);
    expect(timed.get("2026-10-21")).toHaveLength(1);
    expect(timed.get("2026-10-22")).toBeUndefined();
    expect(continuationLabel(timed.get("2026-10-21")![0], clock24)).toBeNull();
  });

  it("an event that started before the range shows from the first visible day", () => {
    const early = event("early", new Date(2026, 9, 18, 21, 0), new Date(2026, 9, 19, 2, 0));
    const { timed } = eventChipsInRange([early], weekRange);
    expect(timed.get("2026-10-18")).toBeUndefined();
    expect(continuationLabel(timed.get("2026-10-19")![0], clock24)).toBe("from Sun 21:00");
  });
});
