// TS-3a (specs/tanstack-spine.md): a kernel table the store drives, mirrored
// into an in-memory TanStack DB collection. The store keeps reading, landing,
// seeding from its device copy, overlaying and checking access across tables
// (its phases: open tasks first, then closed tasks, completions and comment
// counts); after each change it calls `sync`, and the collection takes the
// kernel's difference. Its snapshot reads the rows back from the collection.

import { type Collection, createCollection } from "@tanstack/db";
import type { SyncedCollection } from "../kernel/collection";
import type { LandingRow } from "../kernel/landing";
import { type SupabaseCollectionUtils, supabaseCollectionOptions } from "./supabase-collection";

export type KernelMirror<R extends object> = {
  readonly collection: Collection<R, string, SupabaseCollectionUtils<R>>;
  /** The collection's rows, the same map until a change lands in it. */
  rows(): ReadonlyMap<string, R>;
  /** Take the kernel's difference (the store calls it after changing the kernel). */
  sync(): void;
  /** Called on every change the collection commits. */
  onChange(fn: () => void): () => void;
  dispose(): void;
};

/** The part of the collection's (internal) state the raw read needs. */
type RawState<R> = { get(key: string): R | undefined; keys(): Iterable<string> };

/**
 * The collection's rows as stored, not as `state` / `get` hand them out: those
 * add virtual props (`$synced`, `$origin`, …) to a fresh object per read,
 * which would change every row the snapshot holds and redraw it. In the
 * kernel's order (arrival), which the snapshot has always had; the collection
 * itself keeps its rows sorted by key. Pinned `@tanstack/db` 0.15.1: re-check
 * `_state` on an upgrade (`kernel-mirror.test.ts` fails if it moves).
 */
function rawRows<R extends object>(
  collection: Collection<R, string, SupabaseCollectionUtils<R>>,
  kernel: SyncedCollection<R & LandingRow>,
): ReadonlyMap<string, R> {
  const state = (collection as unknown as { _state: RawState<R> })._state;
  const rows = new Map<string, R>();
  for (const id of kernel.rows.keys()) {
    const row = state.get(id);
    if (row !== undefined) rows.set(id, row);
  }
  // Rows only the collection holds (TS-3c's writes, never the kernel's yet).
  if (rows.size !== collection.size) {
    for (const id of state.keys()) {
      if (rows.has(id)) continue;
      const row = state.get(id);
      if (row !== undefined) rows.set(id, row);
    }
  }
  return rows;
}

export function mirrorKernel<R extends LandingRow & object>(
  id: string,
  kernel: SyncedCollection<R>,
): KernelMirror<R> {
  const collection = createCollection({
    ...supabaseCollectionOptions<R>({ id, kernel, ownerDriven: true }),
    // The store owns its life (`dispose`): never collected under it.
    gcTime: 0,
  }) as unknown as Collection<R, string, SupabaseCollectionUtils<R>>;
  collection.startSyncImmediate();
  let cached: ReadonlyMap<string, R> | null = null;
  const listeners = new Set<() => void>();
  // With the initial state: a subscription drops deletes of keys it was never
  // sent, so rows the kernel held before it began would otherwise never leave.
  const sub = collection.subscribeChanges(
    () => {
      cached = null;
      for (const fn of listeners) fn();
    },
    { includeInitialState: true },
  );
  return {
    collection,
    rows() {
      cached ??= rawRows(collection, kernel);
      return cached;
    },
    sync() {
      collection.utils.sync();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      sub.unsubscribe();
      listeners.clear();
      void collection.cleanup();
    },
  };
}
