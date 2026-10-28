// "New events go to" (specs/calendar-rethink.md, Assumptions "New events go to
// ... one event, never two"): Your calendar · Moduo by default, or one writable
// Google calendar, chosen per workspace and synced with the calendar prefs. A
// chosen calendar that can't take events any more falls back to Your calendar,
// and says so.

import type { CalendarAccountModel } from "./events";
import type { CalendarPrefs } from "./prefs";

export const YOUR_CALENDAR_LABEL = "Your calendar · Moduo";

export type NewEventsCalendar = { id: string; label: string };

export type NewEventsTo = { accountId: string | null; label: string; fallback: string | null };

function canTakeEvents(a: CalendarAccountModel): boolean {
  return a.provider === "google" && !a.deletedAt && !a.readOnly && a.status !== "reauth";
}

/** The Google calendars new events can go to, besides Your calendar. */
export function newEventsCalendars(accounts: readonly CalendarAccountModel[]): NewEventsCalendar[] {
  return accounts
    .filter(canTakeEvents)
    .map((a) => ({ id: a.id, label: a.displayLabel || "Google" }));
}

/** Where new events go now: the chosen calendar, or Your calendar with why. */
export function resolveNewEventsTo(
  chosenId: string | null,
  accounts: readonly CalendarAccountModel[],
): NewEventsTo {
  const yours = (fallback: string | null): NewEventsTo => ({
    accountId: null,
    label: YOUR_CALENDAR_LABEL,
    fallback,
  });
  if (!chosenId) return yours(null);
  const account = accounts.find((a) => a.id === chosenId);
  if (account && canTakeEvents(account)) {
    return { accountId: account.id, label: account.displayLabel || "Google", fallback: null };
  }
  if (!account || account.deletedAt || account.provider !== "google") {
    return yours("The calendar new events went to is gone, so they go to Your calendar.");
  }
  const name = account.displayLabel || "Google";
  return yours(
    account.readOnly
      ? `${name} is read only now, so new events go to Your calendar.`
      : `${name} needs reconnecting, so new events go to Your calendar.`,
  );
}

export function chosenNewEventsTo(prefs: CalendarPrefs, workspaceId: string): string | null {
  return prefs.newEventsTo[workspaceId] ?? null;
}

/** The prefs patch that sets (or, with null, clears) one workspace's choice. */
export function withNewEventsTo(
  prefs: CalendarPrefs,
  workspaceId: string,
  accountId: string | null,
): Pick<CalendarPrefs, "newEventsTo"> {
  const { [workspaceId]: _old, ...rest } = prefs.newEventsTo;
  return { newEventsTo: accountId ? { ...rest, [workspaceId]: accountId } : rest };
}
