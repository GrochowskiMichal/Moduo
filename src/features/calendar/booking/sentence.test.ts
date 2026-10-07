import { describe, expect, test } from "@rstest/core";
import {
  dayPart,
  daysBetween,
  durationPhrase,
  firstName,
  groupByDay,
  groupByPart,
  quickPicks,
  zoneKey,
  zonePlace,
} from "./sentence";

const WARSAW = "Europe/Warsaw";

describe("booking sentence helpers", () => {
  test("groups slots by the guest's day, not UTC", () => {
    // 23:30 UTC on Oct 7 is already Oct 8 in Warsaw (UTC+2).
    const map = groupByDay(["2026-10-08T08:00:00.000Z", "2026-10-07T23:30:00.000Z"], WARSAW);
    expect([...map.keys()]).toEqual(["2026-10-08"]);
    expect(map.get("2026-10-08")).toEqual(["2026-10-07T23:30:00.000Z", "2026-10-08T08:00:00.000Z"]);
    expect(zoneKey(new Date("2026-10-07T23:30:00.000Z"), "UTC")).toBe("2026-10-07");
  });

  test("splits a day into morning, afternoon and evening", () => {
    const slots = [
      "2026-10-08T07:00:00.000Z",
      "2026-10-08T12:00:00.000Z",
      "2026-10-08T16:00:00.000Z",
    ];
    expect(slots.map((slot) => dayPart(slot, WARSAW))).toEqual(["morning", "afternoon", "evening"]);
    expect(groupByPart(slots.slice(1), WARSAW).map((group) => group.part)).toEqual([
      "afternoon",
      "evening",
    ]);
  });

  test("suggests the soonest time, then other days at other parts of the day", () => {
    const slots = [
      "2026-10-08T07:00:00.000Z", // Thu 9:00
      "2026-10-08T12:00:00.000Z", // Thu 14:00 — same day, skipped
      "2026-10-09T08:00:00.000Z", // Fri 10:00 — same part, skipped
      "2026-10-09T13:00:00.000Z", // Fri 15:00
      "2026-10-12T07:30:00.000Z", // Mon 9:30
    ];
    expect(quickPicks(slots, WARSAW)).toEqual([
      "2026-10-08T07:00:00.000Z",
      "2026-10-09T13:00:00.000Z",
      "2026-10-12T07:30:00.000Z",
    ]);
    expect(quickPicks(["2026-10-08T07:00:00.000Z"], WARSAW)).toHaveLength(1);
    expect(quickPicks([], WARSAW)).toEqual([]);
  });

  test("phrases durations, names and places", () => {
    expect(durationPhrase(30)).toBe("30 minutes");
    expect(durationPhrase(60)).toBe("1 hour");
    expect(durationPhrase(120)).toBe("2 hours");
    expect(durationPhrase(90)).toBe("90 minutes");
    expect(firstName("  Mike Grochowski ")).toBe("Mike");
    expect(zonePlace("America/New_York")).toBe("New York");
    expect(zonePlace("UTC")).toBe("UTC");
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
  });
});
