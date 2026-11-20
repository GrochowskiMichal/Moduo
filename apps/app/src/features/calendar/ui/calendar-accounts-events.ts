// Opens Calendar accounts in place on the Calendar page (CALR-20) from the rail,
// the sync banner and the connect return, without threading props through the page.

export const OPEN_CALENDAR_ACCOUNTS_EVENT = "moduo:calendar-accounts";

export type OpenCalendarAccounts = {
  /** Select this login (its key, `google:<email>`, or a Google address). */
  login?: string;
  /** Start at Connect a calendar. */
  connect?: boolean;
  /** A Google address just connected: show its calendar picker. */
  pick?: string;
  /** A Google address to reconnect right away. */
  reconnect?: string;
};

export function dispatchOpenCalendarAccounts(detail: OpenCalendarAccounts = {}): void {
  window.dispatchEvent(new CustomEvent(OPEN_CALENDAR_ACCOUNTS_EVENT, { detail }));
}
