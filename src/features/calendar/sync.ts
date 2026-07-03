// Desktop calendar-sync orchestration helpers (CAL-6b). The desktop app is the
// sync WRITER: it fetches raw provider events via the Tauri OAuth engine, maps
// them with the pure mirror mapper, and pushes them to Supabase through the
// mirror op. This file holds the pure pieces (the sync window); the effectful
// loop is the `useCalendarSync` hook.

/** Providers the desktop engine can fetch. */
export type SyncableProvider = "google" | "microsoft";

export function isSyncableProvider(p: string): p is SyncableProvider {
  return p === "google" || p === "microsoft";
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
