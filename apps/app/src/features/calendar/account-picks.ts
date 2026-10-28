// Which Google calendars sync (CALR-20, AC35, AC36): only the ones you pick.
// The picker after connecting starts with the calendars you can write shown
// and busy; Calendar accounts lists a login's calendars with Show in your week
// and Counts as busy for booking links. Pure: the dialogs feed it.

import { DEFAULT_BUSY_IDS } from "./booking/model";
import type { CalendarAccountModel } from "./events";
import type { LinkedGoogleCalendar } from "./google-web";

/** One calendar of a login, as the picker and Calendar accounts show it. */
export type CalendarPick = {
  externalId: string;
  name: string;
  readOnly: boolean;
  primary: boolean;
  /** The synced account row, or null when it doesn't sync yet. */
  accountId: string | null;
  show: boolean;
  busy: boolean;
};

export type GoogleStatus = { calendars: LinkedGoogleCalendar[]; reauth: string[] };

/** calendar-google-web's status answer; an older function without access fields reads as writable. */
export function parseGoogleStatus(payload: unknown): GoogleStatus {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const rows = Array.isArray(raw.calendars) ? raw.calendars : [];
  const calendars: LinkedGoogleCalendar[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const { email, accountId, summary, googleCalendarId } = item;
    if (
      typeof email !== "string" ||
      typeof accountId !== "string" ||
      typeof summary !== "string" ||
      typeof googleCalendarId !== "string"
    ) {
      continue;
    }
    calendars.push({
      email,
      accountId,
      summary,
      googleCalendarId,
      primary: item.primary === true,
      readOnly: item.readOnly === true,
    });
  }
  const reauth = Array.isArray(raw.reauth)
    ? raw.reauth.filter((email): email is string => typeof email === "string")
    : [];
  return { calendars, reauth };
}

/** The picker right after connecting: writable calendars shown and busy, read-only ones off. */
export function connectPicks(
  linked: readonly LinkedGoogleCalendar[],
  email: string,
): CalendarPick[] {
  return linked
    .filter((cal) => cal.email === email)
    .map((cal) => ({
      externalId: cal.accountId,
      name: cal.summary,
      readOnly: cal.readOnly,
      primary: cal.primary,
      accountId: null,
      show: !cal.readOnly,
      busy: !cal.readOnly,
    }));
}

/** What the picks write: shown or busy calendars sync; busy-but-hidden ones stay out of the week. */
export function planGooglePicks(picks: readonly CalendarPick[]): {
  add: { externalId: string; displayLabel: string; readOnly: boolean; busyDefault: boolean }[];
  hide: string[];
} {
  const synced = picks.filter((p) => p.show || p.busy);
  return {
    add: synced.map((p) => ({
      externalId: p.externalId,
      displayLabel: p.name,
      readOnly: p.readOnly,
      busyDefault: p.busy,
    })),
    hide: synced.filter((p) => !p.show).map((p) => p.externalId),
  };
}

function ofLogin(externalId: string, email: string): boolean {
  return externalId === `google:${email}` || externalId.startsWith(`google:${email}:`);
}

/** Logins Google lists that have no live calendar here yet: they wait for the picker. */
export function loginsAwaitingPick(
  linked: readonly LinkedGoogleCalendar[],
  accounts: readonly Pick<CalendarAccountModel, "externalId" | "deletedAt">[],
): string[] {
  const live = accounts.filter((a) => !a.deletedAt);
  const emails = [...new Set(linked.map((cal) => cal.email))];
  return emails.filter((email) => !live.some((a) => ofLogin(a.externalId, email)));
}

/** A login's calendars in Calendar accounts: Google's list, then synced ones it doesn't list now. */
export function accountCalendars(
  linked: readonly LinkedGoogleCalendar[],
  accounts: readonly CalendarAccountModel[],
  hiddenIds: readonly string[],
  email: string,
): CalendarPick[] {
  const live = accounts.filter((a) => !a.deletedAt && ofLogin(a.externalId, email));
  const pick = (account: CalendarAccountModel | undefined) => ({
    accountId: account?.id ?? null,
    show: Boolean(account) && !hiddenIds.includes(account?.id ?? ""),
    busy: account ? account.busyDefault !== false : false,
  });
  const listed = linked
    .filter((cal) => cal.email === email)
    .map((cal) => ({
      externalId: cal.accountId,
      name: cal.summary,
      readOnly: cal.readOnly,
      primary: cal.primary,
      ...pick(live.find((a) => a.externalId === cal.accountId)),
    }));
  const unlisted = live
    .filter((a) => !listed.some((row) => row.externalId === a.externalId))
    .map((a) => ({
      externalId: a.externalId,
      name: a.displayLabel,
      readOnly: a.readOnly === true,
      primary: false,
      ...pick(a),
    }));
  return [...listed, ...unlisted];
}

/** A new booking link's busy list: Moduo, your work sessions, and each calendar that counts as busy. */
export function defaultBusyIds(accounts: readonly CalendarAccountModel[]): string[] {
  return [
    ...DEFAULT_BUSY_IDS,
    ...accounts.filter((a) => !a.deletedAt && a.busyDefault !== false).map((a) => a.id),
  ];
}

/** "Bringing in 214 events · 50%", then "214 events are in your week". */
export function importProgressLabel(input: {
  events: number;
  done: number;
  total: number;
}): string {
  const { events, done, total } = input;
  const noun = events === 1 ? "event" : "events";
  if (total > 0 && done >= total)
    return `${events} ${noun} ${events === 1 ? "is" : "are"} in your week`;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return events > 0
    ? `Bringing in ${events} ${noun} · ${pct}%`
    : `Bringing in your events · ${pct}%`;
}
