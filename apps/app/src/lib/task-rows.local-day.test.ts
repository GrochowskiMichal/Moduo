// HV-15 509-4: the shared local-day helpers. A bare day is already a local day
// (never read as UTC midnight, the day before west of UTC); a day-shaped string
// that isn't a real day is unreadable, not rolled into the next month.
// Run: TZ=America/Los_Angeles bun run --cwd apps/app test src/lib/task-rows.local-day.test.ts

import { describe, expect, it } from "@rstest/core";

import { localDayOf, taskDueDay } from "./task-rows";

describe("localDayOf", () => {
  it("returns a real bare day as it is", () => {
    expect(localDayOf("2026-11-10")).toBe("2026-11-10");
    expect(localDayOf("2026-02-28")).toBe("2026-02-28");
    expect(localDayOf("2028-02-29")).toBe("2028-02-29");
    expect(localDayOf("2026-12-31")).toBe("2026-12-31");
  });

  it("reads an impossible bare day as unreadable", () => {
    for (const day of ["2026-02-31", "2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31"]) {
      expect(localDayOf(day)).toBeNull();
    }
  });

  it("reads an instant as its local day at 00:30 and 23:30", () => {
    expect(localDayOf(new Date(2026, 10, 10, 0, 30).toISOString())).toBe("2026-11-10");
    expect(localDayOf(new Date(2026, 10, 10, 23, 30).toISOString())).toBe("2026-11-10");
  });

  it("reads nothing and garbage as null", () => {
    expect(localDayOf(null)).toBeNull();
    expect(localDayOf("")).toBeNull();
    expect(localDayOf("not a date")).toBeNull();
  });
});

describe("taskDueDay", () => {
  it("prefers the derived day, else the due date's local day", () => {
    expect(taskDueDay({ dueOn: "2026-11-09", dueDate: "2026-11-10T12:00:00.000Z" })).toBe(
      "2026-11-09",
    );
    expect(taskDueDay({ dueDate: "2026-11-10" })).toBe("2026-11-10");
    expect(taskDueDay({ dueOn: null, dueDate: null })).toBeNull();
  });
});
