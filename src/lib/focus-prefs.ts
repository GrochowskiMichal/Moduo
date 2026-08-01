// Focus/Pomodoro preferences. No DOM surface to apply to (these only drive the
// Focus-card timer — it reads them instead of hardcoded intervals; Settings →
// Focus and the card's ⋯ popover edit them), so coherence is handled in two
// layers:
//
//  1. In-app + cross-tab: the canonical value lives in a module-level store read
//     via useSyncExternalStore, so every useFocusPrefs() instance shares it —
//     editing in Settings reaches an already-mounted timer (the NowCard) without
//     a remount — and a `storage` listener folds in writes from other tabs.
//  2. Cross-device: the value (every focus field syncs) round-trips to Supabase
//     `user_preferences` via prefs-sync.ts, with the localStorage mirror as the
//     instant first-paint + offline cache. The paused redb local store is not used.
//
// A value won from the cloud (another device) flows back through the same store,
// so it propagates to every instance exactly like a local edit.

import { useCallback, useSyncExternalStore } from "react";
import { useDomainSync } from "./prefs-sync";

export interface FocusPrefs {
  /** Work interval, minutes. */
  workMinutes: number;
  /** Short break interval, minutes. */
  breakMinutes: number;
  /** Long break interval, minutes (after `sessionsBeforeLongBreak` work blocks). */
  longBreakMinutes: number;
  /** Work blocks between long breaks. */
  sessionsBeforeLongBreak: number;
  /** Auto-start the next interval on rollover (vs pausing so you resume by hand).
   *  Never auto-starts the timer itself on focus — only the next interval once
   *  you've opted in by starting (the opt-in-timer principle, 2026-06-16). */
  autoStartNext: boolean;
  /** Play a short chime when an interval ends. */
  soundEnabled: boolean;
}

export const DEFAULT_FOCUS_PREFS: FocusPrefs = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartNext: false,
  soundEnabled: true,
};

const LOCAL_STORAGE_KEY = "moduo.focus";

const MIN_MIN = 1;
const MAX_MIN = 180;

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function sanitize(raw: unknown): FocusPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FOCUS_PREFS };
  const c = raw as Record<string, unknown>;
  return {
    workMinutes: clampInt(c.workMinutes, MIN_MIN, MAX_MIN, DEFAULT_FOCUS_PREFS.workMinutes),
    breakMinutes: clampInt(c.breakMinutes, MIN_MIN, MAX_MIN, DEFAULT_FOCUS_PREFS.breakMinutes),
    longBreakMinutes: clampInt(
      c.longBreakMinutes,
      MIN_MIN,
      MAX_MIN,
      DEFAULT_FOCUS_PREFS.longBreakMinutes,
    ),
    sessionsBeforeLongBreak: clampInt(
      c.sessionsBeforeLongBreak,
      1,
      12,
      DEFAULT_FOCUS_PREFS.sessionsBeforeLongBreak,
    ),
    autoStartNext:
      typeof c.autoStartNext === "boolean" ? c.autoStartNext : DEFAULT_FOCUS_PREFS.autoStartNext,
    soundEnabled:
      typeof c.soundEnabled === "boolean" ? c.soundEnabled : DEFAULT_FOCUS_PREFS.soundEnabled,
  };
}

export function readLocalFocusPrefs(): FocusPrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_FOCUS_PREFS };
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FOCUS_PREFS };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FOCUS_PREFS };
  }
}

function writeLocalMirror(prefs: FocusPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota exceeded or storage disabled — non-fatal */
  }
}

// ── Shared module store ───────────────────────────────────────────────────────
// The canonical in-memory value. Every useFocusPrefs() subscribes to this, so a
// write from any instance (Settings → Focus, the card's ⋯ popover) or from the
// cloud reconcile re-renders the others — no remount required.

let store: FocusPrefs = readLocalFocusPrefs();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setStore(next: FocusPrefs): void {
  store = next;
  emit();
}

function getSnapshot(): FocusPrefs {
  return store;
}

function handleStorage(event: StorageEvent): void {
  // A cross-tab write to our key (or a localStorage.clear(), key === null).
  if (event.key !== null && event.key !== LOCAL_STORAGE_KEY) return;
  store = readLocalFocusPrefs();
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

export interface UseFocusPrefs {
  prefs: FocusPrefs;
  setPrefs: (patch: Partial<FocusPrefs>) => void;
  reset: () => void;
}

export function useFocusPrefs(): UseFocusPrefs {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A value won from the cloud (another device) lands in the shared store, so
  // every mounted instance re-renders; keep the localStorage mirror warm too.
  const applyFromCloud = useCallback((value: Record<string, unknown>) => {
    const next = value as unknown as FocusPrefs; // validated by sanitizeCloud / defaults
    setStore(next);
    writeLocalMirror(next);
  }, []);

  // Every focus field syncs, so the cloud blob IS the full prefs object, read
  // from the shared store (the canonical value).
  const { pushLocalChange } = useDomainSync({
    domain: "focus",
    getLocalSyncable: () => store as unknown as Record<string, unknown>,
    defaults: DEFAULT_FOCUS_PREFS as unknown as Record<string, unknown>,
    sanitizeCloud: (raw) => sanitize(raw) as unknown as Record<string, unknown>,
    apply: applyFromCloud,
  });

  const update = useCallback(
    (patch: Partial<FocusPrefs>) => {
      const next = sanitize({ ...store, ...patch });
      setStore(next);
      writeLocalMirror(next);
      pushLocalChange(next as unknown as Record<string, unknown>);
    },
    [pushLocalChange],
  );

  return {
    prefs,
    setPrefs: update,
    reset: () => update(DEFAULT_FOCUS_PREFS),
  };
}
