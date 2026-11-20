// The calendar's sync faults, scoped (CALR-3, AC2), quiet by default. A sync
// that fails retries in the background: an account whose last sync failed
// (`status = 'error'`, its `lastSyncAt` left at the last good sync) says nothing
// until it has gone QUIET_STALE_MS without a good sync. Then its events carry the
// sync mark and its rail row a muted "Last synced …", never a banner: there is
// nothing for the person to do. A banner speaks only when they must act: a
// login Google stopped accepting (`status = 'reauth'`, CALR-20, AC37), which
// asks to reconnect, or a calendar read that failed outright (`degraded`).
// The week never reads "Nothing scheduled" while anything is stale.

import { providerLabel } from "./accounts";
import type { CalendarAccountModel } from "./events";
import { parseGoogleExternalId } from "./google-account";
import { parseSyncDescriptor } from "./sync";
import { formatTimeOfDay } from "./ui/time-format";

/** One login whose calendars didn't sync. */
export type SyncFault = {
  key: string;
  provider: string;
  /** What the person knows the account by: the Google address, the CalDAV user, the feed. */
  login: string;
  /** The stale calendars' names, in account order. */
  calendars: string[];
  accountIds: string[];
  /** The oldest last good sync among them; null when one never synced. */
  staleSinceMs: number | null;
  /** True when a calendar of this login never synced at all. */
  neverSynced: boolean;
  /** Google stopped accepting Moduo's access to this login: Reconnect, not Try again. */
  reauth: boolean;
};

export type CalendarSyncStatus = {
  staleAccountIds: ReadonlySet<string>;
  faults: SyncFault[];
  /** What is current: "Your calendar" first, then each account that synced. */
  current: string[];
  /** The calendar read itself failed. */
  loadFailed: boolean;
  /** Anything above is wrong: the banner shows and the empty-week hint doesn't. */
  faulted: boolean;
};

export const YOUR_CALENDAR = "Your calendar";

/** How long a failing account stays silent: background retries cover blips, offline spells and token refreshes. */
export const QUIET_STALE_MS = 6 * 60 * 60 * 1000;

/** True when a failing account has been failing long enough to mention (a reauth always is). */
export function isStale(
  account: Pick<CalendarAccountModel, "status" | "lastSyncAt">,
  now: number = Date.now(),
): boolean {
  if (account.status === "reauth") return true;
  if (account.status !== "error") return false;
  const at = syncedAtMs(account);
  // Never synced: there is nothing to show from it, so its row says so (quietly).
  return at === null || now - at >= QUIET_STALE_MS;
}

function calendarName(account: CalendarAccountModel): string {
  const google = parseGoogleExternalId(account.externalId);
  if (google) return account.displayLabel || google.email;
  const desc = parseSyncDescriptor(account.syncToken);
  if (desc?.kind === "caldav") return desc.calendarName || account.displayLabel || "CalDAV";
  return account.displayLabel || providerLabel(account.provider);
}

function loginOf(account: CalendarAccountModel): { key: string; login: string } {
  const google = parseGoogleExternalId(account.externalId);
  if (google) return { key: `google:${google.email}`, login: google.email };
  const desc = parseSyncDescriptor(account.syncToken);
  if (desc?.kind === "caldav") {
    return {
      key: `caldav:${desc.serverUrl}|${desc.username}`,
      login: desc.username || desc.serverUrl,
    };
  }
  return { key: `account:${account.id}`, login: calendarName(account) };
}

function syncedAtMs(account: Pick<CalendarAccountModel, "lastSyncAt">): number | null {
  if (!account.lastSyncAt) return null;
  const ms = Date.parse(account.lastSyncAt);
  return Number.isFinite(ms) ? ms : null;
}

export function calendarSyncStatus(input: {
  accounts: readonly CalendarAccountModel[];
  degraded: boolean;
  now?: number;
}): CalendarSyncStatus {
  const now = input.now ?? Date.now();
  const live = input.accounts.filter((a) => !a.deletedAt);
  const stale = new Set<string>();
  const byLogin = new Map<string, SyncFault>();
  const current = [YOUR_CALENDAR];
  for (const account of live) {
    if (!isStale(account, now)) {
      current.push(calendarName(account));
      continue;
    }
    stale.add(account.id);
    const { key, login } = loginOf(account);
    const fault =
      byLogin.get(key) ??
      ({
        key,
        provider: account.provider,
        login,
        calendars: [],
        accountIds: [],
        staleSinceMs: null,
        neverSynced: false,
        reauth: false,
      } satisfies SyncFault);
    byLogin.set(key, fault);
    fault.calendars.push(calendarName(account));
    fault.accountIds.push(account.id);
    if (account.status === "reauth") fault.reauth = true;
    const at = syncedAtMs(account);
    if (at === null) fault.neverSynced = true;
    else fault.staleSinceMs = fault.staleSinceMs === null ? at : Math.min(fault.staleSinceMs, at);
  }
  const faults = [...byLogin.values()];
  return {
    staleAccountIds: stale,
    faults,
    current,
    loadFailed: input.degraded,
    faulted: input.degraded || faults.length > 0,
  };
}

/**
 * What a rail row says about its sync, or null: "Reconnect" (warning) when the
 * login needs it, a muted "Last synced …" once a failing account has been
 * stale past its quiet hours, nothing while background retries may still fix it.
 */
export function accountSyncNote(
  account: Pick<CalendarAccountModel, "status" | "lastSyncAt">,
  now: number = Date.now(),
): { text: string; tone: "warning" | "muted" } | null {
  if (account.status === "reauth") return { text: "Reconnect", tone: "warning" };
  if (!isStale(account, now)) return null;
  const at = syncedAtMs(account);
  return {
    text: at === null ? "Not synced yet" : `Last synced ${syncSinceLabel(at, now)}`,
    tone: "muted",
  };
}

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** "9:12" today; "Sunday 6:02 PM" on an earlier day. */
export function syncSinceLabel(ms: number, now: number = Date.now()): string {
  const time = formatTimeOfDay(ms);
  if (sameLocalDay(ms, now)) return time;
  const weekday = new Date(ms).toLocaleDateString(undefined, { weekday: "long" });
  return `${weekday} ${time}`;
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The banner's sentence, or null when nothing is wrong. */
export function syncBannerText(
  status: CalendarSyncStatus,
  now: number = Date.now(),
): string | null {
  if (status.loadFailed) {
    return "Your calendar didn't load, so events may be missing. Tasks are current.";
  }
  if (status.faults.length === 0) return null;
  const reauth = status.faults
    .filter((f) => f.reauth)
    .map(
      (f) =>
        `Google stopped accepting Moduo's access to ${f.login}. ${staleClause([f], now)}, and booking links can't see ${f.calendars.length === 1 ? "it" : "them"} until you reconnect.`,
    );
  // An account that only went stale has nothing for the person to do: its rail
  // row says when it last synced, and background syncs keep trying.
  return reauth.length > 0 ? reauth.join(" ") : null;
}

/** "Work and Family show as of Sunday 6:02 PM", or "… haven't synced yet". */
function staleClause(faults: readonly SyncFault[], now: number): string {
  const calendars = faults.flatMap((f) => f.calendars);
  const neverSynced = faults.some((f) => f.neverSynced);
  const since = faults
    .map((f) => f.staleSinceMs)
    .filter((ms): ms is number => ms !== null)
    .reduce<number | null>((min, ms) => (min === null ? ms : Math.min(min, ms)), null);
  return neverSynced || since === null
    ? `${joinNames(calendars)} ${calendars.length === 1 ? "hasn't" : "haven't"} synced yet`
    : `${joinNames(calendars)} ${calendars.length === 1 ? "shows" : "show"} as of ${syncSinceLabel(since, now)}`;
}

/** The quiet hint on an empty today, never over a fault, a load or a draft. */
export function emptyWeekHint(input: {
  loading: boolean;
  failed: boolean;
  hasAnyChips: boolean;
  drafting: boolean;
}): string | null {
  if (input.loading || input.failed || input.hasAnyChips || input.drafting) return null;
  return "Nothing scheduled — draw a block or schedule a task.";
}
