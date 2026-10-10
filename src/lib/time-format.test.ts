import { describe, expect, it } from "@rstest/core";

import {
  dayOffset,
  formatDate,
  formatDay,
  formatDayTime,
  formatDuration,
  formatDurationSeconds,
  formatStamp,
  formatTime,
  formatWhen,
} from "./time-format";

// Friday 9 October 2026, 10:00 local.
const NOW = new Date(2026, 9, 9, 10, 0);
const at = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo, d, h, mi);

// Day order and the 12/24-hour clock follow the device, so the expected
// strings for those parts come from the same Intl formats.
const time = (d: Date) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
const monthDay = (d: Date) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
const monthDayYear = (d: Date) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(d);
const weekday = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);

describe("one date grammar (decision 41)", () => {
  it("near days read as words, the coming week as weekdays", () => {
    expect(formatDay(at(2026, 9, 9), NOW)).toBe("Today");
    expect(formatDay(at(2026, 9, 10), NOW)).toBe("Tomorrow");
    expect(formatDay(at(2026, 9, 8), NOW)).toBe("Yesterday");
    expect(formatDay(at(2026, 9, 12), NOW)).toBe(weekday(at(2026, 9, 12)));
    expect(formatDay(at(2026, 9, 15), NOW)).toBe(weekday(at(2026, 9, 15)));
  });

  it("further days show the month and day, with the year only when it differs", () => {
    expect(formatDay(at(2026, 9, 16), NOW)).toBe(monthDay(at(2026, 9, 16)));
    expect(formatDay(at(2026, 8, 30), NOW)).toBe(monthDay(at(2026, 8, 30)));
    expect(formatDay(at(2027, 9, 16), NOW)).toBe(monthDayYear(at(2027, 9, 16)));
    expect(formatDate(at(2026, 9, 10), NOW)).toBe(monthDay(at(2026, 9, 10)));
  });

  it("times always carry their minutes", () => {
    const three = at(2026, 9, 9, 15, 0);
    expect(formatTime(three)).toBe(time(three));
    expect(formatTime(three)).toMatch(/00/);
  });

  it("a day and a time join one way everywhere", () => {
    const t = at(2026, 9, 10, 15, 0);
    expect(formatDayTime(t, NOW)).toBe(`Tomorrow, ${time(t)}`);
    expect(formatWhen(at(2026, 9, 9, 15, 0), NOW)).toBe(time(at(2026, 9, 9, 15, 0)));
    expect(formatWhen(t, NOW)).toBe(`Tomorrow, ${time(t)}`);
    expect(formatStamp(t, NOW)).toBe(`${monthDay(t)}, ${time(t)}`);
  });

  it("invalid input is empty, never 'Invalid Date'", () => {
    expect(formatDay("nope", NOW)).toBe("");
    expect(formatTime("nope")).toBe("");
    expect(formatDayTime("nope", NOW)).toBe("");
    expect(Number.isNaN(dayOffset("nope", NOW))).toBe(true);
  });
});

describe("one duration grammar", () => {
  it("45m · 1h 30m · 4h · 0m", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(240)).toBe("4h");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });

  it("seconds round to the minute", () => {
    expect(formatDurationSeconds(29)).toBe("0m");
    expect(formatDurationSeconds(5400)).toBe("1h 30m");
  });
});
