// /calendar URL search params (DF-2, mirrors tasks DF-1 / contacts FX-1).
// An inbound `?event=<id>` is a deep link to a calendar event: the page
// navigates to that event's day, selects it, and opens its detail (a widget
// row, a linked chip, a notification). The param is a consume-once command,
// not held selection — the anchor day persists per-device (view state), so
// clearing `?event` on apply keeps the URL clean without losing the day.

import type { CalendarEventModel } from "./events";

export type CalendarSearch = {
  event?: string;
};

export function validateCalendarSearch(search: Record<string, unknown>): CalendarSearch {
  const event =
    typeof search.event === "string" && search.event.length > 0 ? search.event : undefined;
  return event ? { event } : {};
}

// ── inbound-target resolution ────────────────────────────────────────────────
// Pure: an inbound `?event=` is a native/mirrored event id (navigate to its
// series-anchor day + select) or unknown/stale (degrade quietly, never crash).
// `startsAt` is the ISO series start; the page turns it into a day key + the
// first occurrence's chip key.

export type CalendarDeepLinkTarget =
  | { kind: "event"; eventId: string; startsAt: string }
  | { kind: "none" };

export function resolveCalendarDeepLink(
  id: string,
  ctx: { events: ReadonlyArray<Pick<CalendarEventModel, "id" | "startsAt">> },
): CalendarDeepLinkTarget {
  if (!id) return { kind: "none" };
  const event = ctx.events.find((e) => e.id === id);
  if (event && event.startsAt)
    return { kind: "event", eventId: event.id, startsAt: event.startsAt };
  return { kind: "none" };
}
