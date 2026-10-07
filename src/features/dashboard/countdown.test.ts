// DB-6 — countdown math + datetime-local round-trip.

import { describe, expect, it } from "@rstest/core";

import { computeCountdown, parseLocalDateTime, toDateTimeLocalValue } from "./countdown";

describe("computeCountdown", () => {
  const now = Date.UTC(2026, 6, 9, 12, 0, 0);

  it("breaks a positive diff into days/hours/minutes/seconds", () => {
    const target = now + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000; // 2d 3h 4m 5s
    const parts = computeCountdown(now, target);
    expect(parts).toMatchObject({ days: 2, hours: 3, minutes: 4, seconds: 5, isComplete: false });
  });

  it("is complete at or past the target", () => {
    expect(computeCountdown(now, now).isComplete).toBe(true);
    expect(computeCountdown(now, now - 1000).isComplete).toBe(true);
    expect(computeCountdown(now, now - 1000).days).toBe(0);
  });
});

describe("datetime-local round-trip", () => {
  it("parses a local value to ms and back", () => {
    const value = "2026-12-31T23:59";
    const ms = parseLocalDateTime(value);
    expect(ms).not.toBeNull();
    expect(toDateTimeLocalValue(new Date(ms as number).toISOString())).toBe(value);
  });

  it("returns null/empty for blank or invalid input", () => {
    expect(parseLocalDateTime("")).toBeNull();
    expect(parseLocalDateTime("not-a-date")).toBeNull();
    expect(toDateTimeLocalValue(undefined)).toBe("");
    expect(toDateTimeLocalValue("garbage")).toBe("");
  });
});
