// How an event saves (CALR-8): native events through the Moduo op, mirrored
// events on a live Google account you connected through Google, the rest
// (Outlook, CalDAV, .ics, someone else's account) not at all.

import type { CalendarAccountModel, CalendarEventModel } from "./events";

export type EventWriter = "moduo" | "google";

export function writableEvent(
  event: Pick<CalendarEventModel, "sourceAccountId" | "externalEventId">,
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): EventWriter | null {
  if (event.sourceAccountId === null) return "moduo";
  if (!event.externalEventId || !userId) return null;
  const account = accounts.find((a) => a.id === event.sourceAccountId);
  if (!account || account.deletedAt || account.provider !== "google" || account.readOnly) {
    return null;
  }
  return account.ownerId === userId ? "google" : null;
}
