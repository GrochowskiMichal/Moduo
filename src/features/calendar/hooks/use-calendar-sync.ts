// Desktop calendar sync (CAL-6b) — the sync WRITER loop. On the desktop app it
// fetches each connected account's raw provider events via the Tauri OAuth
// engine, maps them with the pure mirror mapper, and pushes them to Supabase
// through the mirror op; on failure it flips the account to `error` (the rail
// surfaces Reconnect). Web is a no-op (it renders the mirror, never writes it).
// Runs on the calendar page: mount + tab-wake + every 15 min + manual refresh.

import { useCallback, useEffect, useRef } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { CalendarAccountModel, CalendarEventModel } from "../events";
import { deletedExternalIds, mapProviderEvents } from "../mirror";
import { isIcsProvider, isSyncableProvider, syncWindow } from "../sync";
import type { SyncableProvider } from "../sync";

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
    msg.includes("ics_feed_missing")
  );
}

export function useCalendarSync(opts: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  accounts: CalendarAccountModel[];
  /** The currently-mirrored events — used to diff provider-side deletions. */
  events: CalendarEventModel[];
  /** Desktop only — web returns [] from fetchExternalEvents, so never runs. */
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
          const raw = await runtime.calendar.fetchExternalEvents({
            provider,
            externalAccountId: acc.externalId,
            timeMin,
            timeMax,
            syncToken: acc.syncToken ?? null,
          });
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

  useEffect(() => {
    if (!opts.enabled) return;
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
  }, [opts.enabled, syncNow]);

  return { syncNow };
}
