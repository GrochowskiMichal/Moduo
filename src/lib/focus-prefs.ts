// Persisted Focus/Pomodoro preferences. Same persistence shape as appearance.ts
// (localStorage mirror for an instant first paint + the Tauri local store as the
// source of truth) but with no DOM application — these only drive the Focus-card
// timer. The timer reads these instead of hardcoded intervals; the Settings →
// Focus section and the card's ⋯ popover edit them.
//
// Unlike appearance.ts — which stays coherent across instances because every
// write lands on :root and every reader pulls from the same DOM — these prefs
// have no surface to apply to. So the canonical value lives in a module-level
// store read via useSyncExternalStore: every useFocusPrefs() instance shares it,
// which is what lets Settings → Focus reach an already-mounted timer (the
// NowCard) without waiting for a remount. A `storage` listener folds in writes
// from other tabs too.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { runtime } from "./runtime";

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
const TAURI_NAMESPACE = "focus";
const TAURI_KEY = "prefs";

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
    longBreakMinutes: clampInt(c.longBreakMinutes, MIN_MIN, MAX_MIN, DEFAULT_FOCUS_PREFS.longBreakMinutes),
    sessionsBeforeLongBreak: clampInt(c.sessionsBeforeLongBreak, 1, 12, DEFAULT_FOCUS_PREFS.sessionsBeforeLongBreak),
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

async function readPersisted(): Promise<FocusPrefs | null> {
  if (!runtime) return null;
  try {
    const raw = await runtime.localStore.get(TAURI_NAMESPACE, TAURI_KEY);
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return sanitize(JSON.parse(raw));
      } catch {
        return null;
      }
    }
    return sanitize(raw);
  } catch {
    return null;
  }
}

async function writePersisted(prefs: FocusPrefs): Promise<void> {
  if (!runtime) return;
  try {
    await runtime.localStore.set(TAURI_NAMESPACE, TAURI_KEY, prefs);
  } catch {
    /* non-fatal — the localStorage mirror still holds the value */
  }
}

// ── Shared module store ───────────────────────────────────────────────────────
// The canonical in-memory value. Every useFocusPrefs() subscribes to this, so a
// write from any instance (Settings → Focus, the card's ⋯ popover) re-renders
// the others — no remount required.

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

  // Hydrate the shared store from the persisted source once (mirrors
  // appearance.ts). `runtime` is null today so this is a no-op, but it keeps the
  // Tauri path live for when it's wired up; idempotent across instances.
  useEffect(() => {
    let cancelled = false;
    void readPersisted().then((persisted) => {
      if (cancelled || !persisted) return;
      setStore(persisted);
      writeLocalMirror(persisted);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<FocusPrefs>) => {
    const next = sanitize({ ...store, ...patch });
    setStore(next);
    writeLocalMirror(next);
    void writePersisted(next);
  }, []);

  return {
    prefs,
    setPrefs: update,
    reset: () => update(DEFAULT_FOCUS_PREFS),
  };
}
