// What Shared with you, the lanes, the composer and Preview as share (CALR-16):
// a tiny external store, like composer/draft-store.ts, so the page passes no
// new props through the panel, the grid or the composer.

import { useSyncExternalStore } from "react";

import type { Teammate, TeammateBlock } from "../teammates";

export type TeammatesState = {
  /** Teammates sharing with you, at their level. */
  teammates: Teammate[];
  /** Their timed blocks in the loaded window. */
  blocks: TeammateBlock[];
  /** Turned on in Shared with you (remembered per user and workspace). */
  shown: string[];
  /** Teammates the composer recognised in its text. */
  named: string[];
  /** Preview as: the member, or null. */
  previewAs: string | null;
  /** Your calendars, for the banner's names; main = Your calendar. */
  myCalendars: { id: string; name: string; main: boolean }[];
  /** "Change what … sees": the calendar whose share menu to open. */
  shareOpen: string | null;
  /** "Find a time with …": the composer's opening text and the teammates it names. */
  composerSeed: { text: string; ids: string[] } | null;
};

let state: TeammatesState = {
  teammates: [],
  blocks: [],
  shown: [],
  named: [],
  previewAs: null,
  myCalendars: [],
  shareOpen: null,
  composerSeed: null,
};
const listeners = new Set<() => void>();

export function setTeammates(patch: Partial<TeammatesState>): void {
  const keys = Object.keys(patch) as (keyof TeammatesState)[];
  if (keys.every((k) => Object.is(state[k], patch[k]))) return;
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const teammatesState = (): TeammatesState => state;

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTeammatesStore<T>(pick: (s: TeammatesState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => pick(state),
    () => pick(state),
  );
}
