// TV-TL1 · the Timeline's time axis (spec §6, REPLAN 69, AC9.9, AC2.7): day
// numbers, the endless range, the header's two tiers with the person's week
// start, and the Due per week buckets.

import { describe, expect, it } from "@rstest/core";

import {
  bottomTier,
  DAY_WIDTH,
  dateOfDay,
  dayAtX,
  dayCenterX,
  dayNumOf,
  dayNumOfDate,
  dayNumOfInstant,
  dayNumOfKey,
  drawWindow,
  extendRange,
  initialRange,
  keyOfDay,
  RANGE_EXTEND_DAYS,
  scrollLeftFor,
  stepZoom,
  strongLines,
  topTier,
  visibleDays,
  weekCounts,
  weekdayOf,
  weekStartOf,
  xOfDay,
  zoomAnchor,
} from "./timeline-scale";

const OCT_13 = dayNumOf(2026, 9, 13); // a Tuesday

describe("day numbers", () => {
  it("reads keys, local dates and instants as the same calendar day", () => {
    expect(dayNumOfKey("2026-10-13")).toBe(OCT_13);
    expect(dayNumOfDate(new Date(2026, 9, 13, 23, 59))).toBe(OCT_13);
    expect(dayNumOfInstant(new Date(2026, 9, 13, 0, 0).toISOString())).toBe(OCT_13);
    expect(dayNumOfKey("not a date")).toBeNull();
    expect(dayNumOfInstant(null)).toBeNull();
  });

  it("round-trips through keys and local midnights", () => {
    expect(keyOfDay(OCT_13)).toBe("2026-10-13");
    const d = dateOfDay(OCT_13);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 13, 0]);
  });

  it("knows weekdays and week starts (Sunday or Monday)", () => {
    expect(weekdayOf(OCT_13)).toBe(2);
    expect(weekStartOf(OCT_13, 1)).toBe(dayNumOf(2026, 9, 12)); // Monday
    expect(weekStartOf(OCT_13, 0)).toBe(dayNumOf(2026, 9, 11)); // Sunday
    expect(weekStartOf(dayNumOf(2026, 9, 11), 1)).toBe(dayNumOf(2026, 9, 5));
  });

  it("isn't moved by a DST change (one column per calendar day)", () => {
    // Europe and the US change clocks in late October / early November.
    expect(dayNumOf(2026, 10, 2) - dayNumOf(2026, 9, 24)).toBe(9);
  });
});

describe("the range", () => {
  it("opens around today and every dated item, a year and more both ways", () => {
    const range = initialRange(OCT_13, { min: OCT_13 - 30, max: OCT_13 + 90 });
    expect(range.start).toBeLessThan(OCT_13 - 30 - 300);
    expect(range.start + range.days - 1).toBeGreaterThan(OCT_13 + 90 + 300);
  });

  it("never lets a typo'd year stretch it past five years", () => {
    const range = initialRange(OCT_13, { min: OCT_13, max: OCT_13 + 365 * 100 });
    expect(range.start + range.days - 1 - OCT_13).toBeLessThan(365 * 7);
  });

  it("grows at the start (and says how far to move the scroll) near the left edge", () => {
    const range = { start: OCT_13 - 100, days: 200 };
    const grown = extendRange(range, { from: OCT_13 - 95, to: OCT_13 - 60 }, 30);
    expect(grown?.shift).toBe(RANGE_EXTEND_DAYS);
    expect(grown?.range.start).toBe(OCT_13 - 100 - RANGE_EXTEND_DAYS);
    expect(grown?.range.days).toBe(200 + RANGE_EXTEND_DAYS);
  });

  it("grows at the end without moving the scroll, and stays put in the middle", () => {
    const range = { start: OCT_13 - 100, days: 200 };
    const grown = extendRange(range, { from: OCT_13 + 60, to: OCT_13 + 90 }, 30);
    expect(grown?.shift).toBe(0);
    expect(grown?.range.days).toBe(200 + RANGE_EXTEND_DAYS);
    expect(extendRange(range, { from: OCT_13 - 20, to: OCT_13 + 20 }, 30)).toBeNull();
  });

  it("maps days to x and back, a point in the middle of its day", () => {
    const range = { start: OCT_13 - 10, days: 100 };
    const dw = DAY_WIDTH.month;
    expect(xOfDay(range, dw, OCT_13)).toBe(10 * dw);
    expect(dayCenterX(range, dw, OCT_13)).toBe(10.5 * dw);
    expect(dayAtX(range, dw, 10 * dw + 1)).toBe(OCT_13);
    expect(dayAtX(range, dw, -50)).toBe(range.start);
    expect(dayAtX(range, dw, 1e9)).toBe(range.start + range.days - 1);
  });

  it("puts today a quarter of the way across", () => {
    const range = { start: OCT_13 - 100, days: 400 };
    const dw = DAY_WIDTH.quarter;
    const left = scrollLeftFor(range, dw, OCT_13, 800);
    const shown = visibleDays(range, dw, left, 800);
    expect(OCT_13 - shown.from).toBeGreaterThanOrEqual(19);
    expect(OCT_13 - shown.from).toBeLessThanOrEqual(21);
  });

  it("redraws the header only when the scroll crosses a block", () => {
    const a = drawWindow({ from: 1001, to: 1041 });
    const b = drawWindow({ from: 1003, to: 1043 });
    expect(a).toEqual(b);
    expect(a.from).toBeLessThanOrEqual(1001 - 40);
    expect(a.to).toBeGreaterThanOrEqual(1041 + 40);
  });

  it("steps zoom in and out, stopping at the ends", () => {
    expect(stepZoom("month", 1)).toBe("quarter");
    expect(stepZoom("month", -1)).toBe("week");
    expect(stepZoom("week", -1)).toBe("week");
    expect(stepZoom("year", 1)).toBe("year");
  });
});

describe("the header", () => {
  const window = { from: dayNumOf(2026, 9, 28), to: dayNumOf(2026, 10, 5) };

  it("names months on top, with the year only when it isn't this one", () => {
    const top = topTier("month", window, OCT_13);
    expect(top.map((c) => c.start)).toEqual([dayNumOf(2026, 9, 1), dayNumOf(2026, 10, 1)]);
    expect(top[0]?.today).toBe(true);
    const next = topTier("month", { from: dayNumOf(2027, 0, 3), to: dayNumOf(2027, 0, 9) }, OCT_13);
    expect(next[0]?.label).toMatch(/2027/);
    expect(topTier("year", window, OCT_13).map((c) => c.label)).toEqual(["2026"]);
  });

  it("shows days at Week and Month, weekends marked, today marked", () => {
    const days = bottomTier("month", { from: OCT_13 - 3, to: OCT_13 }, OCT_13, 1);
    expect(days.map((c) => c.label)).toEqual(["10", "11", "12", "13"]);
    expect(days.map((c) => !!c.weekend)).toEqual([true, true, false, false]);
    expect(days.find((c) => c.today)?.start).toBe(OCT_13);
    expect(bottomTier("week", { from: OCT_13, to: OCT_13 }, OCT_13, 1)[0]?.label).toMatch(/13$/);
  });

  it("starts the Quarter's weeks on the person's week start", () => {
    const monday = bottomTier("quarter", { from: OCT_13, to: OCT_13 + 14 }, OCT_13, 1);
    expect(monday[0]?.start).toBe(dayNumOf(2026, 9, 12));
    expect(monday[0]?.label).toBe("12");
    const sunday = bottomTier("quarter", { from: OCT_13, to: OCT_13 + 14 }, OCT_13, 0);
    expect(sunday[0]?.start).toBe(dayNumOf(2026, 9, 11));
    expect(sunday[0]?.today).toBe(true);
  });

  it("shows months at Year, and stronger lines where months (or years) start", () => {
    const months = bottomTier(
      "year",
      { from: dayNumOf(2026, 0, 10), to: dayNumOf(2026, 2, 2) },
      OCT_13,
      1,
    );
    expect(months).toHaveLength(3);
    expect(strongLines("month", window)).toEqual([dayNumOf(2026, 10, 1)]);
    expect(strongLines("year", { from: dayNumOf(2026, 5, 1), to: dayNumOf(2027, 5, 1) })).toEqual([
      dayNumOf(2027, 0, 1),
    ]);
  });
});

describe("Due per week (AC2.7)", () => {
  it("counts each due day in its week, by the person's week start", () => {
    const sunday = dayNumOf(2026, 9, 18);
    const counts = weekCounts([OCT_13, OCT_13 + 1, sunday], 1);
    expect(counts.get(dayNumOf(2026, 9, 12))).toBe(3);
    const fromSunday = weekCounts([OCT_13, OCT_13 + 1, sunday], 0);
    expect(fromSunday.get(dayNumOf(2026, 9, 11))).toBe(2);
    expect(fromSunday.get(sunday)).toBe(1);
  });
});

describe("what a zoom holds still", () => {
  // Quarter (10 px a day) on a 545 px track, Today a quarter across.
  const range = { start: OCT_13 - 200, days: 600 };
  const quarter = DAY_WIDTH.quarter;
  const month = DAY_WIDTH.month;
  const track = 545;
  const scroll = scrollLeftFor(range, quarter, OCT_13, track);

  it("keeps Today where it was when the control zooms in (Quarter → Month)", () => {
    const anchor = zoomAnchor(range, quarter, scroll, track, OCT_13);
    expect(anchor.day).toBe(OCT_13 + 0.5);
    expect(anchor.at).toBeCloseTo(track / 4);
    // Applied the way the view does: Today's centre lands on the same x.
    const nextScroll = (anchor.day - range.start) * month - anchor.at;
    const todayAt = dayCenterX(range, month, OCT_13) - nextScroll;
    expect(todayAt).toBeCloseTo(track / 4);
  });

  it("would have pushed Today off the left edge with the old middle anchor", () => {
    const middle = range.start + (scroll + track / 2) / quarter;
    const nextScroll = (middle - range.start) * month - track / 2;
    expect(dayCenterX(range, month, OCT_13) - nextScroll).toBeLessThan(0);
  });

  it("holds the middle when Today is off screen", () => {
    const away = scroll + 100 * quarter;
    const anchor = zoomAnchor(range, quarter, away, track, OCT_13);
    expect(anchor.at).toBe(track / 2);
    expect(anchor.day).toBeCloseTo(range.start + (away + track / 2) / quarter);
  });

  it("holds the day under the pointer for a ⌘-scroll, Today or not", () => {
    const anchor = zoomAnchor(range, quarter, scroll, track, OCT_13, 400);
    expect(anchor.at).toBe(400);
    expect(anchor.day).toBeCloseTo(range.start + (scroll + 400) / quarter);
    expect(zoomAnchor(range, quarter, scroll, track, OCT_13, 900).at).toBe(track);
  });
});
