// The all-day lane's layout (CALR-2, AC3): every all-day occurrence becomes one
// bar across the visible days it covers (a multi-day item is one bar with its
// length, "2 days"), packed greedily into rows. The lane shows at most
// ALL_DAY_MAX_ROWS rows: when the bars need more, the first row keeps its bars
// and the second says, per day, how many items that day doesn't show
// ("+N more"). Expanded (⇧A) shows every row. Due tasks never live here; they
// are counted in the day headers.

import type { EventChip } from "./events";
import { addDays, parseDayKey, startOfLocalDay } from "./lens";

/** The lane never grows past this many rows unless expanded. */
export const ALL_DAY_MAX_ROWS = 2;

export type AllDayBar = {
  /** The occurrence's first visible piece (selection and clicks use it). */
  chip: EventChip;
  /** First visible column, 0-based. */
  startCol: number;
  /** Visible columns covered. */
  span: number;
  row: number;
  /** "2 days" for an item longer than a day (its whole length, not the visible part). */
  lengthLabel: string | null;
  /** Starts before the first visible day / ends after the last. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type AllDayLane = {
  /** The bars to draw (all of them when expanded or when they fit). */
  bars: AllDayBar[];
  /** Rows the lane draws: bar rows plus, when collapsed past the cap, the "+N more" row. */
  rows: number;
  /** Rows every bar would need. */
  totalRows: number;
  /** Per visible day: items that day doesn't show (the "+N more" count). */
  hiddenByDay: number[];
  /** More rows exist than the cap: the lane offers ⇧A / Less. */
  overflows: boolean;
};

/** Whole local days an all-day item covers (end-exclusive at midnight). */
function lengthInDays(startMs: number, endMs: number): number {
  const first = startOfLocalDay(new Date(startMs)).getTime();
  const last = startOfLocalDay(new Date(Math.max(startMs, endMs - 1))).getTime();
  // Round: a clock-change day is 23 or 25 hours long.
  return Math.round((last - first) / 86_400_000) + 1;
}

export function layoutAllDayLane(
  dayKeys: readonly string[],
  allDayByDay: ReadonlyMap<string, readonly EventChip[]>,
  opts: { expanded?: boolean; maxRows?: number } = {},
): AllDayLane {
  const maxRows = opts.maxRows ?? ALL_DAY_MAX_ROWS;
  const cols = dayKeys.length;

  const firstDay = cols > 0 ? parseDayKey(dayKeys[0]) : null;
  const lastDay = cols > 0 ? parseDayKey(dayKeys[cols - 1]) : null;
  const rangeStartMs = firstDay ? firstDay.getTime() : 0;
  const rangeEndMs = lastDay ? addDays(lastDay, 1).getTime() : 0;

  // One item per occurrence, from its first to its last visible column.
  const items = new Map<string, { chip: EventChip; first: number; last: number }>();
  dayKeys.forEach((key, col) => {
    for (const chip of allDayByDay.get(key) ?? []) {
      const item = items.get(chip.occurrenceKey);
      if (item) item.last = col;
      else items.set(chip.occurrenceKey, { chip, first: col, last: col });
    }
  });

  const sorted = [...items.values()].sort(
    (a, b) =>
      a.first - b.first ||
      b.last - b.first - (a.last - a.first) ||
      a.chip.startMs - b.chip.startMs ||
      a.chip.title.localeCompare(b.chip.title) ||
      a.chip.occurrenceKey.localeCompare(b.chip.occurrenceKey),
  );

  // Greedy packing: each item takes the first row free on all its columns.
  const rowEnds: number[] = [];
  const all: AllDayBar[] = sorted.map(({ chip, first, last }) => {
    let row = rowEnds.findIndex((end) => end < first);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(last);
    } else {
      rowEnds[row] = last;
    }
    const days = lengthInDays(chip.startMs, chip.endMs);
    return {
      chip,
      startCol: first,
      span: last - first + 1,
      row,
      lengthLabel: days > 1 ? `${days} days` : null,
      continuesBefore: first === 0 && chip.startMs < rangeStartMs,
      continuesAfter: last === cols - 1 && chip.endMs > rangeEndMs,
    };
  });

  const totalRows = rowEnds.length;
  const hiddenByDay = Array.from({ length: cols }, () => 0);
  const overflows = totalRows > maxRows;
  if (!overflows || opts.expanded) {
    return { bars: all, rows: totalRows, totalRows, hiddenByDay, overflows };
  }
  // Collapsed past the cap: the bar rows above the "+N more" row stay.
  const keepRows = maxRows - 1;
  const bars: AllDayBar[] = [];
  for (const bar of all) {
    if (bar.row < keepRows) {
      bars.push(bar);
      continue;
    }
    for (let c = bar.startCol; c < bar.startCol + bar.span; c++) hiddenByDay[c] += 1;
  }
  return { bars, rows: maxRows, totalRows, hiddenByDay, overflows };
}
