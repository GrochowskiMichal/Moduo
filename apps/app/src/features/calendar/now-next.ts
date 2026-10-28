// The toolbar's now-and-next line (CALR-2, AC11): the meeting in progress, until
// when, what's next and the join key (⇧⌘J). Pure: which events those are, and
// which parts fit the room the toolbar leaves it. Parts drop in a fixed order
// as the room narrows: "then …" first, then the key, then "until", then the
// whole pill. The Home Today widget (CALR-21) reads the same items.

import { type CalendarEventModel, eventChipsInRange } from "./events";
import { localDayKey, startOfLocalDay, visibleRange } from "./lens";
import { splitTeammateEvents } from "./teammates";

export type NowNextItem = {
  eventId: string;
  occurrenceKey: string;
  title: string;
  startMs: number;
  endMs: number;
  /** The meeting's link (Meet, Zoom, …); the join key shows only with one. */
  joinUrl: string | null;
};

export type NowNext = { now: NowNextItem | null; next: NowNextItem | null };

/**
 * The meeting in progress (of several, the one that began last) and the first
 * one starting after now. Null when there is neither.
 */
export function nowAndNext(items: readonly NowNextItem[], nowMs: number): NowNext | null {
  let now: NowNextItem | null = null;
  let next: NowNextItem | null = null;
  for (const item of items) {
    if (item.startMs <= nowMs && nowMs < item.endMs) {
      if (!now || item.startMs > now.startMs) now = item;
    } else if (item.startMs > nowMs) {
      if (!next || item.startMs < next.startMs) next = item;
    }
  }
  return now || next ? { now, next } : null;
}

/**
 * Today's timed meetings at `nowMs`, occurrences of repeats included, each
 * with its join link. Focus time is your own work and a hold a time you
 * offered, so neither is a meeting (CALR-14, CALR-19).
 */
export function nowNextItems(events: readonly CalendarEventModel[], nowMs: number): NowNextItem[] {
  const today = startOfLocalDay(new Date(nowMs));
  const range = visibleRange("day", today, { weekStartsOn: 1, showWeekends: true });
  const eventById = new Map(events.map((e) => [e.id, e]));
  const todaysChips = eventChipsInRange([...events], range).timed.get(localDayKey(today)) ?? [];
  const meetings = todaysChips.filter((chip) => !chip.focus && !chip.held);
  return meetings.map((chip) => ({
    eventId: chip.eventId,
    occurrenceKey: chip.occurrenceKey,
    title: chip.title || "Untitled",
    startMs: chip.startMs,
    endMs: chip.endMs,
    joinUrl: eventById.get(chip.eventId)?.conferenceUrl ?? null,
  }));
}

/**
 * The Home Today widget's now and next: your own events only (a teammate's
 * shown calendar leaves it; your events on it stay), as the toolbar reads them.
 */
export function todayNowNext(
  events: readonly CalendarEventModel[],
  nowMs: number,
  self: string | null,
  shared: readonly { calendarId: string }[] = [],
): NowNext | null {
  const { mine } = splitTeammateEvents(events, shared, self);
  return nowAndNext(nowNextItems(mine, nowMs), nowMs);
}

export type NowNextParts = { pill: boolean; until: boolean; key: boolean; then: boolean };

/** The room (px) each part needs, widest first: the order they drop in. */
export const NOW_NEXT_FIT = { nextUp: 520, key: 400, until: 320, pill: 160 } as const;

/** Which parts fit in `width` px of free toolbar room. */
export function nowNextParts(width: number): NowNextParts {
  return {
    pill: width >= NOW_NEXT_FIT.pill,
    until: width >= NOW_NEXT_FIT.until,
    key: width >= NOW_NEXT_FIT.key,
    // A boolean, never a function, so the object can't pass for a promise.
    // eslint-disable-next-line unicorn/no-thenable -- "then" is the part's name
    then: width >= NOW_NEXT_FIT.nextUp,
  };
}
