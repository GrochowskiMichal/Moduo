import { describe, expect, it } from "vitest";

import {
  addDays,
  blocksByDay,
  DEFAULT_BLOCK_MINUTES,
  type LensTask,
  localDayKey,
  parseDayKey,
  rangeLabel,
  stepAnchor,
  taskBlocks,
  visibleRange,
} from "./lens";

// Local-time fixtures: Tue 2026-06-30 anchors a Mon-start week Jun 29 – Jul 5.
const TUE = new Date(2026, 5, 30, 9, 0); // Tue Jun 30, 09:00 local
const PREFS = { weekStartsOn: 1, showWeekends: true };

function makeLensTask(overrides: Partial<LensTask> & { id: string }): LensTask {
  return {
    title: "write offer",
    scheduledAt: null,
    durationMinutes: null,
    status: "todo",
    deletedAt: null,
    ...overrides,
  };
}

describe("visibleRange — the range selector", () => {
  it("week view yields 7 local day columns honoring week start", () => {
    const range = visibleRange("week", TUE, PREFS);
    expect(range.days).toHaveLength(7);
    expect(range.days[0].getDay()).toBe(1); // Monday
    expect(localDayKey(range.days[0])).toBe("2026-06-29");
    expect(localDayKey(range.days[6])).toBe("2026-07-05");
    expect(range.endMs).toBe(new Date(2026, 6, 6).getTime());
  });

  it("hiding weekends drops Sat/Sun columns", () => {
    const range = visibleRange("week", TUE, { ...PREFS, showWeekends: false });
    expect(range.days).toHaveLength(5);
    expect(range.days.every((d) => d.getDay() !== 0 && d.getDay() !== 6)).toBe(true);
  });

  it("Sunday week start is honored", () => {
    const range = visibleRange("week", TUE, { ...PREFS, weekStartsOn: 0 });
    expect(range.days[0].getDay()).toBe(0);
    expect(localDayKey(range.days[0])).toBe("2026-06-28");
  });

  it("day view is a single column", () => {
    const range = visibleRange("day", TUE, PREFS);
    expect(range.days).toHaveLength(1);
    expect(localDayKey(range.days[0])).toBe("2026-06-30");
  });

  it("stepAnchor moves one period per view", () => {
    expect(localDayKey(stepAnchor("day", TUE, 1))).toBe("2026-07-01");
    expect(localDayKey(stepAnchor("week", TUE, 1))).toBe("2026-07-07");
    expect(localDayKey(stepAnchor("week", TUE, -1))).toBe("2026-06-23");
  });

  it("day keys round-trip through parseDayKey", () => {
    const parsed = parseDayKey("2026-06-30");
    expect(parsed).not.toBeNull();
    expect(localDayKey(parsed as Date)).toBe("2026-06-30");
    expect(parseDayKey("garbage")).toBeNull();
  });
});

describe("taskBlocks — block shaping (AC2)", () => {
  const range = visibleRange("week", TUE, PREFS);

  it("a task scheduled Tuesday 9:00/45m becomes exactly one 45-minute block on Tuesday", () => {
    const task = makeLensTask({
      id: "a",
      scheduledAt: new Date(2026, 5, 30, 9, 0).toISOString(),
      durationMinutes: 45,
    });
    const blocks = taskBlocks([task], range);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dayKey).toBe("2026-06-30");
    expect(blocks[0].durationMinutes).toBe(45);
    expect(blocks[0].endMs - blocks[0].startMs).toBe(45 * 60_000);
    expect(blocks[0].done).toBe(false);
  });

  it("30-minute default applies when duration is unset", () => {
    const task = makeLensTask({
      id: "a",
      scheduledAt: new Date(2026, 5, 30, 9, 0).toISOString(),
    });
    const [block] = taskBlocks([task], range);
    expect(block.durationMinutes).toBe(DEFAULT_BLOCK_MINUTES);
  });

  it("archived, deleted, unscheduled, and out-of-range tasks don't render", () => {
    const scheduled = new Date(2026, 5, 30, 9, 0).toISOString();
    const tasks: LensTask[] = [
      makeLensTask({ id: "archived", scheduledAt: scheduled, status: "archived" }),
      makeLensTask({ id: "deleted", scheduledAt: scheduled, deletedAt: "2026-06-30T00:00:00Z" }),
      makeLensTask({ id: "unscheduled" }),
      makeLensTask({
        id: "next-week",
        scheduledAt: new Date(2026, 6, 8, 9, 0).toISOString(),
      }),
      makeLensTask({ id: "bad-date", scheduledAt: "not-a-date" }),
    ];
    expect(taskBlocks(tasks, range)).toHaveLength(0);
  });
});

describe("taskBlocks — done rendering + no dupes (AC2, AC7)", () => {
  const range = visibleRange("week", TUE, PREFS);

  it("a completed task renders as a checked block on its day", () => {
    const task = makeLensTask({
      id: "done-task",
      scheduledAt: new Date(2026, 5, 29, 14, 0).toISOString(),
      status: "done",
    });
    const blocks = taskBlocks([task], range);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].done).toBe(true);
    expect(blocks[0].dayKey).toBe("2026-06-29");
  });

  it("never renders a task twice on any surface", () => {
    const task = makeLensTask({
      id: "once",
      scheduledAt: new Date(2026, 5, 30, 9, 0).toISOString(),
    });
    // Same row appearing twice in the input (e.g. an optimistic dupe) still
    // yields one block; grouping assigns it exactly one day column.
    const blocks = taskBlocks([task, { ...task }], range);
    expect(blocks).toHaveLength(1);
    const grouped = blocksByDay(blocks);
    const total = [...grouped.values()].reduce((n, list) => n + list.length, 0);
    expect(total).toBe(1);
    expect(grouped.get("2026-06-30")).toHaveLength(1);
  });
});

describe("rangeLabel", () => {
  const NOW_2026 = new Date(2026, 6, 2);

  it("labels a cross-month week", () => {
    const range = visibleRange("week", TUE, PREFS);
    expect(rangeLabel(range, "en-US", NOW_2026)).toBe("Jun 29 – Jul 5");
  });

  it("labels a day view with the weekday", () => {
    const range = visibleRange("day", TUE, PREFS);
    expect(rangeLabel(range, "en-US", NOW_2026)).toBe("Tuesday, June 30");
  });

  it("shows per-side years on a cross-year week and when browsing other years", () => {
    const nyWeek = visibleRange("week", new Date(2026, 11, 30), PREFS);
    expect(rangeLabel(nyWeek, "en-US", NOW_2026)).toBe("Dec 28 – Jan 3, 2027");
    // The same week viewed from 2027 marks the 2026 side instead.
    expect(rangeLabel(nyWeek, "en-US", new Date(2027, 0, 10))).toBe("Dec 28, 2026 – Jan 3");
  });
});

describe("addDays", () => {
  it("crosses month boundaries on local calendar days", () => {
    expect(localDayKey(addDays(new Date(2026, 5, 30), 2))).toBe("2026-07-02");
    expect(localDayKey(addDays(new Date(2026, 0, 1), -1))).toBe("2025-12-31");
  });
});
