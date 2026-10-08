import { describe, expect, it } from "@rstest/core";

import {
  canonicalTimeZone,
  dateLong,
  dayLong,
  dayShort,
  isValidTimeZone,
  time24,
  usableTimeZone,
  zoneLabel,
} from "./format.ts";

const MEETING = new Date("2026-10-16T12:00:00Z"); // 14:00 in Warsaw (CEST)

describe("email dates", () => {
  it("writes day before month and a 24-hour time in the reader's zone", () => {
    expect(dayLong(MEETING, "Europe/Warsaw")).toBe("Friday 16 October");
    expect(dayShort(MEETING, "Europe/Warsaw")).toBe("Fri 16 Oct");
    expect(time24(MEETING, "Europe/Warsaw")).toBe("14:00");
    expect(time24(MEETING, "America/New_York")).toBe("08:00");
    expect(dateLong(new Date("2027-10-08T10:00:00Z"), "Europe/Warsaw")).toBe("8 October 2027");
  });

  it("crosses midnight correctly", () => {
    expect(dayLong(new Date("2026-10-16T23:30:00Z"), "Asia/Tokyo")).toBe("Saturday 17 October");
    expect(time24(new Date("2026-10-16T23:30:00Z"), "Asia/Tokyo")).toBe("08:30");
  });

  it("names the zone like the booking page", () => {
    expect(zoneLabel("Europe/Warsaw")).toBe("Warsaw time");
    expect(zoneLabel("America/New_York")).toBe("New York time");
    expect(zoneLabel("UTC")).toBe("UTC");
  });

  it("falls back from a zone it can't use", () => {
    expect(isValidTimeZone("Europe/Warsaw")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(usableTimeZone("Mars/Olympus", "Europe/Warsaw")).toBe("Europe/Warsaw");
    expect(usableTimeZone("Mars/Olympus", "Nope/Nope")).toBe("UTC");
  });

  it("only accepts real zone names, in their canonical spelling", () => {
    expect(canonicalTimeZone("europe/warsaw")).toBe("Europe/Warsaw");
    expect(canonicalTimeZone("utc")).toBe("UTC");
    expect(canonicalTimeZone("+01:00")).toBe(null);
    expect(canonicalTimeZone("x".repeat(100))).toBe(null);
    // Renamed and newer zones are real zones on every engine.
    expect(canonicalTimeZone("Europe/Kyiv")).not.toBe(null);
    expect(canonicalTimeZone("Asia/Kolkata")).not.toBe(null);
    expect(canonicalTimeZone("America/Argentina/Buenos_Aires")).not.toBe(null);
    expect(canonicalTimeZone("Etc/UTC")).toBe("UTC");
    expect(usableTimeZone("europe/warsaw")).toBe("Europe/Warsaw");
    expect(zoneLabel(usableTimeZone("europe/warsaw"))).toBe("Warsaw time");
  });
});
