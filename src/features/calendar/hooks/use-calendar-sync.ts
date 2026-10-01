// Calendar sync — the sync WRITER loop. Fetches each connected account's raw
// provider events, maps them, and pushes them through the mirror op. Desktop
// reads the OS keychain. Web reads Google through the stored refresh token and
// skips Outlook, CalDAV, and ICS (those credentials stay on the desktop).
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

function isMissingGoogleKeychain(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("google_calendar_missing_tokens") ||
    msg.includes("google_calendar_missing_access_token")
  );
}

export function useCalendarSync(opts: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  accounts: CalendarAccountModel[];
  /** The currently-mirrored events — used to diff provider-side deletions. */
  events: CalendarEventModel[];
  /** Web syncs Google only. Other providers throw and are left untouched. */
  enabled: boolean;
  /** Reload the module bundle after a sync actually changed rows. */
  onSynced: () => void;
}): { syncNow: () => Promise<void> } {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const runningRef = useRef(false);

  const syncNow = useCallback(async () => {
    const { runtime, workspaceId, accounts, events, enabled, onSynced } = optsRef.current;
    if (!enabled || !runtime || !workspaceId || runningRef.current) return;
    const syncable = accounts.filter((a) => isSyncableProvider(a.provider) && !a.deletedAt);
    if (syncable.length === 0) return;
    runningRef.current = true;
    const { timeMin, timeMax } = syncWindow(new Date());
    let changed = false;
    try {
      for (const acc of syncable) {
        const provider = acc.provider as SyncableProvider;
        try {
          let raw: Record<string, unknown>[];
          try {
            raw = await runtime.calendar.fetchExternalEvents({
              provider,
              externalAccountId: acc.externalId,
              timeMin,
              timeMax,
              syncToken: acc.syncToken ?? null,
            });
          } catch (err) {
            // Connected on the web: the token is in Supabase, not this
            // machine's keychain. Read it from there instead of marking the
            // shared account as broken.
            if (provider === "google" && isMissingGoogleKeychain(err)) {
              raw = await fetchGoogleWebEvents({
                externalAccountId: acc.externalId,
                timeMin,
                timeMax,
              });
            } else {
              throw err;
            }
          }
          // CalDAV/ICS raws are ICS text; ical.js loads lazily (desktop-only
          // path) so the web bundle never carries the parser.
          const mapped = isIcsProvider(provider)
            ? (await import("../ics-mirror")).mapIcsEvents(raw, { timeMin, timeMax })
            : mapProviderEvents(provider, raw);
          // Diff against what we last mirrored for this account so events the
          // provider HARD-DELETED (they just vanish from the fetch, unlike
          // cancellations which carry status) get tombstoned, not left stale.
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
          if (res.upserted > 0 || res.removed > 0) changed = true;
        } catch (err) {
          // One account's failure must not wedge the others.
          console.warn("[calendar-sync]", provider, err);
          // A CalDAV/ICS account's credentials live only in the connecting
          // machine's keychain. On a SECOND desktop (or a teammate's) that
          // machine simply doesn't hold them — that is not the account's fault,
          // so DON'T flip the shared row to `error` (it would flap Reconnect for
          // everyone every ≤15 min as the owning machine flips it back). Only a
          // real sync failure on a machine that HAS the creds flips status.
          if (isLocalCredentialAbsence(err)) continue;
          await runtime.calendar
            .upsertAccount({
              workspaceId,
              provider,
              externalId: acc.externalId,
              displayLabel: acc.displayLabel,
              color: acc.color,
              status: "error",
              lastSyncAt: acc.lastSyncAt,
            })
            .catch(() => {});
        }
      }
    } finally {
      runningRef.current = false;
    }
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
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [opts.enabled, syncNow, accountKey]);

  return { syncNow };
}
