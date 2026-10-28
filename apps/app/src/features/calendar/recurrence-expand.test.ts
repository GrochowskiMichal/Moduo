// The DST wall-clock assertions pin TZ before any Date math (vitest isolates
// per file, so this never leaks).
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { type ExpandableEvent, expandEventOccurrences } from "./recurrence-expand";

function event(overrides: Partial<ExpandableEvent>): ExpandableEvent {
  return {
    id: "e1",
    startsAt: new Date(2026, 5, 30, 9, 0).toISOString(), // Tue Jun 30 09:00
    endsAt: new Date(2026, 5, 30, 9, 30).toISOString(),
    rrule: null,
    ...overrides,
  };
}

// The CAL-1 visible week: Mon Jun 29 – Sun Jul 5 (local).
const WEEK_START = new Date(2026, 5, 29).getTime();
const WEEK_END = new Date(2026, 6, 6).getTime();

describe("expandEventOccurrences — range expansion (AC5)", () => {
  it("a weekly Tue/Thu event yields exactly the Tue/Thu chips inside a visible week", () => {
    const occ = expandEventOccurrences(
      event({ rrule: "FREQ=WEEKLY;BYDAY=TU,TH" }),
      WEEK_START,
      WEEK_END,
    );
    expect(occ).toHaveLength(2);
    const days = occ.map((o) => new Date(o.startMs).getDay());
    expect(days).toEqual([2, 4]); // Tue, Thu
    for (const o of occ) {
      const d = new Date(o.startMs);
      expect([d.getHours(), d.getMinutes()]).toEqual([9, 0]);
      expect(o.endMs - o.startMs).toBe(30 * 60_000);
    }
  });

  it("yields nothing outside the visible range", () => {
    const nextWeek = expandEventOccurrences(
      event({ rrule: "FREQ=WEEKLY;BYDAY=TU,TH" }),
      new Date(2026, 6, 6).getTime(),
      new Date(2026, 6, 13).getTime(),
    );
    expect(nextWeek).toHaveLength(2); // it recurs there…
    const before = expandEventOccurrences(
      event({ rrule: "FREQ=WEEKLY;BYDAY=TU,TH" }),
      new Date(2026, 5, 22).getTime(),
      new Date(2026, 5, 29).getTime(),
    );
    expect(before).toHaveLength(0); // …but never before its anchor.
  });

  it("a one-off event yields one occurrence in range, none outside", () => {
    expect(expandEventOccurrences(event({}), WEEK_START, WEEK_END)).toHaveLength(1);
    expect(expandEventOccurrences(event({}), WEEK_END, WEEK_END + 7 * 86_400_000)).toHaveLength(0);
  });

  it("keeps the wall-clock hour across a DST change (every Tuesday at 9 stays 9:00)", () => {
    // Anchor before the spring-forward (Warsaw: 2026-03-29).
    const e = event({
      startsAt: new Date(2026, 2, 24, 9, 0).toISOString(), // Tue Mar 24 09:00 CET
      endsAt: new Date(2026, 2, 24, 10, 0).toISOString(),
      rrule: "FREQ=WEEKLY;BYDAY=TU",
    });
    const after = expandEventOccurrences(
      e,
      new Date(2026, 2, 30).getTime(), // week after the change (CEST)
      new Date(2026, 3, 6).getTime(),
    );
    expect(after).toHaveLength(1);
    expect(new Date(after[0].startMs).getHours()).toBe(9);
  });

  it("finds an occurrence that starts before the range but overlaps it", () => {
    const e = event({
      startsAt: new Date(2026, 5, 28, 23, 0).toISOString(), // Sun 23:00
      endsAt: new Date(2026, 5, 29, 1, 0).toISOString(), // crosses into Mon
    });
    expect(expandEventOccurrences(e, WEEK_START, WEEK_END)).toHaveLength(1);
  });

  it("a malformed rrule degrades to the one-off occurrence, never a crash", () => {
    const occ = expandEventOccurrences(event({ rrule: "FREQ=NONSENSE;;;" }), WEEK_START, WEEK_END);
    expect(occ).toHaveLength(1);
  });
});

// AC44 (CALR-11): "This event" changes one occurrence. A deleted or replaced
// occurrence is an exdate on its series (the replacement is an override row of
// its own), so the series skips exactly that one and the rest stay.
describe("this event only (AC44)", () => {
  const daily = (exdates: string[]) =>
    event({
      startsAt: new Date(2026, 5, 29, 9, 0).toISOString(), // Mon Jun 29 09:00
      endsAt: new Date(2026, 5, 29, 9, 30).toISOString(),
      rrule: "FREQ=DAILY",
      exdates,
    });

  it("an exdate removes exactly that occurrence; the series stays", () => {
    const wednesday = new Date(2026, 6, 1, 9, 0);
    const occ = expandEventOccurrences(daily([wednesday.toISOString()]), WEEK_START, WEEK_END);
    expect(occ).toHaveLength(6);
    expect(occ.some((o) => o.startMs === wednesday.getTime())).toBe(false);
    expect(occ.some((o) => o.startMs === new Date(2026, 6, 2, 9, 0).getTime())).toBe(true);
  });

  it("an exdate written in another offset still matches its instant", () => {
    // 09:00 in Warsaw (UTC+2 in July) is 07:00Z.
    const occ = expandEventOccurrences(daily(["2026-07-01T07:00:00Z"]), WEEK_START, WEEK_END);
    expect(occ).toHaveLength(6);
  });

  it("an exdate that is no occurrence of the series changes nothing", () => {
    const occ = expandEventOccurrences(
      daily([new Date(2026, 6, 1, 10, 0).toISOString()]),
      WEEK_START,
      WEEK_END,
    );
    expect(occ).toHaveLength(7);
  });

  it("no exdates, or an empty list, keeps every occurrence", () => {
    expect(expandEventOccurrences(daily([]), WEEK_START, WEEK_END)).toHaveLength(7);
    const { exdates: _x, ...plain } = daily([]);
    expect(expandEventOccurrences(plain, WEEK_START, WEEK_END)).toHaveLength(7);
  });

  it("an exdate on a one-off event is ignored", () => {
    const one = event({ exdates: [new Date(2026, 5, 30, 9, 0).toISOString()] });
    expect(expandEventOccurrences(one, WEEK_START, WEEK_END)).toHaveLength(1);
  });
});
