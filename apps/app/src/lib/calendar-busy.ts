// Busy blocks and Shared with you as the runtime reads them (CALR-16). Lives in
// lib so the runtime can map rows; features/calendar/teammates re-exports it.

import { normalizeCalendarItemKind } from "@contracts/vocabularies";

/** A teammate's calendar you can see: at All details (view) or Busy only. */
export type SharedCalendar = { calendarId: string; ownerId: string; level: "view" | "freebusy" };

/** One `calendar_busy_blocks` row: one occurrence (the server expands repeats). */
export type BusyBlockRow = {
  calendar_id: string;
  owner_id?: string | null;
  start_time: string;
  end_time: string;
  kind?: string | null;
  all_day?: boolean | null;
};

/** A busy block as a calendar event: id `busy:…`, title "Busy", on the "busy" calendar. */
export function busyBlockToEvent(row: BusyBlockRow, workspaceId: string, i: number) {
  return {
    // Two busy blocks can start at the same time; keep keys unique.
    id: `busy:${row.calendar_id}:${row.start_time}:${i}`,
    workspaceId,
    ownerId: row.owner_id ?? null,
    sourceAccountId: "busy",
    externalEventId: null,
    calendarId: "busy",
    calendarRef: row.calendar_id,
    title: "Busy",
    description: "",
    startsAt: row.start_time,
    endsAt: row.end_time,
    allDay: row.all_day ?? false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: row.start_time,
    updatedAt: row.start_time,
    deletedAt: null,
    kind: normalizeCalendarItemKind(row.kind),
  };
}
