// TV-D14 · Time & region (spec §14, AC12.7; REPLAN 76): one setting for every
// module. Week start, the 12/24-hour clock and the date order change the
// Tasks filters, the Calendar's weeks and every date the panel shows
// together; a device zone change asks once.

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { renderHook } from "@testing-library/react";

import { useCalendarPrefs } from "../features/calendar/hooks/use-calendar-prefs";
import { rangeLabel, visibleRange } from "../features/calendar/lens";
import { parseRecurrenceNL } from "../features/calendar/recurrence-nl";
import { formatSnoozeUntil } from "../features/email/snooze";
import { describePhaseEnd } from "../features/focus/away-copy";
import { relativeTime } from "../features/spine/comments";
import { dateCommandDay } from "../features/spine/grammar";
import { relativeDayLabel } from "../features/spine/snippet-format";
import { daysLeftInWeek } from "../features/tasks/day-buckets";
import { engineZone } from "../features/tasks/recurrence-engine";
import { formatDate, formatFullDate, formatTime, formatWeekdayDate } from "./time-format";
import {
  applyTimeRegion,
  deviceDateOrder,
  EMPTY_TIME_REGION,
  getResolvedTimeRegion,
  onTravelPrompt,
  resetTimeRegionForTests,
  resolveTimeRegion,
  saveTimeRegion,
  syncTimeRegion,
  type TimeRegion,
  type TimeRegionPatch,
  timeRegionPatchToRow,
  timeRegionRowToModel,
  travelPromptZone,
  zoneCity,
} from "./time-region";

const THU = new Date(2026, 9, 8, 15, 5); // Thursday Oct 8 2026, 15:05 local
const region = (over: Partial<TimeRegion>): TimeRegion => ({ ...EMPTY_TIME_REGION, ...over });

beforeEach(() => {
  resetTimeRegionForTests();
  localStorage.clear();
});
afterEach(() => resetTimeRegionForTests());

describe("one setting for every module (AC12.7)", () => {
  it("the week start moves Tasks' This week, the Calendar's week and /next week together", () => {
    applyTimeRegion(region({ weekStart: 1 }), "u1");
    expect(daysLeftInWeek(THU)).toBe(3); // to Sunday
    const { result, rerender } = renderHook(() => useCalendarPrefs("u1"));
    expect(result.current.prefs.weekStartsOn).toBe(1);
    expect(visibleRange("week", THU, result.current.prefs).startMs).toBe(
      new Date(2026, 9, 5).getTime(), // Monday
    );
    expect(dateCommandDay("next-week", THU)).toBe("2026-10-12");

    applyTimeRegion(region({ weekStart: 0 }), "u1");
    rerender();
    expect(daysLeftInWeek(THU)).toBe(2); // to Saturday
    expect(result.current.prefs.weekStartsOn).toBe(0);
    expect(visibleRange("week", THU, result.current.prefs).startMs).toBe(
      new Date(2026, 9, 4).getTime(), // Sunday
    );
    expect(dateCommandDay("next-week", THU)).toBe("2026-10-11");
  });

  it("the clock reads 12- or 24-hour everywhere", () => {
    applyTimeRegion(region({ hourCycle: "h23" }), "u1");
    expect(formatTime(THU)).toMatch(/^15:05$/);
    applyTimeRegion(region({ hourCycle: "h12" }), "u1");
    expect(formatTime(THU)).toMatch(/^3:05\s?PM$/i);
  });

  it("the date order reads month first or day first everywhere", () => {
    applyTimeRegion(region({ dateOrder: "month_day" }), "u1");
    expect(formatDate(new Date(2026, 9, 16), THU)).toBe("Oct 16");
    expect(formatFullDate(new Date(2027, 9, 16))).toBe("Oct 16, 2027");
    expect(formatWeekdayDate(new Date(2026, 9, 16), THU)).toBe("Fri, Oct 16");
    applyTimeRegion(region({ dateOrder: "day_month" }), "u1");
    expect(formatDate(new Date(2026, 9, 16), THU)).toBe("16 Oct");
    expect(formatFullDate(new Date(2027, 9, 16))).toBe("16 Oct 2027");
    expect(formatWeekdayDate(new Date(2026, 9, 16), THU)).toBe("Fri, 16 Oct");
  });

  it("the other modules' clocks and dates follow too (Focus, comments, snippets, email, Calendar)", () => {
    applyTimeRegion(region({ hourCycle: "h23", dateOrder: "day_month" }), "u1");
    const at = new Date(2026, 9, 8, 15, 5).getTime();
    expect(
      describePhaseEnd({ at, lengthMs: 25 * 60_000, phase: "work", longBreak: false } as never),
    ).toBe("Your 25-min focus ended at 15:05.");
    expect(relativeTime(new Date(2026, 8, 20).toISOString(), THU.getTime())).toBe("20 Sep");
    expect(relativeDayLabel(new Date(2026, 9, 20).toISOString(), THU)).toBe("20 Oct");
    expect(formatSnoozeUntil(new Date(2026, 9, 20, 9, 0).toISOString(), THU)).toBe("20 Oct 09:00");
    expect(parseRecurrenceNL("every tuesday at 9")?.echo).toContain("09:00");
    expect(
      rangeLabel(
        visibleRange("week", THU, { weekStartsOn: 1, showWeekends: true }),
        undefined,
        THU,
      ),
    ).toBe("5 Oct – 11 Oct");
  });

  it("left unset, everything follows the device", () => {
    applyTimeRegion(EMPTY_TIME_REGION, "u1");
    expect(getResolvedTimeRegion().dateOrder).toBe(deviceDateOrder());
    expect(formatDate(new Date(2026, 9, 16), THU)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
        new Date(2026, 9, 16),
      ),
    );
  });

  it("the repeat engine previews in the saved zone, the device's until there is one", () => {
    applyTimeRegion(region({ timeZone: "Asia/Tokyo" }), "u1");
    expect(engineZone()).toBe("Asia/Tokyo");
    applyTimeRegion(region({ timeZone: "Not/AZone" }), "u1");
    expect(engineZone()).toBe(getResolvedTimeRegion().deviceZone ?? "UTC");
  });

  it("resolves the device's values under what isn't set", () => {
    const device = {
      zone: "Europe/Warsaw",
      weekStart: 1 as const,
      hour12: false,
      dateOrder: "day_month" as const,
    };
    expect(resolveTimeRegion(EMPTY_TIME_REGION, device)).toEqual({
      timeZone: "Europe/Warsaw",
      deviceZone: "Europe/Warsaw",
      weekStartsOn: 1,
      hour12: false,
      dateOrder: "day_month",
    });
    expect(
      resolveTimeRegion(
        region({ timeZone: "America/New_York", weekStart: 0, hourCycle: "h12" }),
        device,
      ),
    ).toMatchObject({ timeZone: "America/New_York", weekStartsOn: 0, hour12: true });
  });
});

describe("the server's copy", () => {
  it("maps the read and sends only what changes", () => {
    expect(
      timeRegionRowToModel({
        time_zone: "Europe/Warsaw",
        time_zone_manual: true,
        week_start: 1,
        hour_cycle: "h23",
        date_order: null,
        share_time_with_owner: true,
      }),
    ).toEqual({
      timeZone: "Europe/Warsaw",
      timeZoneManual: true,
      weekStart: 1,
      hourCycle: "h23",
      dateOrder: null,
      shareTimeWithOwner: true,
    });
    expect(timeRegionPatchToRow({ weekStart: null, shareTimeWithOwner: false })).toEqual({
      week_start: null,
      share_time_with_owner: false,
    });
  });

  it("a change shows at once and goes back when the server refuses it", async () => {
    applyTimeRegion(region({ weekStart: 1 }), "u1");
    const refused = saveTimeRegion(
      {
        setTimeRegion: async () => {
          expect(getResolvedTimeRegion().weekStartsOn).toBe(0);
          throw new Error("offline");
        },
      },
      { weekStart: 0 },
    );
    await expect(refused).rejects.toThrow("offline");
    expect(getResolvedTimeRegion().weekStartsOn).toBe(1);
  });
});

function fakeRuntime(server: TimeRegion | null) {
  const sent: TimeRegionPatch[] = [];
  const oldWrites: string[] = [];
  let current = server;
  return {
    sent,
    oldWrites,
    runtime: {
      getTimeRegion: async () => current,
      setTimeRegion: async (patch: TimeRegionPatch) => {
        sent.push(patch);
        current = {
          ...(current ?? EMPTY_TIME_REGION),
          ...patch,
          ...(patch.timeZone ? { timeZoneManual: true } : {}),
        } as TimeRegion;
        return current;
      },
      setTimeZone: async (zone: string) => {
        oldWrites.push(zone);
      },
    },
  };
}

describe("travelling: a device zone change asks once", () => {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const elsewhere = device === "Asia/Tokyo" ? "Europe/Warsaw" : "Asia/Tokyo";

  it("asks only when the device's zone isn't the saved one, once per zone", () => {
    expect(travelPromptZone({ timeZone: "Europe/Warsaw" }, "America/New_York", null)).toBe(
      "America/New_York",
    );
    expect(travelPromptZone({ timeZone: "Europe/Warsaw" }, "Europe/Warsaw", null)).toBeNull();
    expect(
      travelPromptZone({ timeZone: "Europe/Warsaw" }, "America/New_York", "America/New_York"),
    ).toBeNull();
    expect(travelPromptZone({ timeZone: null }, "America/New_York", null)).toBeNull();
    expect(zoneCity("America/New_York")).toBe("New York");
  });

  it("a zone nobody picked becomes this device's, without asking", async () => {
    const asks: string[] = [];
    onTravelPrompt((ask) => asks.push(ask.deviceZone));
    const { runtime, sent } = fakeRuntime(region({ timeZone: elsewhere, timeZoneManual: false }));
    await syncTimeRegion(runtime, "u1");
    expect(sent).toEqual([{ timeZone: device }]);
    expect(asks).toEqual([]);
    expect(getResolvedTimeRegion().timeZone).toBe(device);
  });

  it("a picked zone that isn't the device's asks once, then never again for that zone", async () => {
    const asks: string[] = [];
    onTravelPrompt((ask) => asks.push(`${ask.savedZone}->${ask.deviceZone}`));
    const { runtime, sent } = fakeRuntime(region({ timeZone: elsewhere, timeZoneManual: true }));
    await syncTimeRegion(runtime, "u1");
    expect(asks).toEqual([`${elsewhere}->${device}`]);
    expect(sent).toEqual([]);
    await syncTimeRegion(runtime, "u1");
    expect(asks).toHaveLength(1);
  });

  it("a prompt raised before the shell listens waits for it", async () => {
    const { runtime } = fakeRuntime(region({ timeZone: elsewhere, timeZoneManual: true }));
    await syncTimeRegion(runtime, "u1");
    const asks: string[] = [];
    onTravelPrompt((ask) => asks.push(ask.deviceZone));
    expect(asks).toEqual([device]);
  });

  it("a server without Time & region gets the old sign-in write", async () => {
    const { runtime, oldWrites } = fakeRuntime(null);
    await syncTimeRegion(runtime, "u1");
    expect(oldWrites).toEqual([device]);
  });
});
