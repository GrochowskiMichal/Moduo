// The day an instant falls on in a zone, and when that zone's next day
// starts (MOD-110: "this month" in Tasks follows the saved time zone).

import { describe, expect, it } from "@rstest/core";

import { nextZonedMidnight, zonedDay } from "./zoned-time";

const AT = new Date("2026-10-31T23:30:00.000Z");

describe("zonedDay", () => {
  it("is the zone's calendar day, which can be another month than UTC's", () => {
    expect(zonedDay(AT, "Pacific/Auckland")).toBe("2026-11-01");
    expect(zonedDay(AT, "America/Los_Angeles")).toBe("2026-10-31");
    expect(zonedDay(AT, "UTC")).toBe("2026-10-31");
    expect(zonedDay(AT, null)).toBe("2026-10-31");
  });
});

describe("nextZonedMidnight", () => {
  it("is the instant the zone's next day starts", () => {
    // Nov 2 00:00 in Auckland (UTC+13).
    expect(nextZonedMidnight(AT, "Pacific/Auckland").toISOString()).toBe(
      "2026-11-01T11:00:00.000Z",
    );
    // Nov 1 00:00 in Los Angeles, still on summer time (UTC-7).
    expect(nextZonedMidnight(AT, "America/Los_Angeles").toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(nextZonedMidnight(AT, "UTC").toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("follows a daylight-saving change", () => {
    // Warsaw moves to summer time at 02:00 on Mar 29, 2026.
    expect(
      nextZonedMidnight(new Date("2026-03-28T22:00:00.000Z"), "Europe/Warsaw").toISOString(),
    ).toBe("2026-03-28T23:00:00.000Z");
    expect(
      nextZonedMidnight(new Date("2026-03-29T12:00:00.000Z"), "Europe/Warsaw").toISOString(),
    ).toBe("2026-03-29T22:00:00.000Z");
  });
});
