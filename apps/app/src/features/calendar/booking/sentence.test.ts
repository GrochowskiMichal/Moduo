import { describe, expect, it, test } from "@rstest/core";

import {
  clockIn,
  dayLong,
  dayLongOfKey,
  dayPart,
  dayPartsOfKey,
  daysBetween,
  dayShortOfKey,
  durationPhrase,
  firstName,
  groupByDay,
  groupByPart,
  nextBookStep,
  otherOpenTimes,
  quickPicks,
  time24,
  timeLabel,
  weekdayShortOfKey,
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

describe("dates as Moduo writes them (page and emails)", () => {
  const MEETING = "2026-10-16T12:00:00Z";

  it("writes day before month and a 24-hour clock, whatever the reader's locale", () => {
    expect(dayLongOfKey("2026-10-16")).toBe("Friday 16 October");
    expect(dayShortOfKey("2026-10-16")).toBe("Fri 16 Oct");
    expect(weekdayShortOfKey("2026-10-16")).toBe("Fri");
    expect(dayPartsOfKey("2026-10-16")).toEqual({ weekday: "Fri", day: "16", month: "Oct" });
    expect(timeLabel(MEETING, "Europe/Warsaw")).toBe("14:00");
    expect(timeLabel("2026-10-16T21:05:00Z", "Europe/Warsaw")).toBe("23:05");
  });

  it("matches what the emails write for the same instant", () => {
    const at = new Date(MEETING);
    expect(dayLong(at, "Europe/Warsaw")).toBe(dayLongOfKey(zoneKey(at, "Europe/Warsaw")));
    expect(time24(at, "Europe/Warsaw")).toBe(timeLabel(MEETING, "Europe/Warsaw"));
  });

  it("reads a clock in a zone, and stays quiet for one it doesn't know", () => {
    expect(clockIn("Asia/Tokyo", new Date(MEETING))).toBe("21:00");
    expect(clockIn("Mars/Olympus")).toBe("");
  });
});

// CALR-18 · AC33: the guest page is the sentence page with carets on choices,
// "See the other N open times", and one details step ending in "Book <day> at <time>".
describe("one details step ends in Book", () => {
  const LISBON = "Europe/Lisbon";
  const NOON = "2026-10-28T12:00:00.000Z"; // Wednesday 28 October, 12:00 in Lisbon (WET)
  const ready = {
    videoToPick: null,
    dayKey: "2026-10-28",
    start: NOON,
    timeZone: LISBON,
    detailsOpen: true,
    nameOk: true,
    emailOk: true,
    question: null,
  };

  it("names the choice still missing before the details", () => {
    expect(nextBookStep({ ...ready, videoToPick: "Google Meet or Zoom" })).toEqual({
      kind: "video",
      label: "Pick Google Meet or Zoom",
    });
    expect(nextBookStep({ ...ready, dayKey: null, start: null })).toEqual({
      kind: "day",
      label: "Pick a day",
    });
    expect(nextBookStep({ ...ready, start: null })).toEqual({ kind: "time", label: "Pick a time" });
  });

  it("asks for the details as one step once a time is picked", () => {
    const closed = { ...ready, detailsOpen: false };
    expect(nextBookStep({ ...closed, nameOk: false, emailOk: false })).toEqual({
      kind: "details",
      field: "name",
      label: "Next: your details",
    });
    expect(nextBookStep({ ...closed, emailOk: false })).toEqual({
      kind: "details",
      field: "email",
      label: "Next: your details",
    });
    expect(nextBookStep({ ...closed, question: "Robin" })).toEqual({
      kind: "details",
      field: "question",
      label: "Next: your details",
    });
  });

  it("inside the details step, names the next missing field", () => {
    expect(nextBookStep({ ...ready, nameOk: false, emailOk: false })).toEqual({
      kind: "details",
      field: "name",
      label: "Add your name",
    });
    expect(nextBookStep({ ...ready, emailOk: false })).toEqual({
      kind: "details",
      field: "email",
      label: "Add your email",
    });
    expect(nextBookStep({ ...ready, question: "Robin" })).toEqual({
      kind: "details",
      field: "question",
      label: "Answer Robin's question",
    });
  });

  it("ends in Book with the day and time in the guest's zone", () => {
    expect(nextBookStep(ready)).toEqual({
      kind: "book",
      label: "Book Wednesday 28 October at 12:00",
    });
    // The optional answer never holds the button back, and a closed step that is complete books.
    expect(nextBookStep({ ...ready, detailsOpen: false })).toEqual({
      kind: "book",
      label: "Book Wednesday 28 October at 12:00",
    });
    expect(nextBookStep({ ...ready, timeZone: "Asia/Tokyo" }).label).toBe(
      "Book Wednesday 28 October at 21:00",
    );
  });

  it("offers the other open times, counting every open time but the picked one", () => {
    const slots = [NOON, "2026-10-28T13:00:00.000Z", "2026-10-29T09:00:00.000Z"];
    expect(otherOpenTimes(slots, NOON)).toBe("See the other 2 open times");
    expect(otherOpenTimes(slots.slice(0, 2), NOON)).toBe("See the one other open time");
    expect(otherOpenTimes([NOON], NOON)).toBeNull();
    expect(otherOpenTimes(slots, null)).toBeNull();
  });
});
