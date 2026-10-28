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

/** The host-event columns booking availability reads; `kind` rides on top when the database has it. */
export const HOST_EVENT_COLUMNS = "start_time, end_time, source_account_id, calendar_id";

type Read = { data: unknown; error: { code?: string; message: string } | null };

/**
 * The host's events for the window, with their kind. A database before the
 * kind column (42703, undefined column) is read again without it, every row
 * then an ordinary event. Any other failed read throws: a link must never offer
 * the host's busy time as free.
 */
export async function readHostEvents(
  select: (columns: string) => PromiseLike<Read>,
): Promise<HostEventRow[]> {
  let res = await select(`${HOST_EVENT_COLUMNS}, kind`);
  if (res.error?.code === "42703") res = await select(HOST_EVENT_COLUMNS);
  if (res.error) throw new Error(`host events: ${res.error.message}`);
  return (Array.isArray(res.data) ? res.data : []) as HostEventRow[];
}
