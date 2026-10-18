// Whether What's new is open, and on which release (REL-4). One dialog is
// mounted app-wide; the "Updated to X" toast, the desktop update toast and
// Settings → About open it from here. It only ever opens on a click, never
// by itself over someone's work.

import { useSyncExternalStore } from "react";
import type { Release } from "./releases";

export type WhatsNewState = {
  open: boolean;
  /** The release shown first (null = the newest bundled one). */
  version: string | null;
  /** A release this build doesn't have yet (the desktop update toast's next
   *  version, read from the updater's notes). Shown above the bundled ones. */
  upcoming: Release | null;
};

const CLOSED: WhatsNewState = { open: false, version: null, upcoming: null };

let state: WhatsNewState = CLOSED;
const listeners = new Set<() => void>();

function set(next: WhatsNewState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Open What's new on a release (the newest when left out). */
export function openWhatsNew(opts: { version?: string; upcoming?: Release } = {}): void {
  set({
    open: true,
    version: opts.upcoming?.version ?? opts.version ?? null,
    upcoming: opts.upcoming ?? null,
  });
}

export function closeWhatsNew(): void {
  set({ ...state, open: false });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;

export function useWhatsNewState(): WhatsNewState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only: back to closed. */
export function resetWhatsNewForTest(): void {
  set(CLOSED);
}
