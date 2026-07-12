// Day-to-day behaviour preferences (DF-19f). ONE synced domain holds every group:
// default landing view, startup/behaviour, and sounds & motion. (Per-type
// notification toggles join this domain later once DF-9 lands — no migration
// needed, the cloud payload is opaque jsonb.)
//
// Two-layer persistence, mirroring appearance / focus:
//   1. In-app + cross-tab: the canonical value lives in a module-level store read
//      via useSyncExternalStore, so every usePreferences() instance shares it and
//      a `storage` listener folds in writes from other tabs. Imperative readers
//      (the boot landing redirect, the focus-chime sound gate, motion at boot)
//      read the same store synchronously.
//   2. Cross-device: the value round-trips to Supabase `user_preferences.preferences`
//      via prefs-sync.ts (owner-aware last-write-wins), with the localStorage mirror
//      as the instant first-paint + offline cache.
//
// Only `motion` has a DOM surface (the `data-motion` attribute, layered over the OS
// prefers-reduced-motion — see tokens.css); the rest are read by their consumers.

import { useCallback, useSyncExternalStore } from "react";
import { useDomainSync } from "./prefs-sync";

export type LandingView =
  | "home"
  | "tasks"
  | "calendar"
  | "notes"
  | "contacts"
  | "email"
  | "last";

/** Motion policy layered over the OS `prefers-reduced-motion` (see tokens.css):
 *  `system` follows the OS, `reduced` forces movement off, `full` forces it on. */
export type MotionPref = "system" | "reduced" | "full";

export interface Preferences {
  /** Which surface opens on launch. `last` = the last visited module route. */
  landingView: LandingView;
  /** Reopen the workspace you last had selected (vs. defaulting to the first). */
  reopenLastWorkspace: boolean;
  /** Master switch for app sound effects (today: the Focus interval chime). */
  soundEnabled: boolean;
  /** Reduce-motion override, layered on the OS setting. */
  motion: MotionPref;
}

export const DEFAULT_PREFERENCES: Preferences = {
  landingView: "home",
  reopenLastWorkspace: true,
  soundEnabled: true,
  motion: "system",
};

const LOCAL_STORAGE_KEY = "moduo.preferences";
const LAST_ROUTE_KEY = "moduo.lastRoute";

const LANDING_VIEWS: ReadonlyArray<LandingView> = [
  "home",
  "tasks",
  "calendar",
  "notes",
  "contacts",
  "email",
  "last",
];
const MOTION_PREFS: ReadonlyArray<MotionPref> = ["system", "reduced", "full"];

/** Top-level module routes the app can land on (and remember as "last used").
 *  Hidden/utility routes (/mindmap, /settings, /onboarding…) are intentionally
 *  excluded — landing on them would be surprising. */
const LANDABLE_ROUTES: ReadonlyArray<string> = [
  "/",
  "/tasks",
  "/calendar",
  "/notes",
  "/contacts",
  "/email",
];

/** landingView (excluding home/last) → its route. */
const VIEW_ROUTES: Record<Exclude<LandingView, "home" | "last">, string> = {
  tasks: "/tasks",
  calendar: "/calendar",
  notes: "/notes",
  contacts: "/contacts",
  email: "/email",
};

export function isLandableRoute(pathname: string): boolean {
  return LANDABLE_ROUTES.includes(pathname);
}

// ── Sanitize / read / mirror ──────────────────────────────────────────────────

export function sanitizePreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFERENCES };
  const c = raw as Record<string, unknown>;
  return {
    landingView:
      typeof c.landingView === "string" && (LANDING_VIEWS as string[]).includes(c.landingView)
        ? (c.landingView as LandingView)
        : DEFAULT_PREFERENCES.landingView,
    reopenLastWorkspace:
      typeof c.reopenLastWorkspace === "boolean"
        ? c.reopenLastWorkspace
        : DEFAULT_PREFERENCES.reopenLastWorkspace,
    soundEnabled:
      typeof c.soundEnabled === "boolean" ? c.soundEnabled : DEFAULT_PREFERENCES.soundEnabled,
    motion:
      typeof c.motion === "string" && (MOTION_PREFS as string[]).includes(c.motion)
        ? (c.motion as MotionPref)
        : DEFAULT_PREFERENCES.motion,
  };
}

export function readLocalPreferences(): Preferences {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function writeLocalMirror(prefs: Preferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota exceeded or storage disabled — non-fatal */
  }
}

// ── Motion (the only DOM-applied field) ───────────────────────────────────────

/** Apply the motion override to <html> as `data-motion`. tokens.css reads it to
 *  layer over the OS `prefers-reduced-motion`. Called at boot (main.tsx) and on
 *  every change (local edit or cloud win). */
export function applyMotion(motion: MotionPref): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-motion", motion);
}

// ── Landing view resolution (pure) ────────────────────────────────────────────

/**
 * The route to redirect to on launch for a given landing preference, or `null`
 * to stay on Home ("/"). Pure — the one-shot/guard wiring lives in
 * `consumeLandingRedirect`.
 *
 *  - `home`  → null (Home is "/").
 *  - `last`  → the remembered route if it's a real, non-home module route, else null.
 *  - module  → that module's route.
 */
export function resolveLandingRoute(
  landingView: LandingView,
  lastRoute: string | null,
): string | null {
  if (landingView === "home") return null;
  if (landingView === "last") {
    return lastRoute && LANDABLE_ROUTES.includes(lastRoute) && lastRoute !== "/" ? lastRoute : null;
  }
  const target = VIEW_ROUTES[landingView];
  return target ?? null;
}

/** Remember the current top-level route so `landingView: "last"` can restore it.
 *  Only the landable module routes are stored; utility routes are ignored. */
export function writeLastRoute(pathname: string): void {
  if (typeof localStorage === "undefined") return;
  if (!LANDABLE_ROUTES.includes(pathname)) return;
  try {
    localStorage.setItem(LAST_ROUTE_KEY, pathname);
  } catch {
    /* non-fatal */
  }
}

export function readLastRoute(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const v = localStorage.getItem(LAST_ROUTE_KEY);
    return v && LANDABLE_ROUTES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

// A persisted Supabase auth session lives under `sb-<project-ref>-auth-token` (the
// default storage key — the client is created with no custom storageKey). We sniff
// it synchronously so the boot redirect only fires for a signed-in launch. Failure
// modes are both benign: a false negative just skips the redirect this launch (user
// sees Home); a false positive redirects then the app-gate bounces to /auth.
function hasPersistedAuthSession(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const v = localStorage.getItem(k);
        if (v && v !== "null" && v !== "undefined") return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

// One-shot per app load: the landing preference applies once, on the first
// authenticated arrival at "/". Subsequent in-app navigations to Home are user
// intent and must never redirect. Not consumed until a session is present, so a
// signed-out first visit (redirected to /auth) doesn't burn the shot before login.
let landingConsumed = false;

/** Reset the one-shot — test-only seam. */
export function resetLandingRedirectForTest(): void {
  landingConsumed = false;
}

/**
 * Resolve the boot landing redirect for the current location, consuming the
 * one-shot. Returns a route to redirect to, or null to stay put. Explicit
 * deep-links win: any query string at "/" (e.g. `?section=…`) is treated as
 * intentional and skips the redirect; non-"/" paths are never touched here.
 */
export function consumeLandingRedirect(pathname: string, searchStr: string): string | null {
  if (landingConsumed) return null;
  if (pathname !== "/") return null;
  // Any query params at "/" = an explicit deep link (e.g. a settings section) — honour it.
  if (searchStr && searchStr.replace(/^\?/, "") !== "") return null;
  if (!hasPersistedAuthSession()) return null; // pre-auth — wait for the post-login "/"
  landingConsumed = true;
  const prefs = readLocalPreferences();
  return resolveLandingRoute(prefs.landingView, readLastRoute());
}

// ── Imperative reads for non-React consumers ──────────────────────────────────

/** Master sound gate, read imperatively by the Focus chime (focus-session-store). */
export function areSoundsEnabled(): boolean {
  return store.soundEnabled;
}

// ── Shared module store (mirrors focus-prefs) ─────────────────────────────────

let store: Preferences = readLocalPreferences();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setStore(next: Preferences): void {
  store = next;
  emit();
}

function getSnapshot(): Preferences {
  return store;
}

function handleStorage(event: StorageEvent): void {
  // A cross-tab write to our key (or a localStorage.clear(), key === null).
  if (event.key !== null && event.key !== LOCAL_STORAGE_KEY) return;
  store = readLocalPreferences();
  applyMotion(store.motion);
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export interface UsePreferences {
  preferences: Preferences;
  setPreferences: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

export function usePreferences(): UsePreferences {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A value won from the cloud (another device) lands in the shared store, so every
  // mounted instance re-renders; keep the localStorage mirror + DOM warm too.
  const applyFromCloud = useCallback((value: Record<string, unknown>) => {
    const next = sanitizePreferences(value);
    setStore(next);
    writeLocalMirror(next);
    applyMotion(next.motion);
  }, []);

  // Every field syncs, so the cloud blob IS the full prefs object (the shared store).
  const { pushLocalChange } = useDomainSync({
    domain: "preferences",
    getLocalSyncable: () => store as unknown as Record<string, unknown>,
    defaults: DEFAULT_PREFERENCES as unknown as Record<string, unknown>,
    sanitizeCloud: (raw) => sanitizePreferences(raw) as unknown as Record<string, unknown>,
    apply: applyFromCloud,
  });

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      const next = sanitizePreferences({ ...store, ...patch });
      setStore(next);
      writeLocalMirror(next);
      applyMotion(next.motion);
      pushLocalChange(next as unknown as Record<string, unknown>);
    },
    [pushLocalChange],
  );

  return {
    preferences,
    setPreferences: update,
    reset: () => update(DEFAULT_PREFERENCES),
  };
}
