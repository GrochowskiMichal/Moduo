// The Month view's layout (CALR-12, AC12): six week rows. In each week, every
// all-day occurrence is one bar under the date row across the days it covers
// (the all-day lane's packing, `allday-lane.ts`); a cell's own lines follow
// under its bars, one-offs (events and your work) before routines, each by
// start. A cell holds `capacity` lines under its date: when its items don't
// fit, the last line says "N more" (which opens the day), counting the bars
// the week can't show. The past dims everywhere, all-day bars included; the
// day's open due count sits beside the date.

import { type AllDayBar, layoutAllDayLane } from "./allday-lane";
import type { EventChip } from "./events";
import { addDays, type DueChip, localDayKey, type TaskBlock, type VisibleRange } from "./lens";

/** Month always shows six weeks, so the grid never changes height between months. */
export const MONTH_WEEKS = 6;
/** Bar rows a week shows under its dates; past this, one row stays and the rest are counted. */
export const MONTH_BAR_ROWS = 2;

export type MonthLine =
  | { kind: "event"; key: string; chip: EventChip; past: boolean }
  | { kind: "task"; key: string; block: TaskBlock; past: boolean };

export type MonthBar = AllDayBar & { past: boolean };

export type MonthCell = {
  day: Date;
  dayKey: string;
  /** In the month the view is for (the weeks around it reach into its neighbours). */
  inMonth: boolean;
  today: boolean;
  /** The whole day is behind now. */
  past: boolean;
  /** The day's open due-only tasks (the count beside the date). */
  due: DueChip[];
  /** Lines under the date the week's bars take on this day. */
  barRows: number;
  /** The lines shown under the bars. */
  lines: MonthLine[];
  /** Items the cell doesn't show ("N more"), hidden bars included. */
  more: number;
};

export type MonthWeek = { cells: MonthCell[]; bars: MonthBar[] };

export type MonthInput = {
  days: readonly Date[];
  /** Any day of the month the view is for (`monthOf`). */
  month: Date;
  now: Date;
  eventsByDay: ReadonlyMap<string, readonly EventChip[]>;
  allDayByDay: ReadonlyMap<string, readonly EventChip[]>;
  blocksByDay?: ReadonlyMap<string, readonly TaskBlock[]>;
  dueByDay?: ReadonlyMap<string, readonly DueChip[]>;
  /** Lines a cell fits under its date row, bars included. */
  capacity: number;
};

/** The month a Month range is for: the middle of six weeks always sits in it. */
export function monthOf(range: Pick<VisibleRange, "days">): Date {
  return range.days[Math.floor(range.days.length / 2)];
}

/** One-offs before routines (repeating events), each by start. */
function dayLines(
  events: readonly EventChip[],
  blocks: readonly TaskBlock[],
  nowMs: number,
): MonthLine[] {
  const lines: (MonthLine & { routine: boolean; startMs: number })[] = [
    ...events.map((chip) => ({
      kind: "event" as const,
      key: chip.occurrenceKey,
      chip,
      past: chip.endMs <= nowMs,
      routine: chip.recurring,
      startMs: chip.startMs,
    })),
    ...blocks.map((block) => ({
      kind: "task" as const,
      key: `task:${block.blockId}`,
      block,
      past: block.endMs <= nowMs,
      routine: false,
      startMs: block.startMs,
    })),
  ];
  lines.sort(
    (a, b) =>
      Number(a.routine) - Number(b.routine) || a.startMs - b.startMs || a.key.localeCompare(b.key),
  );
  return lines.map(({ routine: _r, startMs: _s, ...line }) => line as MonthLine);
}

export function layoutMonth(input: MonthInput): MonthWeek[] {
  const { days, now } = input;
  const nowMs = now.getTime();
  const todayKey = localDayKey(now);
  const perWeek = Math.max(1, Math.floor(days.length / MONTH_WEEKS));
  const weeks: MonthWeek[] = [];

  for (let w = 0; w * perWeek < days.length; w++) {
    const weekDays = days.slice(w * perWeek, (w + 1) * perWeek);
    const keys = weekDays.map(localDayKey);
    const lane = layoutAllDayLane(keys, input.allDayByDay, { expanded: true });
    const keepRows = lane.totalRows > MONTH_BAR_ROWS ? MONTH_BAR_ROWS - 1 : MONTH_BAR_ROWS;
    const hiddenBars = keys.map(() => 0);
    const bars: MonthBar[] = [];
    for (const bar of lane.bars) {
      if (bar.row < keepRows) {
        bars.push({ ...bar, past: bar.chip.endMs <= nowMs });
        continue;
      }
      for (let c = bar.startCol; c < bar.startCol + bar.span; c++) hiddenBars[c] += 1;
    }

    const cells = weekDays.map((day, col): MonthCell => {
      const dayKey = keys[col];
      const barRows = bars.reduce(
        (n, b) => (col >= b.startCol && col < b.startCol + b.span ? Math.max(n, b.row + 1) : n),
        0,
      );
      const all = dayLines(
        input.eventsByDay.get(dayKey) ?? [],
        input.blocksByDay?.get(dayKey) ?? [],
        nowMs,
      );
      const room = Math.max(0, input.capacity - barRows);
      const total = all.length + hiddenBars[col];
      const fits = hiddenBars[col] === 0 && all.length <= room;
      const shown = fits ? all.length : Math.min(all.length, Math.max(0, room - 1));
      return {
        day,
        dayKey,
        inMonth:
          day.getMonth() === input.month.getMonth() &&
          day.getFullYear() === input.month.getFullYear(),
        today: dayKey === todayKey,
        past: addDays(day, 1).getTime() <= nowMs,
        due: (input.dueByDay?.get(dayKey) ?? []).filter((d) => !d.done),
        barRows,
        lines: all.slice(0, shown),
        more: total - shown,
      };
    });
    weeks.push({ cells, bars });
  }
  return weeks;
}
