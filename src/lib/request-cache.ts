// Boot-time request coalescer (DF-12). One cold launch used to fire the same
// reads many times over — `/auth/v1/user` ×8, profiles ×4, etc. — because every
// runtime method, provider, and gate fetched independently with no shared layer.
//
// This collapses redundant reads per key two ways:
//   - in-flight dedupe: concurrent callers for a key share the one pending promise.
//   - TTL cache: a caller within `ttlMs` of a resolved value reuses it, so the
//     provider/gate remount cascade doesn't re-issue an already-answered read.
//
// A rejected fetch is NEVER cached (the next caller retries), so a transient error
// can't poison the key. Writes call `invalidate(key)` so a mutation's refetch is
// always fresh — the cache only ever collapses the launch storm, never masks a
// change the user just made.
//
// This generalises the single existing memo (`prefs-sync.ts` `inFlightGet`) into a
// keyed layer usable across the runtime.

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export interface RequestCache {
  /**
   * Coalesced read for `key`.
   * - `ttlMs === 0` (default): in-flight dedupe only — the resolved value is not
   *   retained, so the next call after settle re-fetches.
   * - `ttlMs > 0`: also cache the resolved value for that window.
   * - `ttlMs === Infinity`: cache until `invalidate`/`clear` (e.g. the auth user,
   *   dropped only on an identity transition).
   */
  read<T>(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T>;
  /** Drop a key's cached value + any in-flight promise so the next read is fresh. */
  invalidate(key: string): void;
  /** Drop everything (e.g. on sign-out — the whole boot cache belonged to that user). */
  clear(): void;
}

export function createRequestCache(now: () => number = Date.now): RequestCache {
  const entries = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();
  // Bumped by every invalidate/clear. A fetch that started before an invalidation
  // must not write its now-stale result back into the cache — e.g. a `getUser` read
  // in flight when SIGNED_OUT clears the cache must not repopulate the old user.
  // It's a single counter across all keys (not per-key) on purpose: invalidating one
  // key also skips the cache-write of any OTHER key's in-flight fetch, which only
  // ever forces a redundant refetch — it never serves stale data — and keeps this
  // conservative and simple. Invalidations are rare (auth transitions / writes).
  let epoch = 0;

  function read<T>(key: string, fetcher: () => Promise<T>, ttlMs = 0): Promise<T> {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.value as T);

    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;

    const startEpoch = epoch;
    const p = (async () => {
      try {
        const value = await fetcher();
        // Retain only a successful read that wasn't invalidated mid-flight. A
        // rejection falls through the `finally` un-cached so the next caller retries.
        if (ttlMs > 0 && epoch === startEpoch) entries.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p as Promise<T>;
  }

  function invalidate(key: string): void {
    entries.delete(key);
    inflight.delete(key);
    epoch += 1;
  }

  function clear(): void {
    entries.clear();
    inflight.clear();
    epoch += 1;
  }

  return { read, invalidate, clear };
}
