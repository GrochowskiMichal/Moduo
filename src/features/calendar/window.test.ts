import { describe, expect, it } from "vitest";

import {
  allTimeCalendarWindow,
  CALENDAR_WINDOW_FUTURE_MONTHS,
  CALENDAR_WINDOW_PAST_MONTHS,
  defaultCalendarWindow,
  widenCalendarWindow,
} from "./window";

const NOW = new Date("2026-07-29T12:00:00.000Z");

describe("defaultCalendarWindow", () => {
  it("spans the configured months either side of now", () => {
    const w = defaultCalendarWindow(NOW);
    const from = new Date(w.fromIso);
    const to = new Date(w.toIso);
    expect(from.getFullYear()).toBe(NOW.getFullYear() - CALENDAR_WINDOW_PAST_MONTHS / 12);
    expect(to.getFullYear()).toBe(NOW.getFullYear() + CALENDAR_WINDOW_FUTURE_MONTHS / 12);
    expect(from.getTime()).toBeLessThan(NOW.getTime());
    expect(to.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("widenCalendarWindow", () => {
  const base = defaultCalendarWindow(NOW);

  it("returns null (no refetch) for a range already covered", () => {
    expect(widenCalendarWindow(base, new Date(NOW), new Date("2026-08-31T00:00:00Z"))).toBeNull();
  });

  it("widens backwards past the window edge, with buffer", () => {
    const need = new Date("2024-01-15T00:00:00Z");
    const next = widenCalendarWindow(base, need, new Date(NOW));
    expect(next).not.toBeNull();
    expect(Date.parse(next!.fromIso)).toBeLessThan(need.getTime());
    // Forward edge is untouched — the window grows only where it had to.
    expect(next!.toIso).toBe(base.toIso);
  });

  it("widens forwards past the window edge, with buffer", () => {
    const need = new Date("2030-01-15T00:00:00Z");
    const next = widenCalendarWindow(base, new Date(NOW), need);
    expect(next).not.toBeNull();
    expect(Date.parse(next!.toIso)).toBeGreaterThan(need.getTime());
    expect(next!.fromIso).toBe(base.fromIso);
  });

  it("never shrinks — re-visiting an inner range keeps the widened window", () => {
    const wide = widenCalendarWindow(base, new Date("2020-01-01T00:00:00Z"), new Date(NOW))!;
    expect(widenCalendarWindow(wide, new Date(NOW), new Date("2026-08-31T00:00:00Z"))).toBeNull();
  });

  it("honours a custom buffer", () => {
    const need = new Date("2030-01-15T00:00:00Z");
    const small = widenCalendarWindow(base, new Date(NOW), need, 0)!;
    const large = widenCalendarWindow(base, new Date(NOW), need, 12)!;
    expect(Date.parse(large.toIso)).toBeGreaterThan(Date.parse(small.toIso));
  });
});

describe("allTimeCalendarWindow", () => {
  it("swallows any range — nothing can widen it further", () => {
    const all = allTimeCalendarWindow();
    expect(
      widenCalendarWindow(all, new Date("1900-01-01T00:00:00Z"), new Date("2200-01-01T00:00:00Z")),
    ).toBeNull();
  });

  it("parses as real dates on both ends (the runtime interpolates them into a filter)", () => {
    const all = allTimeCalendarWindow();
    expect(Number.isNaN(Date.parse(all.fromIso))).toBe(false);
    expect(Number.isNaN(Date.parse(all.toIso))).toBe(false);
    expect(Date.parse(all.fromIso)).toBeLessThan(Date.parse(all.toIso));
    // No PostgREST logic-tree delimiter can appear in an interpolated value.
    for (const v of [all.fromIso, all.toIso]) expect(/[,()]/.test(v)).toBe(false);
  });
});
