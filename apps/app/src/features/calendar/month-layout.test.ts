// AC12: Month shows six weeks, spanning bars under the date row, due counts
// beside the date, past dimmed everywhere (all-day included), and "N more"
// opens the day. One-offs come before routines in a day's lines.

import { describe, expect, it } from "@rstest/core";

import type { EventChip } from "./events";
import {
  addDays,
  type DueChip,
  localDayKey,
  rangeLabel,
  stepAnchor,
  type TaskBlock,
  visibleRange,
} from "./lens";
import { layoutMonth, MONTH_BAR_ROWS, MONTH_WEEKS, monthOf } from "./month-layout";
import { sanitizeViewState } from "./prefs";

const MON_FIRST = { weekStartsOn: 1, showWeekends: true };

// October 2026: Thu 1 Oct … Sat 31 Oct. Mon-first, the six weeks run
// Mon 28 Sep – Sun 8 Nov.
const oct14 = new Date(2026, 9, 14);
const range = visibleRange("month", oct14, MON_FIRST);
const keyOf = (y: number, m: number, d: number) => localDayKey(new Date(y, m, d));

function chip(over: Partial<EventChip> & { id: string; day: Date; from: number; to: number }) {
  const startMs = new Date(
    over.day.getFullYear(),
    over.day.getMonth(),
    over.day.getDate(),
    Math.floor(over.from),
    (over.from % 1) * 60,
  ).getTime();
  const endMs = new Date(
    over.day.getFullYear(),
    over.day.getMonth(),
    over.day.getDate(),
    Math.floor(over.to),
    (over.to % 1) * 60,
  ).getTime();
  const base: EventChip = {
    eventId: over.id,
    occurrenceKey: `${over.id}:${startMs}`,
    title: over.title ?? over.id,
    startMs,
    endMs,
    dayKey: localDayKey(over.day),
    allDay: false,
    external: false,
    readOnly: false,
    recurring: false,
    sourceAccountId: null,
    color: null,
    continuesFromMs: null,
    continuesToMs: null,
    locked: false,
  };
  const { id: _id, day: _day, from: _from, to: _to, ...rest } = over;
  return { ...base, ...rest };
}

/** An all-day item across [from, to] (inclusive days), one piece per day, as eventChipsInRange hands them out. */
function allDay(id: string, from: Date, to: Date): Map<string, EventChip[]> {
  const startMs = from.getTime();
  const endMs = addDays(to, 1).getTime();
  const out = new Map<string, EventChip[]>();
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    const dayKey = localDayKey(d);
    out.set(dayKey, [
      {
        eventId: id,
        occurrenceKey: `${id}:${startMs}`,
        title: id,
        startMs,
        endMs,
        dayKey,
        allDay: true,
        external: false,
        readOnly: false,
        recurring: false,
        sourceAccountId: null,
        color: null,
        continuesFromMs: null,
        continuesToMs: null,
        locked: false,
      },
    ]);
  }
  return out;
}

function byDay(chips: EventChip[]): Map<string, EventChip[]> {
  const out = new Map<string, EventChip[]>();
  for (const c of chips) out.set(c.dayKey, [...(out.get(c.dayKey) ?? []), c]);
  return out;
}

const NOW = new Date(2026, 9, 14, 12, 0); // Wed 14 Oct, noon

function layout(over: Partial<Parameters<typeof layoutMonth>[0]> = {}) {
  return layoutMonth({
    days: range.days,
    month: monthOf(range),
    now: NOW,
    eventsByDay: new Map(),
    allDayByDay: new Map(),
    capacity: 4,
    ...over,
  });
}

function cellOf(weeks: ReturnType<typeof layoutMonth>, key: string) {
  for (const w of weeks) for (const c of w.cells) if (c.dayKey === key) return c;
  throw new Error(`no cell ${key}`);
}

describe("month cells, bars and due counts", () => {
  it("shows six whole weeks around the month, in the week start you picked", () => {
    expect(MONTH_WEEKS).toBe(6);
    expect(range.view).toBe("month");
    expect(range.days).toHaveLength(42);
    expect(localDayKey(range.days[0])).toBe("2026-09-28");
    expect(localDayKey(range.days[41])).toBe("2026-11-08");
    const sunFirst = visibleRange("month", oct14, { weekStartsOn: 0, showWeekends: true });
    expect(localDayKey(sunFirst.days[0])).toBe("2026-09-27");
    expect(sunFirst.days).toHaveLength(42);
    // Without weekends: six weeks of five days.
    const weekdays = visibleRange("month", oct14, { weekStartsOn: 1, showWeekends: false });
    expect(weekdays.days).toHaveLength(30);
    expect(weekdays.days.every((d) => d.getDay() !== 0 && d.getDay() !== 6)).toBe(true);
  });

  it("steps a whole month and is labelled with the month", () => {
    expect(localDayKey(stepAnchor("month", new Date(2026, 0, 31), 1))).toBe("2026-02-01");
    expect(localDayKey(stepAnchor("month", oct14, -1))).toBe("2026-09-01");
    expect(rangeLabel(range, "en-US", NOW)).toBe("October 2026");
    expect(monthOf(range).getMonth()).toBe(9);
  });

  it("remembers Month as the view", () => {
    expect(sanitizeViewState({ view: "month", anchor: "2026-10-14" }).view).toBe("month");
  });

  it("lays the weeks out as rows of cells, marking the days outside the month, today and the past", () => {
    const weeks = layout();
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.cells.length === 7)).toBe(true);
    expect(cellOf(weeks, "2026-09-28").inMonth).toBe(false);
    expect(cellOf(weeks, "2026-10-01").inMonth).toBe(true);
    expect(cellOf(weeks, "2026-10-14").today).toBe(true);
    expect(cellOf(weeks, "2026-10-14").past).toBe(false);
    expect(cellOf(weeks, "2026-10-13").past).toBe(true);
    expect(cellOf(weeks, "2026-10-15").past).toBe(false);
  });

  it("puts a multi-day item as one bar under the date row, split only at week ends", () => {
    // Fri 9 Oct – Tue 13 Oct crosses the week boundary (Sun 11 / Mon 12).
    const weeks = layout({
      allDayByDay: allDay("trip", new Date(2026, 9, 9), new Date(2026, 9, 13)),
    });
    const w2 = weeks[1]; // Mon 5 – Sun 11
    const w3 = weeks[2]; // Mon 12 – Sun 18
    expect(w2.bars).toHaveLength(1);
    expect(w2.bars[0].startCol).toBe(4);
    expect(w2.bars[0].span).toBe(3);
    expect(w2.bars[0].lengthLabel).toBe("5 days");
    expect(w2.bars[0].continuesAfter).toBe(true);
    expect(w3.bars).toHaveLength(1);
    expect(w3.bars[0].startCol).toBe(0);
    expect(w3.bars[0].span).toBe(2);
    expect(w3.bars[0].continuesBefore).toBe(true);
    // The bar's days give up a line under the date row for it; the rest don't.
    expect(cellOf(weeks, "2026-10-09").barRows).toBe(1);
    expect(cellOf(weeks, "2026-10-08").barRows).toBe(0);
  });

  it("dims the past everywhere, the all-day bars included", () => {
    const weeks = layout({
      allDayByDay: new Map([
        ...allDay("past-trip", new Date(2026, 9, 5), new Date(2026, 9, 6)),
        ...allDay("next-trip", new Date(2026, 9, 20), new Date(2026, 9, 21)),
      ]),
      eventsByDay: byDay([
        chip({ id: "morning", day: NOW, from: 9, to: 10 }),
        chip({ id: "evening", day: NOW, from: 18, to: 19 }),
        chip({ id: "monday", day: new Date(2026, 9, 12), from: 9, to: 10 }),
      ]),
    });
    expect(weeks[1].bars[0].past).toBe(true);
    expect(weeks[3].bars[0].past).toBe(false);
    const today = cellOf(weeks, "2026-10-14");
    expect(today.lines.find((l) => l.key.startsWith("morning"))?.past).toBe(true);
    expect(today.lines.find((l) => l.key.startsWith("evening"))?.past).toBe(false);
    expect(cellOf(weeks, "2026-10-12").lines[0].past).toBe(true);
  });

  it("lists one-offs before routines, each by start", () => {
    const day = new Date(2026, 9, 20);
    const block: TaskBlock = {
      blockId: "b1",
      sessionId: null,
      taskId: "t1",
      title: "Write the brief",
      startMs: new Date(2026, 9, 20, 11).getTime(),
      endMs: new Date(2026, 9, 20, 12).getTime(),
      durationMinutes: 60,
      done: false,
      dayKey: localDayKey(day),
    };
    const weeks = layout({
      capacity: 6,
      eventsByDay: byDay([
        chip({ id: "standup", day, from: 9, to: 9.25, recurring: true }),
        chip({ id: "lunch", day, from: 12.5, to: 13.5 }),
        chip({ id: "review", day, from: 15, to: 16, recurring: true }),
        chip({ id: "call", day, from: 10, to: 10.5 }),
      ]),
      blocksByDay: new Map([[localDayKey(day), [block]]]),
    });
    const keys = cellOf(weeks, localDayKey(day)).lines.map((l) =>
      l.kind === "event" ? l.chip.eventId : l.block.blockId,
    );
    expect(keys).toEqual(["call", "b1", "lunch", "standup", "review"]);
  });

  it("puts the day's open due count beside the date", () => {
    const due: DueChip[] = [
      { taskId: "a", title: "A", dayKey: "2026-10-16", done: false },
      { taskId: "b", title: "B", dayKey: "2026-10-16", done: false },
      { taskId: "c", title: "C", dayKey: "2026-10-16", done: true },
    ];
    const weeks = layout({ dueByDay: new Map([["2026-10-16", due]]) });
    expect(cellOf(weeks, "2026-10-16").due.map((d) => d.taskId)).toEqual(["a", "b"]);
    expect(cellOf(weeks, "2026-10-17").due).toEqual([]);
  });

  it("says how many more a crowded day holds, counting the bars it can't show", () => {
    const day = new Date(2026, 9, 22);
    const chips = [9, 10, 11, 12, 13, 14].map((h) =>
      chip({ id: `e${h}`, day, from: h, to: h + 0.5 }),
    );
    const fits = layout({ capacity: 6, eventsByDay: byDay(chips) });
    expect(cellOf(fits, keyOf(2026, 9, 22)).lines).toHaveLength(6);
    expect(cellOf(fits, keyOf(2026, 9, 22)).more).toBe(0);

    // Four lines: three items and "3 more".
    const crowded = layout({ capacity: 4, eventsByDay: byDay(chips) });
    expect(cellOf(crowded, keyOf(2026, 9, 22)).lines).toHaveLength(3);
    expect(cellOf(crowded, keyOf(2026, 9, 22)).more).toBe(3);

    // Bars past MONTH_BAR_ROWS fold into that day's count; the shown bars take lines.
    const stacked = new Map<string, EventChip[]>();
    for (const id of ["a", "b", "c"]) {
      for (const [k, v] of allDay(id, day, day)) stacked.set(k, [...(stacked.get(k) ?? []), ...v]);
    }
    const withBars = layout({
      capacity: 4,
      eventsByDay: byDay(chips.slice(0, 1)),
      allDayByDay: stacked,
    });
    const cell = cellOf(withBars, keyOf(2026, 9, 22));
    expect(withBars[3].bars.filter((b) => b.startCol === 3)).toHaveLength(MONTH_BAR_ROWS - 1);
    expect(cell.barRows).toBe(MONTH_BAR_ROWS - 1);
    // capacity 4 − 1 bar row = 3 lines; 1 event + 2 hidden bars = 3 → fits only if nothing hides,
    // so one line holds "more": the event shows, and 2 bars are counted.
    expect(cell.lines).toHaveLength(1);
    expect(cell.more).toBe(2);
  });
});
