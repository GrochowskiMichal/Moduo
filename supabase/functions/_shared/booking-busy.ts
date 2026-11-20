/**
 * Which of a booking link host's events hide times (CALR-14, AC23). Pure.
 * Focus time is free for links unless the busy list has the pseudo-calendar
 * "focus"; every other row is busy when its account is ticked, or when it is a
 * Moduo row (no account, calendar "moduo" or empty) and "moduo" is ticked.
 * An offer's hold (CALR-19, AC34) is busy for every link, whatever the list ticks.
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
      row.kind === "hold" ||
      (row.kind === "focus"
        ? ids.has(FOCUS_BUSY_ID)
        : (account != null && ids.has(account)) || (isModuo && ids.has("moduo")));
    if (selected) out.push({ start: new Date(String(row.start_time)), end: new Date(String(row.end_time)) });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

type Read = { data: unknown; error: { code?: string; message: string } | null };

/** The server read of a host's busy rows, repeats expanded (20261029180000_booking_host_events.sql). */
export const HOST_EVENTS_FN = "calendar__booking_host_events";

export type HostEventsWindow = {
  workspaceId: string | null;
  hostId: string;
  from: Date;
  to: Date;
  /** The link's host zone: the server expands repeats in the host's saved zone, else this one. */
  zone: string;
};

/**
 * The host's events for the window, one row per occurrence: the server
 * expands Moduo repeats (COUNT/UNTIL, skipped and moved occurrences, the
 * host's wall clock), so a weekly 1:1 that began weeks ago blocks this week.
 * Any failed read throws, a missing function (migration not applied yet)
 * included: a link must never offer the host's busy time as free, and the
 * table alone would count a repeat only at its first start.
 */
/** PostgREST answers at most max_rows (1000) a request: the read pages until a short page. */
export const HOST_EVENTS_PAGE = 1000;
/** Past this many pages the read gives up (503) rather than offer the rest as free. */
const MAX_PAGES = 20;

export async function readHostEvents(
  rpc: (fn: string, args: Record<string, unknown>, rows: { from: number; to: number }) => PromiseLike<Read>,
  window: HostEventsWindow,
): Promise<HostEventRow[]> {
  // A null workspace matches nothing, which would read as all free.
  if (!window.workspaceId) throw new Error("host events: the link has no workspace");
  const args = {
    p_workspace_id: window.workspaceId,
    p_owner_id: window.hostId,
    p_from: window.from.toISOString(),
    p_to: window.to.toISOString(),
    p_zone: window.zone || "UTC",
  };
  const out: HostEventRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * HOST_EVENTS_PAGE;
    const res = await rpc(HOST_EVENTS_FN, args, { from, to: from + HOST_EVENTS_PAGE - 1 });
    if (res.error) throw new Error(`host events: ${res.error.message}`);
    if (!Array.isArray(res.data)) throw new Error("host events: the answer is not a list");
    out.push(...(res.data as HostEventRow[]));
    if (res.data.length < HOST_EVENTS_PAGE) return out;
  }
  throw new Error(`host events: more than ${MAX_PAGES * HOST_EVENTS_PAGE} rows`);
}
