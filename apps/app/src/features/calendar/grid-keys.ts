// The grid by keys (CALR-4, AC22): a 30-minute cursor, J/K through events in
// time order, ⌥ moves and resizes, and the drafts ⌘V and ⌘D create. Pure, so
// the hook that binds the keys (ui/use-calendar-keys.ts) stays thin.

import type { CalendarEventModel, EventChip } from "./events";
import { dayGeometry, instantAtWallMinute, wallMinuteOf } from "./grid-layout";
import { parseDayKey } from "./lens";

/** A slot on the grid: a day and the wall-clock minute its 30 minutes start at. */
export type GridCursor = {
  dayKey: string;
  minute: number;
  /** An event sits under it: the event's ring shows instead of the slot's. */
  busy?: boolean;
};

export type MoveEventDeltas = { startDeltaMs: number; endDeltaMs: number };

export const CURSOR_MINUTES = 30;
const LAST_SLOT = 24 * 60 - CURSOR_MINUTES;
const MIN = 60_000;
const NUDGE = 15 * MIN;

export type CursorDir = "up" | "down" | "left" | "right";

/** One arrow press. Past the first or last day it asks for the next period. */
export function stepCursor(
  cursor: GridCursor,
  dir: CursorDir,
  dayKeys: readonly string[],
): { cursor: GridCursor; period: -1 | 0 | 1 } {
  if (dir === "up" || dir === "down") {
    const minute = cursor.minute + (dir === "up" ? -CURSOR_MINUTES : CURSOR_MINUTES);
    return {
      cursor: { ...cursor, minute: Math.min(Math.max(minute, 0), LAST_SLOT) },
      period: 0,
    };
  }
  const i = dayKeys.indexOf(cursor.dayKey);
  const next = i + (dir === "left" ? -1 : 1);
  if (i < 0 || next < 0 || next >= dayKeys.length) {
    return { cursor, period: dir === "left" ? -1 : 1 };
  }
  return { cursor: { ...cursor, dayKey: dayKeys[next] }, period: 0 };
}

/** Where the cursor lands once the period stepped: the near edge, same time. */
export function cursorAfterPeriod(
  dayKeys: readonly string[],
  period: -1 | 1,
  minute: number,
): GridCursor | null {
  const dayKey = period === -1 ? dayKeys.at(-1) : dayKeys[0];
  return dayKey ? { dayKey, minute } : null;
}

/** The instants a slot covers. */
export function slotSpan(cursor: GridCursor): { startMs: number; endMs: number } {
  const day = parseDayKey(cursor.dayKey) ?? new Date();
  const geom = dayGeometry(day);
  return {
    startMs: instantAtWallMinute(cursor.minute, geom),
    endMs: instantAtWallMinute(cursor.minute + CURSOR_MINUTES, geom),
  };
}

/** The timed event under the cursor (the earliest-starting when several are). */
export function chipAtCursor(cursor: GridCursor, chips: readonly EventChip[]): EventChip | null {
  const slot = slotSpan(cursor);
  let best: EventChip | null = null;
  for (const chip of chips) {
    if (chip.allDay || chip.dayKey !== cursor.dayKey) continue;
    if (chip.startMs >= slot.endMs || chip.endMs <= slot.startMs) continue;
    if (!best || chip.startMs < best.startMs) best = chip;
  }
  return best;
}

/** The slot an event's piece starts in. */
export function cursorForChip(
  chip: Pick<EventChip, "dayKey" | "startMs"> & { allDay?: boolean },
): GridCursor {
  const day = parseDayKey(chip.dayKey) ?? new Date(chip.startMs);
  const minute = chip.allDay ? 0 : wallMinuteOf(chip.startMs, dayGeometry(day));
  return {
    dayKey: chip.dayKey,
    minute: Math.min(Math.floor(minute / CURSOR_MINUTES) * CURSOR_MINUTES, LAST_SLOT),
  };
}

const byTime = (a: EventChip, b: EventChip) =>
  a.startMs - b.startMs || a.endMs - b.endMs || a.occurrenceKey.localeCompare(b.occurrenceKey);

/**
 * J (1) / K (-1): the next or previous event in time order, from the
 * selected one, else from the cursor's slot, else the first or the last.
 */
export function adjacentChip(
  chips: readonly EventChip[],
  from: { selectedKey: string | null; cursor: GridCursor | null },
  dir: 1 | -1,
): EventChip | null {
  // An overnight event has a piece on each day: step over its later pieces.
  const seen = new Set<string>();
  const list = [...chips].sort(byTime).filter((c) => {
    if (seen.has(c.occurrenceKey)) return false;
    seen.add(c.occurrenceKey);
    return true;
  });
  if (list.length === 0) return null;
  const at = from.selectedKey ? list.findIndex((c) => c.occurrenceKey === from.selectedKey) : -1;
  if (at >= 0) return list[at + dir] ?? null;
  if (!from.cursor) return dir === 1 ? list[0] : (list.at(-1) ?? null);
  const { startMs } = slotSpan(from.cursor);
  if (dir === 1) return list.find((c) => c.startMs >= startMs) ?? null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].startMs < startMs) return list[i];
  return null;
}

export type KeyedChange = "earlier" | "later" | "prev-day" | "next-day" | "shorter" | "longer";

/** Same wall time, `days` later (a clock change keeps 14:00 at 14:00). */
function shiftDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** ⌥↑↓ 15 minutes, ⌥←→ a day, ⌥⇧↑↓ the length; null when it can't. */
export function keyedChange(
  span: { startMs: number; endMs: number; allDay: boolean },
  change: KeyedChange,
): MoveEventDeltas | null {
  switch (change) {
    case "prev-day":
    case "next-day": {
      const days = change === "next-day" ? 1 : -1;
      return {
        startDeltaMs: shiftDays(span.startMs, days) - span.startMs,
        endDeltaMs: shiftDays(span.endMs, days) - span.endMs,
      };
    }
    case "earlier":
    case "later": {
      if (span.allDay) return null;
      const d = change === "later" ? NUDGE : -NUDGE;
      return { startDeltaMs: d, endDeltaMs: d };
    }
    case "shorter":
    case "longer": {
      if (span.allDay) return null;
      if (change === "shorter" && span.endMs - span.startMs <= NUDGE) return null;
      return { startDeltaMs: 0, endDeltaMs: change === "longer" ? NUDGE : -NUDGE };
    }
  }
}

/** What ⌘V / ⌘D create: title, notes and length, one-off, on the source's calendar. */
export function copyDraft(
  source: Pick<
    CalendarEventModel,
    "title" | "description" | "startsAt" | "endsAt" | "allDay" | "sourceAccountId"
  >,
  startMs: number,
): {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  rrule: null;
  calendarId: string;
} {
  const length = Date.parse(source.endsAt) - Date.parse(source.startsAt);
  return {
    title: source.title,
    description: source.description,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(startMs + length).toISOString(),
    allDay: source.allDay,
    rrule: null,
    calendarId: source.sourceAccountId ?? "moduo",
  };
}

/** ⌘D puts the copy right after the occurrence it copies. */
export function duplicateStartMs(occurrence: { startMs: number; endMs: number }): number {
  return occurrence.endMs;
}
