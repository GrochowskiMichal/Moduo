// Calendar sync — the sync WRITER loop. Fetches each connected account's raw
// provider events, maps them, and pushes them through the mirror op. Desktop
// reads the OS keychain. Web reads Google and Outlook through the stored refresh
// token and skips CalDAV and ICS (those credentials stay on the desktop).
// Runs on the calendar page: mount + tab-wake + every 15 min + manual refresh.

import { useCallback, useEffect, useRef } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { CalendarAccountModel, CalendarEventModel } from "../events";
import { fetchGoogleWebEvents } from "../google-web";
import { deletedExternalIds, mapProviderEvents } from "../mirror";
import type { SyncableProvider } from "../sync";
import { isIcsProvider, isSyncableProvider, syncWindow } from "../sync";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/**
 * After a run where an account failed, try again sooner than the 15-minute
 * tick, quietly: a blip (offline, a 5xx, a token being renewed) heals before
 * anyone sees it. The status rule in sync-status.ts stays silent meanwhile.
 */
export const RETRY_DELAYS_MS = [60_000, 3 * 60_000, 10 * 60_000] as const;

/** The desktop engine's answer when a login's sign-in was revoked: reconnect, not retry. */
export function isRevokedSignIn(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes("_calendar_reauth");
}

/**
 * True when a sync failed only because THIS machine doesn't hold the account's
 * CalDAV/ICS credentials (they're per-machine, keychain-side) — not a real
 * error. The Rust engine tags these; the tauri descriptor guard uses the same
 * `missing_descriptor` sentinel.
 */
function isLocalCredentialAbsence(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("caldav_missing_credentials") ||
    msg.includes("caldav_missing_descriptor") ||
    msg.includes("ics_feed_missing") ||
    msg.includes("web_provider_sync_skipped")
  );
}

function isMissingOutlookKeychain(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("outlook_calendar_missing_tokens") ||
    msg.includes("outlook_calendar_missing_access_token")
  );
}

function isMissingGoogleKeychain(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("google_calendar_missing_tokens") ||
    msg.includes("google_calendar_missing_access_token")
  );
}

type SyncRange = { timeMin: string; timeMax: string };

/**
 * One account's raw events. Connected on the web, the token is in Supabase, not
 * this machine's keychain: read it from there instead of marking the shared
 * account as broken.
 */
async function fetchAccountEvents(
  runtime: ModuoRuntime,
  acc: CalendarAccountModel,
  { timeMin, timeMax }: SyncRange,
): Promise<Record<string, unknown>[]> {
  const provider = acc.provider as SyncableProvider;
  try {
    return await runtime.calendar.fetchExternalEvents({
      provider,
      externalAccountId: acc.externalId,
      timeMin,
      timeMax,
      syncToken: acc.syncToken ?? null,
    });
  } catch (err) {
    const fallback = { externalAccountId: acc.externalId, timeMin, timeMax };
    if (provider === "google" && isMissingGoogleKeychain(err)) {
      return await fetchGoogleWebEvents(fallback);
    }
    if (
      provider === "microsoft" &&
      isMissingOutlookKeychain(err) &&
      runtime.calendar.outlookEvents
    ) {
      return await runtime.calendar.outlookEvents(fallback);
    }
    throw err;
  }
}

/** Sync one account: fetch, mirror, stamp it. One account's failure never wedges the others. */
async function syncAccount(
  runtime: ModuoRuntime,
  workspaceId: string,
  acc: CalendarAccountModel,
  events: CalendarEventModel[],
  range: SyncRange,
): Promise<"changed" | "same" | "failed" | "skipped"> {
  const provider = acc.provider as SyncableProvider;
  const { timeMin, timeMax } = range;
  try {
    const raw = await fetchAccountEvents(runtime, acc, range);
    // CalDAV/ICS raws are ICS text; ical.js loads lazily (desktop-only
    // path) so the web bundle never carries the parser.
    const mapped = isIcsProvider(provider)
      ? (await import("../ics-mirror")).mapIcsEvents(raw, { timeMin, timeMax })
      : mapProviderEvents(provider, raw);
    // Diff against what we last mirrored for this account so events the
    // provider HARD-DELETED (they just vanish from the fetch, unlike
    // cancellations which carry status) get tombstoned, not left stale.
    // `events` spans the loaded −12/+24 months but the fetch only syncWindow's
    // −30/+120 days, so anything outside it is tombstoned like a deletion too.
    // calendar_events_booking_follow already reads such a tombstone of a booked
    // meeting as a host cancel and emails its guests: bound this diff to the fetch window.
    const previouslyMirrored = events
      .filter((e) => e.sourceAccountId === acc.id && e.externalEventId)
      .map((e) => e.externalEventId as string);
    const removed = deletedExternalIds(
      previouslyMirrored,
      mapped.map((m) => m.externalEventId),
    );
    const res = await runtime.calendar.mirrorEvents({
      workspaceId,
      accountId: acc.id,
      events: mapped,
      deletedExternalIds: removed,
    });
    await runtime.calendar.upsertAccount({
      workspaceId,
      provider,
      externalId: acc.externalId,
      displayLabel: acc.displayLabel,
      color: acc.color,
      status: "ok",
      lastSyncAt: new Date().toISOString(),
    });
    return res.upserted > 0 || res.removed > 0 ? "changed" : "same";
  } catch (err) {
    console.warn("[calendar-sync]", provider, err);
    // A CalDAV/ICS account's credentials live only in the connecting
    // machine's keychain. On a SECOND desktop (or a teammate's) that
    // machine simply doesn't hold them — that is not the account's fault,
    // so DON'T flip the shared row to `error` (it would flap Reconnect for
    // everyone every ≤15 min as the owning machine flips it back). Only a
    // real sync failure on a machine that HAS the creds flips status.
    if (isLocalCredentialAbsence(err)) return "skipped";
    const revoked = isRevokedSignIn(err);
    // An 'error' upsert only updates the caller's live row and never
    // creates one, so a stale list can't clone or revive accounts. It
    // keeps lastSyncAt, which is what keeps a short failure quiet.
    await runtime.calendar
      .upsertAccount({
        workspaceId,
        provider,
        externalId: acc.externalId,
        displayLabel: acc.displayLabel,
        color: acc.color,
        status: revoked ? "reauth" : "error",
        lastSyncAt: acc.lastSyncAt,
      })
      .catch(() => {});
    // A revoked sign-in waits for Reconnect: retrying can't fix it.
    return revoked ? "skipped" : "failed";
  }
}

/** After a failed run, the next quiet try (RETRY_DELAYS_MS); a clean run resets the ladder. */
function scheduleRetry(
  retry: { timer: number | undefined; attempt: number },
  failed: boolean,
  run: () => void,
): void {
  if (!failed) {
    retry.attempt = 0;
    return;
  }
  if (retry.attempt >= RETRY_DELAYS_MS.length) return;
  retry.timer = window.setTimeout(run, RETRY_DELAYS_MS[retry.attempt]);
  retry.attempt += 1;
}

export function useCalendarSync(opts: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  accounts: CalendarAccountModel[];
  /** The currently-mirrored events — used to diff provider-side deletions. */
  events: CalendarEventModel[];
  /** Web syncs Google and Outlook. Other providers throw and are left untouched. */
  enabled: boolean;
  /** Reload the module bundle after a sync actually changed rows. */
  onSynced: () => void;
}): { syncNow: () => Promise<void> } {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const runningRef = useRef(false);
  const retryRef = useRef<{ timer: number | undefined; attempt: number }>({
    timer: undefined,
    attempt: 0,
  });

  const syncNow = useCallback(async () => {
    const { runtime, workspaceId, accounts, events, enabled, onSynced } = optsRef.current;
    if (!enabled || !runtime || !workspaceId || runningRef.current) return;
    const syncable = accounts.filter((a) => isSyncableProvider(a.provider) && !a.deletedAt);
    if (syncable.length === 0) return;
    runningRef.current = true;
    window.clearTimeout(retryRef.current.timer);
    const range = syncWindow(new Date());
    let changed = false;
    let failed = false;
    try {
      for (const acc of syncable) {
        const outcome = await syncAccount(runtime, workspaceId, acc, events, range);
        if (outcome === "changed") changed = true;
        if (outcome === "failed") failed = true;
      }
    } finally {
      runningRef.current = false;
    }
    scheduleRetry(retryRef.current, failed, () => void syncNow());
    if (changed) onSynced();
  }, []);

  const accountKey = opts.accounts
    .filter((account) => !account.deletedAt)
    .map((account) => account.externalId)
    .sort()
    .join("|");

  useEffect(() => {
    if (!opts.enabled) return;
    // accountKey is the trigger: a calendar that just appeared must sync now,
    // not on the next 15-minute tick. syncNow itself reads the live list.
    void accountKey;
    void syncNow();
    const id = window.setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(retryRef.current.timer);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [opts.enabled, syncNow, accountKey]);

  return { syncNow };
}
