// Live events (CALR-7, specs/calendar-rethink.md AC42): the pure half. The
// runtime's `calendar.listenLive` turns Realtime `postgres_changes` into
// `CalendarLiveChange`s; this decides how one lands in the hook's event list.
//
// The rules, in order:
//   1. A change for another workspace is ignored.
//   2. A hard delete, or a soft-deleted event, removes the event.
//   3. An event we already hold in a strictly newer version (by the server's
//      updated_at, stamped by the database clock) is kept: the change is a
//      late echo. Same stamp or newer replaces it in place.
//   4. An event we don't hold is appended.
// When nothing changes the same array comes back, so React skips the render.

import type { CalendarEventModel, CalendarLiveChange } from "./events";

export function applyLiveChange(
  events: CalendarEventModel[],
  change: CalendarLiveChange,
  workspaceId: string,
): CalendarEventModel[] {
  if (change.kind === "delete") return removeEvent(events, change.id);

  const incoming = change.event;
  if (incoming.workspaceId !== workspaceId) return events;
  if (incoming.deletedAt) return removeEvent(events, incoming.id);

  const index = events.findIndex((e) => e.id === incoming.id);
  if (index === -1) return [...events, incoming];

  const current = events[index]!;
  if (Date.parse(current.updatedAt) > Date.parse(incoming.updatedAt)) return events;

  const next = events.slice();
  next[index] = incoming;
  return next;
}

function removeEvent(events: CalendarEventModel[], id: string): CalendarEventModel[] {
  if (!events.some((e) => e.id === id)) return events;
  return events.filter((e) => e.id !== id);
}
