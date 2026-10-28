import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import { findNextGap } from "./gap-finder";
import { openingScrollMinute } from "./grid-layout";
import { useCalendarPrefs } from "./hooks/use-calendar-prefs";
import {
  DEFAULT_CALENDAR_PREFS,
  defaultViewState,
  offHoursWash,
  readCalendarPrefs,
  readViewState,
  sanitizeCalendarPrefs,
  sanitizeViewState,
  writeCalendarPrefs,
  writeViewState,
} from "./prefs";

const pushed = rs.hoisted(() => ({ list: [] as unknown[] }));
rs.mock("../../lib/prefs-sync", () => ({
  useDomainSync: () => ({ pushLocalChange: (v: unknown) => pushed.list.push(v) }),
}));

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
    expect(sanitizeViewState({ view: "agenda", anchor: "07/01" }, NOW)).toEqual({
      view: "week",
      anchor: "2026-07-02",
    });
    window.localStorage.setItem("moduo:calendar:view:u1:w1", "{not json");
    expect(readViewState("u1", "w1", NOW)).toEqual(defaultViewState(NOW));
  });
});

// AC45 (CALR-13): working hours, weekends and week start are set from the
// calendar; the wash, the opening scroll and free-time hops follow them, and
// they sync to user preferences.
describe("working hours drive the week", () => {
  const tue = new Date(2026, 9, 27);
  const sat = new Date(2026, 9, 31);
  const hours = { ...DEFAULT_CALENDAR_PREFS, workStartMinute: 10 * 60, workEndMinute: 16 * 60 };

  it("moves the off-hours wash and washes a whole weekend day", () => {
    expect(offHoursWash(DEFAULT_CALENDAR_PREFS, tue)).toEqual({ top: 480, bottomFrom: 1080 });
    expect(offHoursWash(hours, tue)).toEqual({ top: 600, bottomFrom: 960 });
    expect(offHoursWash(hours, sat)).toEqual({ top: 1440, bottomFrom: 1440 });
  });

  it("opens the grid at the new start", () => {
    const at = (p: typeof hours) =>
      openingScrollMinute({
        workStartMinute: p.workStartMinute,
        workEndMinute: p.workEndMinute,
        nowMinute: null,
        viewportMinutes: 600,
      });
    expect(at(hours) - at(DEFAULT_CALENDAR_PREFS)).toBe(120);
  });

  it("hops to free time inside the new hours", () => {
    const gap = findNextGap({
      nowMs: new Date(2026, 9, 27, 6).getTime(),
      dayStartMs: tue.getTime(),
      workStartMinute: hours.workStartMinute,
      workEndMinute: hours.workEndMinute,
      durationMinutes: 30,
      busy: [],
    });
    expect(gap).toBe(new Date(2026, 9, 27, 10).getTime());
  });

  it("saves new hours and weekends to user preferences", () => {
    pushed.list.length = 0;
    const { result } = renderHook(() => useCalendarPrefs("u-hours"));
    act(() => {
      result.current.updatePrefs({ workStartMinute: 600, workEndMinute: 960, showWeekends: false });
    });
    expect(result.current.prefs.workStartMinute).toBe(600);
    expect(result.current.prefs.showWeekends).toBe(false);
    expect(pushed.list.at(-1)).toMatchObject({
      workStartMinute: 600,
      workEndMinute: 960,
      showWeekends: false,
    });
    expect(readCalendarPrefs("u-hours").workEndMinute).toBe(960);
  });
});
