// Client-side expansion of a recurring native event into a visible range
// (specs/calendar.md assumption 6: rrule text on the event row, client-side
// expansion; series-edit only in v1).
//
// Recurrence is WALL-CLOCK by design: "every Tuesday at 9" stays 9:00 local
// across a DST change (what humans mean). rrule computes in a floating
// timeline, so we map local components → UTC ("floating time"), run the rule
// there, and map results back to real local instants.

import { RRule } from "rrule";

export type ExpandableEvent = {
  id: string;
  /** ISO instant of the (first) start — the recurrence anchor. */
  startsAt: string;
  /** ISO instant of the (first) end — fixes the occurrence duration. */
  endsAt: string;
  /** RFC 5545 RRULE body (no "RRULE:" prefix) or null for one-off events. */
  rrule: string | null;
};

export type EventOccurrence = {
  eventId: string;
  startMs: number;
  endMs: number;
};

/** Local wall-clock components re-expressed on the UTC timeline. */
function toFloating(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
    ),
  );
}

/** A floating (UTC-timeline) instant back to the real local instant. */
function fromFloating(d: Date): Date {
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );
}

/** Defensive cap — a visible range is ≤ a week; nothing sane exceeds this. */
const MAX_OCCURRENCES = 100;

/**
 * All occurrences of `event` overlapping [rangeStartMs, rangeEndMs).
 * One-off events yield at most one occurrence; a malformed rrule degrades to
 * the one-off behavior (never a crash, never a silent wrong guess elsewhere).
 */
export function expandEventOccurrences(
  event: ExpandableEvent,
  rangeStartMs: number,
  rangeEndMs: number,
): EventOccurrence[] {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];
  const durationMs = Math.max(endMs - startMs, 0);

  const single = (): EventOccurrence[] =>
    startMs < rangeEndMs && endMs > rangeStartMs ? [{ eventId: event.id, startMs, endMs }] : [];

  if (!event.rrule) return single();

  let rule: RRule;
  try {
    const opts = RRule.parseString(event.rrule);
    // UNTIL is a REAL instant in provider rules; the rule runs on the
    // floating timeline, so the bound must be floated too or the series end
    // lands off by the tz offset (last occurrence vanishing east of UTC).
    if (opts.until) opts.until = toFloating(opts.until);
    rule = new RRule({ ...opts, dtstart: toFloating(start) });
  } catch {
    return single();
  }

  // Widen the window backwards by the duration so an occurrence that starts
  // before the range but overlaps it is still found. The iterator arg stops
  // rrule's materialization at the cap (a mirrored sub-daily rule could
  // otherwise expand thousands of dates before we slice).
  const windowStart = toFloating(new Date(rangeStartMs - durationMs));
  const windowEnd = toFloating(new Date(rangeEndMs - 1));
  const floats = rule.between(windowStart, windowEnd, true, (_d, len) => len <= MAX_OCCURRENCES);

  const out: EventOccurrence[] = [];
  for (const f of floats) {
    if (out.length >= MAX_OCCURRENCES) break;
    const occStart = fromFloating(f).getTime();
    const occEnd = occStart + durationMs;
    if (occStart < rangeEndMs && occEnd > rangeStartMs) {
      out.push({ eventId: event.id, startMs: occStart, endMs: occEnd });
    }
  }
  return out;
}
