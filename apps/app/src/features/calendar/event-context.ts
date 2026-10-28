// What the Event view reads about an event beyond its row (CALR-10): the name
// and owner of the calendar it is on, that calendar's sharing (the who-sees-it
// line) and the booking link it came through, through `calendar.eventContext`.
// Each part fails soft: a missing piece hides its row, it never blocks the panel.

import type { ModuoRuntime } from "../../lib/runtime.types";
import type { EventContext } from "./event-view";
import type { CalendarEventModel } from "./events";

export type EventViewer = {
  userId: string | null;
  members: readonly { userId: string; name: string }[];
};

/** "Your calendar" or "Kai's calendar" for a built-in one; a custom calendar keeps its name. */
export function calendarLabel(
  calendar: { name: string; kind: string; ownerId: string },
  viewer: EventViewer,
): string {
  // Every member's built-in calendar is called "Moduo"; say whose it is.
  if (calendar.kind !== "moduo") return calendar.name;
  if (calendar.ownerId === viewer.userId) return "Your calendar";
  const owner = viewer.members.find((m) => m.userId === calendar.ownerId)?.name ?? "Teammate";
  return `${owner}'s calendar`;
}

export async function loadEventContext(
  runtime: ModuoRuntime | null,
  event: CalendarEventModel,
  viewer: EventViewer,
): Promise<EventContext> {
  if (!runtime)
    return { calendarName: null, calendarOwnerId: null, share: null, bookedThrough: null };
  const read = await runtime.calendar.eventContext({
    eventId: event.id,
    calendarRef: event.calendarRef ?? null,
  });
  return {
    calendarName: read.calendar ? calendarLabel(read.calendar, viewer) : null,
    calendarOwnerId: read.calendar?.ownerId ?? null,
    share: read.share,
    bookedThrough: read.booking
      ? { name: read.booking.linkName ?? "a booking link", bookedAt: read.booking.bookedAt }
      : null,
  };
}
