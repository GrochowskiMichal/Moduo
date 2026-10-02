// Desktop calendar-sync orchestration helpers (CAL-6b). The desktop app is the
// sync WRITER: it fetches raw provider events via the Tauri OAuth engine, maps
// them with the pure mirror mapper, and pushes them to Supabase through the
// mirror op. This file holds the pure pieces (the sync window); the effectful
// loop is the `useCalendarSync` hook.

import { parseOrError } from "@contracts/errors";
import { calendarSyncDescriptorSchema } from "@contracts/rows";
import type { SyncableProvider } from "@contracts/vocabularies";

/** Providers the desktop engine can fetch. */
export type { SyncableProvider } from "@contracts/vocabularies";

export function isSyncableProvider(p: string): p is SyncableProvider {
  return p === "google" || p === "microsoft" || p === "caldav" || p === "ics";
}

/** Providers whose raw fetch is ICS text (mapped by ics-mirror, not mirror). */
export function isIcsProvider(p: SyncableProvider): p is "caldav" | "ics" {
  return p === "caldav" || p === "ics";
}

/**
 * The client-readable, NON-SECRET connection descriptor a CalDAV/ICS account
 * row carries in `calendar_accounts.sync_token` (CAL-8, spec assumption 19) —
 * rail grouping + Reconnect prefill read it; the password never leaves the OS
 * keychain. `kind:'caldav'` rows are one-per-calendar (externalId = the
 * calendar URL); `kind:'ics'` rows are one-per-feed (externalId = a URL hash,
 * the feed URL itself is keychain-side).
 */
export type CalendarSyncDescriptor =
  | {
      kind: "caldav";
      serverUrl: string;
      username: string;
      calendarUrl: string;
      calendarName: string;
    }
  | { kind: "ics" };

/** Build the JSON `sync_token` for a CalDAV calendar row (one row per calendar). */
export function buildCaldavDescriptor(input: {
  serverUrl: string;
  username: string;
  calendarUrl: string;
  calendarName: string;
}): string {
  return JSON.stringify({
    kind: "caldav",
    serverUrl: input.serverUrl,
    username: input.username,
    calendarUrl: input.calendarUrl,
    calendarName: input.calendarName,
  });
}

/** Build the JSON `sync_token` for an ICS feed row. */
export function buildIcsDescriptor(): string {
  return JSON.stringify({ kind: "ics" });
}

/** Parse a row's sync_token; null = not a descriptor (legacy/OAuth/pre-deploy). */
export function parseSyncDescriptor(
  syncToken: string | null | undefined,
): CalendarSyncDescriptor | null {
  if (!syncToken) return null;
  try {
    const parsed = parseOrError(calendarSyncDescriptorSchema, JSON.parse(syncToken));
    if (!parsed.success) return null;
    if (parsed.data.kind === "ics") return { kind: "ics" };
    return {
      kind: "caldav",
      serverUrl: parsed.data.serverUrl,
      username: parsed.data.username,
      calendarUrl: parsed.data.calendarUrl ?? "",
      calendarName: parsed.data.calendarName ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * The instant window a sync covers — a rolling past/future band so recently-
 * changed and upcoming events both refresh. Wide enough that the grid's visible
 * ranges (day/week, navigated a few weeks either way) are always covered.
 */
export function syncWindow(
  now: Date,
  pastDays = 30,
  futureDays = 120,
): { timeMin: string; timeMax: string } {
  // Fixed-24h arithmetic (not setDate) so the window is DST-immune — a sync
  // band needs no calendar-day precision, and setDate would shift the UTC hour
  // across a DST transition.
  const DAY = 86_400_000;
  return {
    timeMin: new Date(now.getTime() - pastDays * DAY).toISOString(),
    timeMax: new Date(now.getTime() + futureDays * DAY).toISOString(),
  };
}
