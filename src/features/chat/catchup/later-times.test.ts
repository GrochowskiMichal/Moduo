// Later's times (#33): in the person's zone, never the device's.

import { describe, expect, it } from "@rstest/core";

import { remindMatches } from "../composer/grammar";
import { instantOf, laterChoices, laterRefusal, localValue, pickedInstant } from "./later-times";

describe("Later's times (#33)", () => {
  it("this evening is 18:00 and tomorrow 9:00 in the person's zone", () => {
    // 14:00 in New York (EDT, UTC-4) on 16 Oct.
    const now = new Date("2026-10-16T18:00:00Z");
    const c = laterChoices(now, "America/New_York");
    expect(c.map((x) => x.id)).toEqual(["hour", "evening", "tomorrow"]);
    expect(c[0]?.at.toISOString()).toBe("2026-10-16T19:00:00.000Z");
    expect(c[1]?.at.toISOString()).toBe("2026-10-16T22:00:00.000Z");
    expect(c[2]?.at.toISOString()).toBe("2026-10-17T13:00:00.000Z");
  });

  it("after 18:00 there's no 'this evening'; tomorrow crosses midnight in the zone", () => {
    // 23:30 in Tokyo (UTC+9) is 14:30 UTC: tomorrow is the 17th, 9:00 Tokyo.
    const now = new Date("2026-10-16T14:30:00Z");
    const c = laterChoices(now, "Asia/Tokyo");
    expect(c.map((x) => x.id)).toEqual(["hour", "tomorrow"]);
    expect(c[1]?.at.toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });

  it("tomorrow across a DST change keeps 9:00 on the wall", () => {
    // 1 Nov 2026: New York goes back to EST (UTC-5).
    const now = new Date("2026-10-31T20:00:00Z");
    const c = laterChoices(now, "America/New_York");
    expect(c.find((x) => x.id === "tomorrow")?.at.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("a picked time is read in the zone, and round-trips", () => {
    const at = pickedInstant("2026-10-20T15:30", "Europe/Warsaw");
    expect(at?.toISOString()).toBe("2026-10-20T13:30:00.000Z");
    expect(localValue(at as Date, "Europe/Warsaw")).toBe("2026-10-20T15:30");
    expect(pickedInstant("tomorrow", "UTC")).toBeNull();
    expect(instantOf({ y: 2026, mo: 1, d: 1, h: 0, mi: 0 }, "UTC").toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("refuses the past and beyond a year", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(laterRefusal(new Date("2026-10-16T11:00:00Z"), now)).toBe("Pick a time in the future.");
    expect(laterRefusal(new Date("2027-10-17T12:00:00Z"), now)).toBe("Pick a time within a year.");
    expect(laterRefusal(null, now)).toBe("Pick a date and a time.");
    expect(laterRefusal(new Date("2026-10-17T12:00:00Z"), now)).toBeNull();
  });
});

describe("/remind (CV-11)", () => {
  it("is offered while the query is its word so far", () => {
    expect(remindMatches("")).toBe(true);
    expect(remindMatches("rem")).toBe(true);
    expect(remindMatches("remind")).toBe(true);
    expect(remindMatches("remind me")).toBe(false);
    expect(remindMatches("task")).toBe(false);
  });
});
