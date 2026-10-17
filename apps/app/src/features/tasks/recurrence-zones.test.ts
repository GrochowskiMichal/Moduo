// TV-D12: rules read in a time zone (parity with the server's
// tasks__rrule_next_in / _prev_in, supabase/tests/recurrence_v3.test.sql),
// ghosts for the Calendar, and "change the pattern".

import { describe, expect, it } from "@rstest/core";

import { fromFloating, toFloating } from "../../lib/zoned-time";
import type { RecurrenceRule } from "./model";
import {
  changePatternRule,
  currentOccurrence,
  occurrenceAfter,
  occurrencesBetween,
} from "./recurrence-engine";

const MONDAYS: RecurrenceRule = {
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  dtstart: "2026-10-19T07:00:00.000Z", // Monday 9:00 in Warsaw (summer time)
  nextOccurrence: null,
};

describe("zoned time", () => {
  it("writes an instant's wall clock as UTC and reads it back", () => {
    const at = new Date("2026-10-19T07:00:00.000Z");
    const floating = toFloating(at, "Europe/Warsaw");
    expect(floating.toISOString()).toBe("2026-10-19T09:00:00.000Z");
    expect(fromFloating(floating, "Europe/Warsaw").toISOString()).toBe(at.toISOString());
  });

  it("resolves the clocks' changes the way Postgres does", () => {
    // 02:30 happens twice on Oct 25 in Warsaw: the later one.
    expect(fromFloating(new Date("2026-10-25T02:30:00Z"), "Europe/Warsaw").toISOString()).toBe(
      "2026-10-25T01:30:00.000Z",
    );
    // 02:30 doesn't happen on Mar 29: read with the offset from before.
    expect(fromFloating(new Date("2026-03-29T02:30:00Z"), "Europe/Warsaw").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("leaves UTC and an unknown zone alone", () => {
    const at = new Date("2026-10-19T07:00:00.000Z");
    expect(toFloating(at, "UTC").toISOString()).toBe(at.toISOString());
    expect(toFloating(at, "Not/A_Zone").toISOString()).toBe(at.toISOString());
  });
});

describe("rules in a zone (a)", () => {
  it("a Monday 9:00 Warsaw repeat stays at 9:00 after the clocks go back", () => {
    expect(
      occurrenceAfter(
        MONDAYS,
        new Date("2026-10-20T00:00:00Z"),
        null,
        "Europe/Warsaw",
      )?.toISOString(),
    ).toBe("2026-10-26T08:00:00.000Z");
    // UTC (the default) is the old reading.
    expect(occurrenceAfter(MONDAYS, new Date("2026-10-20T00:00:00Z"))?.toISOString()).toBe(
      "2026-10-26T07:00:00.000Z",
    );
    expect(
      currentOccurrence(
        MONDAYS,
        new Date("2026-11-03T00:00:00Z"),
        null,
        "Europe/Warsaw",
      )?.toISOString(),
    ).toBe("2026-11-02T08:00:00.000Z");
  });

  it("reads UNTIL in the zone the same way as the server", () => {
    const until = (u: string) => ({ ...MONDAYS, rrule: `FREQ=WEEKLY;BYDAY=MO;UNTIL=${u}` });
    expect(
      occurrenceAfter(
        until("20261102T080000Z"),
        new Date("2026-10-27T00:00:00Z"),
        null,
        "Europe/Warsaw",
      )?.toISOString(),
    ).toBe("2026-11-02T08:00:00.000Z");
    expect(
      occurrenceAfter(
        until("20261102T075959Z"),
        new Date("2026-10-27T00:00:00Z"),
        null,
        "Europe/Warsaw",
      ),
    ).toBeNull();
  });
});

describe("ghosts on the Calendar (f)", () => {
  it("lists the occurrences in a range, in the zone", () => {
    const got = occurrencesBetween(
      MONDAYS,
      new Date("2026-10-19T00:00:00Z"),
      new Date("2026-11-03T00:00:00Z"),
      null,
      "Europe/Warsaw",
    ).map((d) => d.toISOString());
    expect(got).toEqual([
      "2026-10-19T07:00:00.000Z",
      "2026-10-26T08:00:00.000Z",
      "2026-11-02T08:00:00.000Z",
    ]);
  });

  it("caps the list and has none for a repeat that counts from completion", () => {
    const daily: RecurrenceRule = {
      rrule: "FREQ=DAILY",
      dtstart: "2026-01-01T09:00:00.000Z",
      nextOccurrence: null,
    };
    expect(
      occurrencesBetween(
        daily,
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-12-31T00:00:00Z"),
        null,
        "UTC",
        5,
      ),
    ).toHaveLength(5);
    expect(
      occurrencesBetween(
        { ...daily, mode: "after_completion" },
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-02-01T00:00:00Z"),
      ),
    ).toEqual([]);
  });
});

describe("change the pattern (g)", () => {
  it("moves a weekly rule's weekday and its start", () => {
    const moved = changePatternRule(
      { ...MONDAYS, movedFrom: "2026-10-19T07:00:00.000Z", movedDays: 2 },
      new Date("2026-10-21T07:00:00.000Z"),
      "Europe/Warsaw",
    );
    expect(moved.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(moved.dtstart).toBe("2026-10-21T07:00:00.000Z");
    expect(moved.movedFrom).toBeUndefined();
    expect(moved.movedDays).toBeUndefined();
    expect(moved.nextOccurrence).toBeNull();
  });

  it("moves a monthly rule's day; leaves richer rules' parts alone", () => {
    const monthly: RecurrenceRule = {
      rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
      dtstart: "2026-10-15T09:00:00.000Z",
      nextOccurrence: null,
    };
    expect(changePatternRule(monthly, new Date("2026-10-20T09:00:00.000Z")).rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=20",
    );
    const workdays: RecurrenceRule = {
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      dtstart: "2026-10-19T09:00:00.000Z",
      nextOccurrence: null,
    };
    expect(changePatternRule(workdays, new Date("2026-10-21T10:00:00.000Z")).rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
  });
});
