// One chip per meeting (specs/calendar-rethink.md, Assumptions "New events go
// to"): the same meeting reached through two of your connected logins shows
// once, the copy you can edit.
//
// The iCalUID arrives through the client's mirror call, so it is a hint, never
// proof: only mirrored rows you own, from accounts you own, at the same start
// and end and the same occurrence (instances of a repeat share one iCalUID)
// ever merge, and only when exactly one of them is yours to edit. Otherwise
// every copy shows: a row someone else wrote can never hide yours.

import type { CalendarAccountModel, CalendarEventModel } from "./events";
import { writableEvent } from "./writable";

/** The merge key of a row that may merge, or null for a row that never does. */
function meetingKey(
  e: CalendarEventModel,
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): string | null {
  if (!e.icalUid || !userId || !e.sourceAccountId || e.ownerId !== userId) return null;
  const account = accounts.find((a) => a.id === e.sourceAccountId);
  if (!account || account.ownerId !== userId) return null;
  const start = Date.parse(e.startsAt);
  const end = Date.parse(e.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return [e.icalUid, e.originalStart ?? "", start, end].join("\n");
}

/** The events with one copy per meeting; the same array when nothing merges. */
export function oneChipPerMeeting(
  events: CalendarEventModel[],
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): CalendarEventModel[] {
  const groups = new Map<string, CalendarEventModel[]>();
  for (const e of events) {
    const key = meetingKey(e, accounts, userId);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }
  const hidden = new Set<CalendarEventModel>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const editable = group.filter((e) => writableEvent(e, accounts, userId) !== null);
    if (editable.length !== 1) continue;
    for (const e of group) if (e !== editable[0]) hidden.add(e);
  }
  if (hidden.size === 0) return events;
  return events.filter((e) => !hidden.has(e));
}
