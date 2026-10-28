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

export function previewExplain(item: PreviewItem, firstName: string, calendarName: string): string {
  switch (item.reason) {
    case "private":
      return `You marked this private, so ${firstName} sees “Busy” whatever the level`;
    case "busy":
      return `${calendarName} is shared with ${firstName} as Busy only, so ${firstName} sees “Busy”`;
    case "focus":
      return `${firstName} sees “Focus time”`;
    default:
      return `${calendarName} is shared with ${firstName} at All details, so ${firstName} sees it all`;
  }
}

const MAIN: Record<PreviewLevel, string> = {
  view: "All details",
  freebusy: "Busy only",
  none: "Nothing",
};
const OTHER: Record<PreviewLevel, string> = {
  view: "shows all details",
  freebusy: "shows as busy",
  none: "isn't shared",
};

export function previewBanner(
  name: string,
  levels: { name: string; level: PreviewLevel; main: boolean }[],
): string {
  const main = levels.find((l) => l.main)?.level ?? "none";
  return [
    `Your week as ${name} sees it`,
    MAIN[main],
    ...levels.filter((l) => !l.main && l.level !== main).map((l) => `${l.name} ${OTHER[l.level]}`),
    "private events show as busy",
    "tasks stay with you",
  ].join(" · ");
}
