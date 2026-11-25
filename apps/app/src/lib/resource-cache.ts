// Session-lived reads (stale-while-revalidate). A page that unmounts on
// navigation used to throw its data away with its component state, so coming
// back meant drawing from empty and waiting for the network again (Home's
// widgets). Here a read's last good value outlives the component: a remount
// draws it at once through `useSyncExternalStore`, and the refresh it starts
// runs quietly behind it.
//
// - `loading` is true only while a key has no value yet; a refresh of a key
//   that has one sets `refreshing` instead, so a skeleton never covers data.
// - The latest read of a key wins: an older answer arriving late is dropped.
// - A read in flight is shared only with a caller giving the same `shareTag`
//   (two mounts asking the same thing); a refresh after a write passes none,
//   so it never reuses a read that started before the write.
// - A failed read keeps the last good value and sets `error`.
// - `clear()` drops everything and ignores reads still in flight: call it on
//   when the person changes (`createIdentityGate`, fed by the auth listener).
//
// Values live in memory only, never on disk: what a page shows can be
// another module's private data (mail subjects, contact names).
// TanStack Query is kept out of app code (decisions/data.md TS-1), hence this.

import { useCallback, useSyncExternalStore } from "react";

export interface ResourceSnapshot<T> {
  /** The last good value; undefined before the first answer. */
  data: T | undefined;
  /** No value yet and a read is under way (show a skeleton). */
  loading: boolean;
  /** The last read failed (`data` is still the last good value, if any). */
  error: boolean;
  /** A read is under way, with or without a value. */
  refreshing: boolean;
}

interface Entry {
  snap: ResourceSnapshot<unknown>;
  hasValue: boolean;
  seq: number;
  inflight: { tag: string; promise: Promise<void> } | null;
  listeners: Set<() => void>;
}

export interface ResourceCache {
  /** The key's current snapshot (the same object until it changes). */
  peek<T>(key: string): ResourceSnapshot<T>;
  subscribe(key: string, listener: () => void): () => void;
  /** Read the key now; resolves once the answer has been applied (never rejects). */
  fetch<T>(key: string, fetcher: () => Promise<T>, opts?: { shareTag?: string }): Promise<void>;
  /** Put a value in directly (a local edit the page already holds). */
  set<T>(key: string, value: T): void;
  /** Drop every value; reads in flight are ignored when they answer. */
  clear(): void;
}

const EMPTY: ResourceSnapshot<never> = Object.freeze({
  data: undefined,
  loading: false,
  error: false,
  refreshing: false,
});

export function createResourceCache(): ResourceCache {
  let entries = new Map<string, Entry>();

  function entry(key: string): Entry {
    let e = entries.get(key);
    if (!e) {
      e = { snap: EMPTY, hasValue: false, seq: 0, inflight: null, listeners: new Set() };
      entries.set(key, e);
    }
    return e;
  }

  function update(e: Entry, patch: Partial<ResourceSnapshot<unknown>>): void {
    const next = { ...e.snap, ...patch };
    next.loading = !e.hasValue && next.refreshing;
    const prev = e.snap;
    if (
      prev.data === next.data &&
      prev.loading === next.loading &&
      prev.error === next.error &&
      prev.refreshing === next.refreshing
    ) {
      return;
    }
    e.snap = next;
    for (const l of e.listeners) l();
  }

  function fetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts: { shareTag?: string } = {},
  ): Promise<void> {
    const e = entry(key);
    if (opts.shareTag !== undefined && e.inflight && e.inflight.tag === opts.shareTag) {
      return e.inflight.promise;
    }
    const mine = ++e.seq;
    const current = () => entries.get(key) === e && e.seq === mine;
    update(e, { refreshing: true });
    const run = async () => {
      try {
        const value = await fetcher();
        if (!current()) return;
        e.hasValue = true;
        update(e, { data: value, error: false, refreshing: false });
      } catch {
        if (!current()) return;
        update(e, { error: true, refreshing: false });
      }
    };
    const inflight = { tag: opts.shareTag ?? `\u0000${mine}`, promise: run() };
    e.inflight = inflight;
    void inflight.promise.finally(() => {
      if (e.inflight === inflight) e.inflight = null;
    });
    return inflight.promise;
  }

  function set<T>(key: string, value: T): void {
    const e = entry(key);
    e.hasValue = true;
    update(e, { data: value, error: false });
  }

  function clear(): void {
    const old = entries;
    entries = new Map();
    // Keep the listeners (mounted readers) on fresh entries, and tell them.
    for (const [key, e] of old) {
      if (e.listeners.size === 0) continue;
      const fresh = entry(key);
      for (const l of e.listeners) fresh.listeners.add(l);
      for (const l of fresh.listeners) l();
    }
  }

  return {
    peek: <T>(key: string) => (entries.get(key)?.snap ?? EMPTY) as ResourceSnapshot<T>,
    subscribe(key, listener) {
      const e = entry(key);
      e.listeners.add(listener);
      return () => {
        // The entry may have been replaced by clear(): unhook from whichever holds it.
        entries.get(key)?.listeners.delete(listener);
        e.listeners.delete(listener);
      };
    },
    fetch,
    set,
    clear,
  };
}

/** The app's one cache, cleared when the signed-in person changes. */
export const sessionResources = createResourceCache();

/**
 * Clears `cache` when the signed-in person changes, never for the same person.
 * Feed it every auth event with the session's user id: supabase-js re-emits
 * SIGNED_IN for the same person each time a hidden tab comes back, and a clear
 * then would blank every mounted reader (the validator's BLOCKER).
 */
export function createIdentityGate(cache: ResourceCache) {
  let last: string | null | undefined;
  return (event: string, userId: string | null): void => {
    if (event === "SIGNED_OUT" || (last !== undefined && userId !== last)) cache.clear();
    last = event === "SIGNED_OUT" ? null : userId;
  };
}

const noSubscribe = () => () => {};
const emptySnap = () => EMPTY;

/** A key's snapshot, live; `null` reads as empty. */
export function useResource<T>(
  key: string | null,
  cache: ResourceCache = sessionResources,
): ResourceSnapshot<T> {
  const subscribe = useCallback(
    (listener: () => void) => (key ? cache.subscribe(key, listener) : () => {}),
    [cache, key],
  );
  const get = useCallback(
    () => (key ? cache.peek<T>(key) : (EMPTY as ResourceSnapshot<T>)),
    [cache, key],
  );
  return useSyncExternalStore(
    key ? subscribe : noSubscribe,
    key ? get : emptySnap,
    key ? get : emptySnap,
  );
}
