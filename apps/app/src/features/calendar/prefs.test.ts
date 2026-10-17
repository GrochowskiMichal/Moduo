import { beforeEach, describe, expect, it } from "@rstest/core";

import {
  DEFAULT_CALENDAR_PREFS,
  defaultViewState,
  readCalendarPrefs,
  readViewState,
  sanitizeCalendarPrefs,
  sanitizeViewState,
  writeCalendarPrefs,
  writeViewState,
} from "./prefs";

const NOW = new Date(2026, 6, 2, 11, 0); // Thu Jul 2 2026, local

beforeEach(() => {
  window.localStorage.clear();
});

describe("calendar prefs domain — sane defaults + round-trip", () => {
  it("defaults: 08:00–18:00 working bound, Monday start, weekends shown", () => {
    expect(DEFAULT_CALENDAR_PREFS).toEqual({
      workStartMinute: 480,
      workEndMinute: 1080,
      weekStartsOn: 1,
      showWeekends: true,
      hiddenAccountIds: [],
      accountColors: {},
    });
  });

  it("valid prefs round-trip through the sanitizer untouched", () => {
    const prefs = {
      workStartMinute: 540,
      workEndMinute: 1020,
      weekStartsOn: 0,
      showWeekends: false,
      hiddenAccountIds: ["acct-1"],
      accountColors: { "acct-1": "teal" },
    };
    expect(sanitizeCalendarPrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
  });

  it("garbage and partial shapes fall back field-by-field", () => {
    expect(sanitizeCalendarPrefs(null)).toEqual(DEFAULT_CALENDAR_PREFS);
    expect(sanitizeCalendarPrefs("nope")).toEqual(DEFAULT_CALENDAR_PREFS);
    expect(sanitizeCalendarPrefs({ weekStartsOn: 6, workStartMinute: "9am" })).toEqual({
      ...DEFAULT_CALENDAR_PREFS,
      weekStartsOn: 6,
    });
    // Inverted working hours reset as a pair.
    expect(sanitizeCalendarPrefs({ workStartMinute: 1200, workEndMinute: 300 })).toEqual(
      DEFAULT_CALENDAR_PREFS,
    );
    // Out-of-range minutes fall back.
    expect(sanitizeCalendarPrefs({ workEndMinute: 9999 })).toEqual(DEFAULT_CALENDAR_PREFS);
  });

  it("round-trips through localStorage per user", () => {
    const prefs = { ...DEFAULT_CALENDAR_PREFS, showWeekends: false };
    writeCalendarPrefs("u1", prefs);
    expect(readCalendarPrefs("u1")).toEqual(prefs);
    expect(readCalendarPrefs("u2")).toEqual(DEFAULT_CALENDAR_PREFS);
  });
});

describe("view state — the localStorage half", () => {
  it("defaults to Week view anchored on today", () => {
    expect(defaultViewState(NOW)).toEqual({ view: "week", anchor: "2026-07-02" });
    expect(readViewState("u1", "w1", NOW)).toEqual({
      view: "week",
      anchor: "2026-07-02",
    });
  });

  it("round-trips per user+workspace", () => {
    writeViewState("u1", "w1", { view: "day", anchor: "2026-07-01" });
    expect(readViewState("u1", "w1", NOW)).toEqual({
      view: "day",
      anchor: "2026-07-01",
    });
    // A different workspace stays on its own defaults.
    expect(readViewState("u1", "w2", NOW).view).toBe("week");
  });

  it("sanitizes corrupt values back to defaults", () => {
    expect(sanitizeViewState({ view: "month", anchor: "07/01" }, NOW)).toEqual({
      view: "week",
      anchor: "2026-07-02",
    });
    window.localStorage.setItem("moduo:calendar:view:u1:w1", "{not json");
    expect(readViewState("u1", "w1", NOW)).toEqual(defaultViewState(NOW));
  });
});
