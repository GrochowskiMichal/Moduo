// One chip per meeting (specs/calendar-rethink.md, Assumptions "New events go
// to"): the same meeting reached through two of your connected logins shows
// once, the copy you can edit.
//
// The iCalUID arrives through the client's mirror call, so it is a hint, never
// proof: only mirrored rows you own, from accounts you own, at the same start
// and end and the same occurrence (instances of a repeat share one iCalUID)
// ever merge. The copy you organize (Google's organizer.self) wins; when none
// or several are, the one copy you can edit wins; otherwise every copy shows.
// A row someone else wrote can never hide yours.

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

/** Your mergeable rows, grouped by meeting. */
function meetings(
  events: CalendarEventModel[],
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): CalendarEventModel[][] {
  const groups = new Map<string, CalendarEventModel[]>();
  for (const e of events) {
    const key = meetingKey(e, accounts, userId);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.values()];
}

/** The copy of one meeting that shows: the one you organize, else the one you can edit; null keeps them all. */
function winnerOf(
  group: CalendarEventModel[],
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): CalendarEventModel | null {
  const organizer = group.filter((e) => e.isOrganizer === true);
  if (organizer.length === 1) return organizer[0];
  if (organizer.length > 1) return null;
  const editable = group.filter((e) => writableEvent(e, accounts, userId) !== null);
  return editable.length === 1 ? editable[0] : null;
}

/** The events with one copy per meeting; the same array when nothing merges. */
export function oneChipPerMeeting(
  events: CalendarEventModel[],
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): CalendarEventModel[] {
  const hidden = new Set<CalendarEventModel>();
  for (const group of meetings(events, accounts, userId)) {
    const keep = group.length < 2 ? null : winnerOf(group, accounts, userId);
    if (keep) for (const e of group) if (e !== keep) hidden.add(e);
  }
  if (hidden.size === 0) return events;
  return events.filter((e) => !hidden.has(e));
}
