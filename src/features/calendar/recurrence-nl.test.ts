import { describe, expect, it } from "vitest";

import { parseRecurrenceNL } from "./recurrence-nl";

describe("parseRecurrenceNL — the pinned phrase set (AC5)", () => {
  it('"every tuesday and thursday at 9" → weekly Tue/Thu at 9:00 with echo', () => {
    const p = parseRecurrenceNL("every tuesday and thursday at 9");
    expect(p).not.toBeNull();
    expect(p?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(p?.timeOfDay).toEqual({ hour: 9, minute: 0 });
    expect(p?.echo).toContain("weekly on Tue & Thu");
    expect(p?.echo).toContain("9:00");
  });

  it('"every other friday" → biweekly Friday', () => {
    const p = parseRecurrenceNL("every other friday");
    expect(p?.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR");
    expect(p?.timeOfDay).toBeNull();
    expect(p?.echo).toBe("every other Friday");
  });

  it('"first monday of the month" → monthly nth weekday', () => {
    const p = parseRecurrenceNL("first monday of the month");
    expect(p?.rrule).toBe("FREQ=MONTHLY;BYDAY=1MO");
    expect(p?.echo).toBe("monthly on the first Mon");
  });

  it('"last friday of month" and "third wed of every month" parse too', () => {
    expect(parseRecurrenceNL("last friday of month")?.rrule).toBe(
      "FREQ=MONTHLY;BYDAY=-1FR",
    );
    expect(parseRecurrenceNL("third wed of every month")?.rrule).toBe(
      "FREQ=MONTHLY;BYDAY=3WE",
    );
  });

  it("presets: every day / weekdays / every week / every month", () => {
    expect(parseRecurrenceNL("every day")?.rrule).toBe("FREQ=DAILY");
    expect(parseRecurrenceNL("daily")?.rrule).toBe("FREQ=DAILY");
    expect(parseRecurrenceNL("weekdays")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(parseRecurrenceNL("every weekday")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(parseRecurrenceNL("every week")?.rrule).toBe("FREQ=WEEKLY");
    expect(parseRecurrenceNL("monthly")?.rrule).toBe("FREQ=MONTHLY");
  });

  it("intervals: every 2 weeks / every 3 days", () => {
    expect(parseRecurrenceNL("every 2 weeks")?.rrule).toBe(
      "FREQ=WEEKLY;INTERVAL=2",
    );
    expect(parseRecurrenceNL("every 3 days")?.rrule).toBe(
      "FREQ=DAILY;INTERVAL=3",
    );
    expect(parseRecurrenceNL("every 1 week")?.rrule).toBe("FREQ=WEEKLY");
  });

  it("time variants: 9:30 / 9am / 5pm / noon", () => {
    expect(parseRecurrenceNL("every tue at 9:30")?.timeOfDay).toEqual({
      hour: 9,
      minute: 30,
    });
    expect(parseRecurrenceNL("every tue at 9am")?.timeOfDay).toEqual({
      hour: 9,
      minute: 0,
    });
    expect(parseRecurrenceNL("every tue at 5pm")?.timeOfDay).toEqual({
      hour: 17,
      minute: 0,
    });
    expect(parseRecurrenceNL("every tue at noon")?.timeOfDay).toEqual({
      hour: 12,
      minute: 0,
    });
  });

  it("weekday lists dedupe and sort into week order", () => {
    const p = parseRecurrenceNL("every thursday, monday and thursday");
    expect(p?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TH");
    expect(p?.echo).toBe("weekly on Mon & Thu");
  });

  it("garbage input flags unparsed and produces no rule", () => {
    expect(parseRecurrenceNL("whenever I feel like it")).toBeNull();
    expect(parseRecurrenceNL("every blorpday at 9")).toBeNull();
    expect(parseRecurrenceNL("")).toBeNull();
    expect(parseRecurrenceNL("at 9")).toBeNull();
    expect(parseRecurrenceNL("every 0 days")).toBeNull();
  });
});
