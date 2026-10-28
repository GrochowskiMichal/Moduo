/**
 * Which of a booking link host's events hide times (CALR-14, AC23). Pure.
 * Focus time is free for links unless the busy list has the pseudo-calendar
 * "focus"; every other row is busy when its account is ticked, or when it is a
 * Moduo row (no account, calendar "moduo" or empty) and "moduo" is ticked. A
 * row without a kind (a database before the kind column) is an ordinary event.
 * Intervals come back in start order.
 */

/** The busy list's id for focus time (the app's FOCUS_BUSY_ID, apps/app/src/features/calendar/booking/model.ts; the test checks they match). */
export const FOCUS_BUSY_ID = "focus";

export type HostEventRow = {
  start_time: unknown;
  end_time: unknown;
  source_account_id?: unknown;
  calendar_id?: unknown;
  kind?: unknown;
};

export type Interval = { start: Date; end: Date };

export function busyFromHostEvents(rows: readonly HostEventRow[], busyIds: Iterable<string>): Interval[] {
  const ids = new Set(busyIds);
  const out: Interval[] = [];
  for (const row of rows) {
    const account = (row.source_account_id as string | null | undefined) ?? null;
    const calendarId = (row.calendar_id as string | null | undefined) ?? "moduo";
    const isModuo = account == null && (calendarId === "moduo" || calendarId === "");
    const selected =
      row.kind === "focus"
        ? ids.has(FOCUS_BUSY_ID)
        : (account != null && ids.has(account)) || (isModuo && ids.has("moduo"));
    if (selected) out.push({ start: new Date(String(row.start_time)), end: new Date(String(row.end_time)) });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
