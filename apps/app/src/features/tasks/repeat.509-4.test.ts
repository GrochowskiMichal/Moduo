// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field (fixed): a repeat's
// "Ends on Dec 15" is written as `UNTIL=20261215T235959Z`, the person's wall clock at
// the end of that day (`specToRrule`). The engine used to float that again as if it
// were a UTC instant, so west of UTC the last day's evening occurrence never came and
// east of UTC it came back a day late. The engine (and the server's
// tasks__rrule_floating) now read UNTIL as written, in the person's zone.
// Zone-independent (the zone is passed in).
// Run: bun run --cwd apps/app test src/features/tasks/repeat.509-4.test.ts

import { describe, expect, it } from "@rstest/core";

import { occurrencesBetween } from "./recurrence-engine";
import { defaultEndDay, type RepeatSpec, repeatSummary, rruleToSpec, specToRrule } from "./repeat";

const daily = (until: string): RepeatSpec => ({
  frequency: "daily",
  interval: 1,
  weekdays: [],
  monthly: { kind: "day", day: 1 },
  end: { kind: "until", day: until },
  afterCompletion: false,
});

/** The wall-clock days (YYYY-MM-DD) of `zone` the occurrences fall on. */
const daysIn = (dates: Date[], zone: string) =>
  dates.map((d) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d));

const DEC_12_TO_15 = ["2026-12-12", "2026-12-13", "2026-12-14", "2026-12-15"];

const daysOf = (dtstart: string, zone: string, until = "2026-12-15") => {
  const rule = { rrule: specToRrule(daily(until)), dtstart, nextOccurrence: dtstart };
  const got = occurrencesBetween(
    rule,
    new Date("2026-12-10T00:00:00Z"),
    new Date("2026-12-22T00:00:00Z"),
    null,
    zone,
  );
  return daysIn(got, zone);
};

describe("HV-15 variant 509-4: a repeat's end day is the person's local day", () => {
  it("Los Angeles: a 6 PM daily repeat 'until Dec 15' still comes on Dec 15", () => {
    const zone = "America/Los_Angeles";
    // Dec 12, 18:00 in Los Angeles (PST, UTC-8).
    const dtstart = "2026-12-13T02:00:00.000Z";
    const rule = { rrule: specToRrule(daily("2026-12-15")), dtstart, nextOccurrence: dtstart };
    expect(repeatSummary(rule)).toContain("until Dec 15");
    expect(daysOf(dtstart, zone)).toEqual(DEC_12_TO_15);
  });

  it("Auckland: a 9 AM daily repeat 'until Dec 15' does not come back on Dec 16", () => {
    // Dec 12, 09:00 in Auckland (NZDT, UTC+13).
    expect(daysOf("2026-12-11T20:00:00.000Z", "Pacific/Auckland")).toEqual(DEC_12_TO_15);
  });

  // Hardening: wrong fixes that pass the two cases above.

  it("the end day's last minutes still count, and the day after never does, in any zone", () => {
    // 23:30 local: an end written as the start of the day, or noon, drops Dec 15;
    // an end pushed a day later (or UNTIL dropped) lets Dec 16 in.
    expect(daysOf("2026-12-13T07:30:00.000Z", "America/Los_Angeles")).toEqual(DEC_12_TO_15);
    expect(daysOf("2026-12-12T10:30:00.000Z", "Pacific/Auckland")).toEqual(DEC_12_TO_15);
    expect(daysOf("2026-12-12T23:30:00.000Z", "UTC")).toEqual(DEC_12_TO_15);
    // 00:00 local on the first day.
    expect(daysOf("2026-12-12T08:00:00.000Z", "America/Los_Angeles")).toEqual(DEC_12_TO_15);
  });

  it("the stored rule carries the picked day, not one shifted by the device's zone", () => {
    // Shifting the written UNTIL to the device zone's end of day makes the rule
    // depend on where it was saved (and round-trips to a different day).
    const rrule = specToRrule(daily("2026-12-15"));
    expect(rrule).toMatch(/UNTIL=20261215T235959Z?(;|$)/);
    const spec = rruleToSpec({ rrule, dtstart: null, nextOccurrence: null });
    expect(spec?.end).toEqual({ kind: "until", day: "2026-12-15" });
  });

  it("a rule saved before the fix (same UNTIL text) reads with the fixed end", () => {
    // The fix is in the readers, so existing rules need no rewrite.
    const rule = {
      rrule: "FREQ=DAILY;INTERVAL=1;UNTIL=20261215T235959Z",
      dtstart: "2026-12-13T02:00:00.000Z",
      nextOccurrence: null,
    };
    const got = occurrencesBetween(
      rule,
      new Date("2026-12-10T00:00:00Z"),
      new Date("2026-12-22T00:00:00Z"),
      null,
      "America/Los_Angeles",
    );
    expect(daysIn(got, "America/Los_Angeles")).toEqual(DEC_12_TO_15);
  });
});

// The picker's default "On a date" end (task-detail-pickers.tsx) was the UTC day
// of now + 30 days: 31 days ahead on an evening west of UTC, 29 on an early
// morning east of it.
describe("HV-15 variant 509-4: the default end day is 30 local days ahead", () => {
  it("at 00:30 and 23:30 local alike", () => {
    expect(defaultEndDay(new Date(2026, 10, 22, 0, 30))).toBe("2026-12-22");
    expect(defaultEndDay(new Date(2026, 10, 22, 23, 30))).toBe("2026-12-22");
  });

  it("across a month end and a clock change", () => {
    // Oct 31 → Nov 30, over the end of daylight saving in most northern zones.
    expect(defaultEndDay(new Date(2026, 9, 31, 23, 30))).toBe("2026-11-30");
  });
});
