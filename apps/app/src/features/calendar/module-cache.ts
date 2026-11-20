// The calendar module's last read for each person and workspace, kept for this
// app session. Coming back to Calendar (from Tasks, say) draws it at once and
// refreshes quietly in the background, the way the Tasks store keeps its rows,
// instead of mounting empty behind a skeleton and reading everything again.
// Keyed by person too, so another account signed in on this device never sees
// it; a reload of the app starts empty.

import type { Truncation } from "../../lib/paged-select";
import type { CalendarAccountModel, CalendarEventModel } from "./events";
import type { CalendarWindow } from "./window";

export type CalendarSnapshot = {
  events: CalendarEventModel[];
  busy: CalendarEventModel[];
  accounts: CalendarAccountModel[];
  /** The window `events` was read for: a return within it needs no skeleton. */
  window: CalendarWindow;
  truncated: Truncation[];
  degraded: boolean;
};

const snapshots = new Map<string, CalendarSnapshot>();

/** The cache key for a person's calendar in a workspace, or null when there is none to read. */
export function snapshotKey(userId: string | null, scope: string | null): string | null {
  return userId && scope ? `${userId}:${scope}` : null;
}

export function readCalendarSnapshot(key: string | null): CalendarSnapshot | undefined {
  return key ? snapshots.get(key) : undefined;
}

export function writeCalendarSnapshot(key: string | null, snapshot: CalendarSnapshot): void {
  if (key) snapshots.set(key, snapshot);
}

/** For tests. */
export function clearCalendarSnapshots(): void {
  snapshots.clear();
}
