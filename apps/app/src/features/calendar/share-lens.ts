// Preview as (CALR-16, specs/calendar-rethink.md AC29): your week as a teammate
// sees it. The masking is the server's (calendar_events_visible and
// calendar_busy_blocks with p_as); this lens only orders and labels the rows.

import type { CalendarEventModel } from "./events";

export type PreviewReason = "busy" | "private" | "focus" | "details";
export type PreviewItem = { event: CalendarEventModel; reason: PreviewReason };
export type PreviewLevel = "view" | "freebusy" | "none";

const reasonOf = (e: CalendarEventModel): PreviewReason =>
  e.calendarId === "busy"
    ? "busy"
    : e.isPrivate
      ? "private"
      : e.kind === "focus"
        ? "focus"
        : "details";

export function previewLens(a: {
  rows: CalendarEventModel[];
  busy: CalendarEventModel[];
}): PreviewItem[] {
  return [...a.rows, ...a.busy]
    .map((event) => ({ event, reason: reasonOf(event) }))
    .sort((x, y) => Date.parse(x.event.startsAt) - Date.parse(y.event.startsAt));
}
