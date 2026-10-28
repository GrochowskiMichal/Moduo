// The composer's draft, shared with the grid (CALR-9, AC16): the box writes
// where the event will land, each day column reads it and draws the draft
// there. A tiny external store, so the grid needs no new props and only the
// columns the draft enters or leaves redraw.

import { useSyncExternalStore } from "react";

export type ComposerDraft = { title: string; startMs: number; endMs: number };

let current: ComposerDraft | null = null;
const listeners = new Set<() => void>();

export function setComposerDraft(next: ComposerDraft | null): void {
  if (
    next === current ||
    (next &&
      current &&
      next.title === current.title &&
      next.startMs === current.startMs &&
      next.endMs === current.endMs)
  ) {
    return;
  }
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getDraft = () => current;
const getNone = () => null;

/** The draft, while the composer is open. */
export function useComposerDraft(): ComposerDraft | null {
  return useSyncExternalStore(subscribe, getDraft, getNone);
}
