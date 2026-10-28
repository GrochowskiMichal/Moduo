// One chip per meeting (specs/calendar-rethink.md, Assumptions "New events go
// to"): the same meeting reached through two connected logins is matched on
// Google's iCalUID plus the occurrence it is (instances of a repeat share one
// iCalUID), and one copy shows: one you can edit, yours over a teammate's.

import type { CalendarAccountModel, CalendarEventModel } from "./events";
import { writableEvent } from "./writable";

function rank(
  e: CalendarEventModel,
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): number {
  return (writableEvent(e, accounts, userId) ? 2 : 0) + (e.ownerId === userId ? 1 : 0);
}

/** The events with one copy per meeting; the same array when nothing repeats. */
export function oneChipPerMeeting(
  events: CalendarEventModel[],
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): CalendarEventModel[] {
  const winners = new Map<string, CalendarEventModel>();
  let collapses = false;
  for (const e of events) {
    if (!e.icalUid) continue;
    const key = `${e.icalUid}\n${e.originalStart ?? ""}`;
    const held = winners.get(key);
    if (!held) {
      winners.set(key, e);
      continue;
    }
    collapses = true;
    const diff = rank(e, accounts, userId) - rank(held, accounts, userId);
    if (diff > 0 || (diff === 0 && e.id < held.id)) winners.set(key, e);
  }
  if (!collapses) return events;
  return events.filter(
    (e) => !e.icalUid || winners.get(`${e.icalUid}\n${e.originalStart ?? ""}`) === e,
  );
}
