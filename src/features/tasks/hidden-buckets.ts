// Bucket changes made in this app session that a loaded bundle may not show
// yet (tasks-v2 Q1-4, TV-U6).
//
// Every surface that loads tasks runs its own `useTasksModule` (Tasks,
// Calendar, Notes, Email), each with a bundle loaded at its own time. A bucket
// deleted or archived here has to leave all of them at once, and stay gone in
// a bundle loaded before the server had the change. So the change lives here,
// shared by every instance, and each one applies it on top of its bundle:
//   - "move":     deleted, its tasks moved to Inbox (they show in Inbox);
//   - "drop":     deleted with its tasks (the bucket and its tasks are gone);
//   - "archived": archived (hidden with its tasks, listed under Archived).
// While the server write is in flight an entry applies everywhere. Once the
// server confirms it, an entry applies only to bundles loaded before the
// confirmation: a bundle loaded later already says what the server says,
// including a teammate's restore since. Undo, Restore and Unarchive clear the
// entry (`unhideBucket`), so the bundles that still hold the bucket show it
// again at once.

import { useSyncExternalStore } from "react";

export type BucketChange = "move" | "drop" | "archived";

export type BucketChangeEntry = {
  change: BucketChange;
  /** When the server confirmed it (`Date.now()`), or null while in flight. */
  confirmedAt: number | null;
};

let entries: ReadonlyMap<string, BucketChangeEntry> = new Map();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Record a change the moment it's made (before the server has it). */
export function hideBucket(id: string, change: BucketChange = "move"): void {
  const prev = entries.get(id);
  if (prev && prev.change === change && prev.confirmedAt === null) return;
  entries = new Map(entries).set(id, { change, confirmedAt: null });
  emit();
}

/** The server has the change: bundles loaded from now on show it themselves. */
export function confirmBucket(id: string, at: number = Date.now()): void {
  const prev = entries.get(id);
  if (!prev) return;
  entries = new Map(entries).set(id, { ...prev, confirmedAt: at });
  emit();
}

/** Undo, Restore, Unarchive, or a failed write: the bucket is back. */
export function unhideBucket(id: string): void {
  if (!entries.has(id)) return;
  const next = new Map(entries);
  next.delete(id);
  entries = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Same Map until it changes — a fresh one per read would loop useSyncExternalStore.
function getSnapshot(): ReadonlyMap<string, BucketChangeEntry> {
  return entries;
}

/** Every bucket change made this session. */
export function useBucketChanges(): ReadonlyMap<string, BucketChangeEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The changes a bundle still needs: every one in flight, and every confirmed
 * one the bundle's read started before (`loadedAt`, `Date.now()` at the start
 * of the read; 0 = nothing loaded yet).
 */
export function changesFor(
  all: ReadonlyMap<string, BucketChangeEntry>,
  loadedAt: number,
): Map<string, BucketChange> {
  const out = new Map<string, BucketChange>();
  for (const [id, entry] of all) {
    if (entry.confirmedAt === null || loadedAt <= entry.confirmedAt) out.set(id, entry.change);
  }
  return out;
}
