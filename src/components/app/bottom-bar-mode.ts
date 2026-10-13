// The bottom bar's modes (tasks-v3 82b; built for the Inbox's triage in
// TV-U15, and the pattern TV-U12's multi-select row and other modules' modes
// reuse). While a mode is on, the bar's centre shows that mode's few
// most-used actions, each with its key, then More ▾ for the rest (the cap is
// six), in place of Search · Quick capture · New. One mode at a time: the
// page that owns it sets it while it applies and clears it when it doesn't.

import { useEffect, useSyncExternalStore } from "react";

export type BottomBarAction = {
  id: string;
  label: string;
  /** Its key, shown after the label ("1", "H", "Space"). */
  keyHint?: string;
  run: () => void;
  disabled?: boolean;
};

export type BottomBarMode = {
  /** Who set it: only its owner clears it. */
  id: string;
  /** The toolbar's name for screen readers ("Triage"). */
  label: string;
  /** The actions, most used first; past six they go behind More ▾. */
  actions: readonly BottomBarAction[];
  /** Quiet words after the actions ("4 selected · Esc"). */
  note?: string;
};

/** How many actions show before More ▾ (82b's cap). */
export const BOTTOM_BAR_MODE_CAP = 6;

let current: BottomBarMode | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Turn a mode on (it replaces whatever mode was on). */
export function setBottomBarMode(mode: BottomBarMode): void {
  current = mode;
  emit();
}

/** Turn a mode off, if it's still the one on. */
export function clearBottomBarMode(id: string): void {
  if (current?.id !== id) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The mode on now, or null (the bar shows its tools). */
export function useBottomBarMode(): BottomBarMode | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/**
 * Own the bar's mode while `mode` is set: on while it's given, off when it
 * goes null or the owner unmounts. Pass a stable object (memoised), so the
 * bar redraws only when the mode changes.
 */
export function useBottomBarModeOwner(mode: BottomBarMode | null): void {
  useEffect(() => {
    if (!mode) return;
    setBottomBarMode(mode);
    return () => clearBottomBarMode(mode.id);
  }, [mode]);
}
