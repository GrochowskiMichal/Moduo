// Persisted view prefs (DS-4): "remember how this view is set up, per
// workspace and scope, on this device". One helper for the read-sanitise-
// fallback / write-and-ignore-failures pattern that tasks, calendar and email
// each wrote their own copy of. Tasks and calendar keys fit `viewPrefsKey`;
// email's (`moduo:email:prefs:<user>`) is a user-prefs mirror, so it can use
// `readViewPrefs` / `writeViewPrefs` with its own key, not `viewPrefsKey`.
//
// It is local-only by design: a view setting is a per-device convenience, not
// account data (cloud-synced user prefs live in preferences.ts / prefs-sync.ts).
// Every failure — no window, storage disabled, quota, corrupt JSON, a value of
// the wrong shape — falls back to the defaults instead of throwing.

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * `moduo:<module>:view:<part>:<part>…`. Tasks keys a view by workspace and
 * scope (`viewPrefsKey("tasks", ws, scope)`); calendar's existing key is
 * `viewPrefsKey("calendar", userId, ws)`. Returns null when a part is missing,
 * so a view with no workspace yet simply doesn't persist.
 */
export function viewPrefsKey(
  module: string,
  ...parts: ReadonlyArray<string | null | undefined>
): string | null {
  if (!module || parts.length === 0 || parts.some((p) => !p)) return null;
  return `moduo:${module}:view:${parts.join(":")}`;
}

type Defaults<T> = T | (() => T);

function resolve<T>(defaults: Defaults<T>): T {
  return typeof defaults === "function" ? (defaults as () => T)() : defaults;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The default sanitiser: keeps the stored value field by field where it has
 * the default's shape (same `typeof`, arrays for arrays, nested objects merged
 * the same way) and takes the default for everything else. Unknown fields are
 * dropped. It can't know a closed vocabulary ("list" | "board"); pass your own
 * `sanitize` for that.
 */
export function mergeViewPrefs<T>(raw: unknown, defaults: T): T {
  if (Array.isArray(defaults)) return (Array.isArray(raw) ? raw : defaults) as T;
  if (isPlainObject(defaults)) {
    if (!isPlainObject(raw)) return defaults;
    const out: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      out[key] = key in raw ? mergeViewPrefs(raw[key], fallback) : fallback;
    }
    return out as T;
  }
  // A null default (a nullable id, "nothing picked") can't say which type it
  // stands for: keep any stored primitive or null, never an object.
  if (defaults === null) return (raw === null || typeof raw !== "object" ? raw : defaults) as T;
  return (typeof raw === typeof defaults && raw !== null ? raw : defaults) as T;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // a sandboxed frame throws on the getter itself
  }
}

/** Reads a view's prefs. Missing key, unreadable storage or corrupt JSON →
 *  the defaults; a stored value goes through `sanitize` (default:
 *  `mergeViewPrefs`), and a sanitiser that throws also yields the defaults. */
export function readViewPrefs<T>(
  key: string | null | undefined,
  defaults: Defaults<T>,
  sanitize: (raw: unknown, defaults: T) => T = mergeViewPrefs,
): T {
  const store = key ? storage() : null;
  if (!key || !store) return resolve(defaults);
  try {
    const raw = store.getItem(key);
    if (raw === null) return resolve(defaults);
    const fallback = resolve(defaults);
    return sanitize(JSON.parse(raw), fallback);
  } catch {
    return resolve(defaults);
  }
}

/** Stores a view's prefs. A null key or failing storage is a silent no-op. */
export function writeViewPrefs(key: string | null | undefined, value: unknown): void {
  const store = key ? storage() : null;
  if (!key || !store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or disabled storage: the view still works, it just won't be remembered.
  }
}

/** Forgets a view's prefs (e.g. Display → Reset to default). */
export function clearViewPrefs(key: string | null | undefined): void {
  const store = key ? storage() : null;
  if (!key || !store) return;
  try {
    store.removeItem(key);
  } catch {
    // Same as writeViewPrefs.
  }
}

/**
 * React state backed by a view-prefs key: read once when the key (scope)
 * mounts or changes, written on every set. Switching scope re-reads the new
 * scope's prefs instead of carrying the old ones over. Call `set` from event
 * handlers or effects, not from a child's layout effect on the render that
 * changes the scope: that runs before this hook syncs, so it would still
 * write to the old scope.
 */
export function useViewPrefs<T>(
  key: string | null | undefined,
  defaults: Defaults<T>,
  sanitize?: (raw: unknown, defaults: T) => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState(() => ({
    key,
    value: readViewPrefs(key, defaults, sanitize),
  }));
  let current = state;
  if (state.key !== key) {
    // Derive-on-render: the new scope's prefs replace the old in this render.
    current = { key, value: readViewPrefs(key, defaults, sanitize) };
    setState(current);
  }
  // Synced after commit, so a scope change rendered and then thrown away
  // (a discarded transition) never retargets `set`.
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    const { key: k, value: prev } = latest.current;
    const value = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
    writeViewPrefs(k, value);
    latest.current = { key: k, value };
    setState({ key: k, value });
  }, []);

  return [current.value, set];
}
