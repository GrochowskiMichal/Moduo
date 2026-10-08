// The calendar module's fetch window (SCALE-1).
//
// The events read used to be unbounded — every event the workspace had ever
// held, which is both the fastest way to hit PostgREST's silent 1000-row cut
// and pure waste (nobody scrolls to 2019). The module now loads a window
// around today and WIDENS it as you navigate, so the data you can see is the
// data that got fetched.
//
// Standalone (no imports) on purpose: `runtime.web.ts` needs the default
// window, and pulling the calendar lens' value chain into the runtime would
// drag the whole feature graph with it.

export type CalendarWindow = { fromIso: string; toIso: string };

/** How far back / forward the first load reaches. */
export const CALENDAR_WINDOW_PAST_MONTHS = 12;
export const CALENDAR_WINDOW_FUTURE_MONTHS = 24;
/** Extra margin added whenever the window has to grow, so paging a month at a time doesn't refetch every month. */
export const CALENDAR_WINDOW_BUFFER_MONTHS = 6;

function shiftMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Every event the workspace holds — for readers that genuinely need all of
 * history and must NOT inherit the page's window: the workspace export (a
 * partial archive labelled "everything" is the worst kind of silent loss) and
 * the spine's linked-event snippets (a link to a 2019 meeting must still
 * resolve). Still capped by `READ_CAPS.calendarEvents`, which reports.
 */
export function allTimeCalendarWindow(): CalendarWindow {
  return { fromIso: "0001-01-01T00:00:00.000Z", toIso: "9999-12-31T23:59:59.999Z" };
}

export function defaultCalendarWindow(now: Date = new Date()): CalendarWindow {
  return {
    fromIso: shiftMonths(now, -CALENDAR_WINDOW_PAST_MONTHS).toISOString(),
    toIso: shiftMonths(now, CALENDAR_WINDOW_FUTURE_MONTHS).toISOString(),
  };
}

/**
 * Grow `current` so it covers `[needFrom, needTo]`, or return null when it
 * already does (the common case — no refetch).
 *
 * Growth is one-way: the window only ever widens within a session, so walking
 * back and forth over the same months never re-reads.
 */
export function widenCalendarWindow(
  current: CalendarWindow,
  needFrom: Date,
  needTo: Date,
  bufferMonths: number = CALENDAR_WINDOW_BUFFER_MONTHS,
): CalendarWindow | null {
  const curFrom = Date.parse(current.fromIso);
  const curTo = Date.parse(current.toIso);
  const from = needFrom.getTime();
  const to = needTo.getTime();
  if (from >= curFrom && to <= curTo) return null;
  return {
    fromIso: from < curFrom ? shiftMonths(needFrom, -bufferMonths).toISOString() : current.fromIso,
    toIso: to > curTo ? shiftMonths(needTo, bufferMonths).toISOString() : current.toIso,
  };
}
