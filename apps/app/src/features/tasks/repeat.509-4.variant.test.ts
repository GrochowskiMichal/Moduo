// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field: a repeat's "Ends on
// Dec 15" day is written as the UTC instant Dec 15 23:59:59Z (`specToRrule`), and the
// engines (this one and the server's tasks__rrule_floating) read that instant in the
// person's zone, so the end the picker shows is not the end that applies: west of UTC
// the last day's evening occurrence never comes, east of UTC it comes back a day late.
// Fails until the fix lands. Zone-independent (the zone is passed in).
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/tasks/repeat.509-4.variant.test.ts

import { describe, expect, it } from "@rstest/core";

import { occurrencesBetween } from "./recurrence-engine";
import { type RepeatSpec, repeatSummary, specToRrule } from "./repeat";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

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

hunt("HV-15 variant 509-4: a repeat's end day is read as a UTC day", () => {
  it("Los Angeles: a 6 PM daily repeat 'until Dec 15' still comes on Dec 15", () => {
    const zone = "America/Los_Angeles";
    // Dec 12, 18:00 in Los Angeles (PST, UTC-8).
    const dtstart = "2026-12-13T02:00:00.000Z";
    const rule = { rrule: specToRrule(daily("2026-12-15")), dtstart, nextOccurrence: dtstart };
    expect(repeatSummary(rule)).toContain("until Dec 15");
    const got = occurrencesBetween(
      rule,
      new Date("2026-12-12T00:00:00Z"),
      new Date("2026-12-20T00:00:00Z"),
      null,
      zone,
    );
    expect(daysIn(got, zone)).toEqual(["2026-12-12", "2026-12-13", "2026-12-14", "2026-12-15"]);
  });

  it("Auckland: a 9 AM daily repeat 'until Dec 15' does not come back on Dec 16", () => {
    const zone = "Pacific/Auckland";
    // Dec 12, 09:00 in Auckland (NZDT, UTC+13).
    const dtstart = "2026-12-11T20:00:00.000Z";
    const rule = { rrule: specToRrule(daily("2026-12-15")), dtstart, nextOccurrence: dtstart };
    const got = occurrencesBetween(
      rule,
      new Date("2026-12-11T00:00:00Z"),
      new Date("2026-12-20T00:00:00Z"),
      null,
      zone,
    );
    expect(daysIn(got, zone)).toEqual(["2026-12-12", "2026-12-13", "2026-12-14", "2026-12-15"]);
  });
});
