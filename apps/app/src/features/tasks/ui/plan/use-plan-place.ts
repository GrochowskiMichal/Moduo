// The place open in the centre (DF-1): the address bar's `?place=` is its only
// source. `resolveEntryPlace` reads it (and, without one, where you left
// Tasks) at render, so every effect in a flush sees the same place; a pick
// writes the address bar (replace) and shows at once, before the router has
// committed the write.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { remembersPlace, resolveEntryPlace } from "../../default-view";

// Per-workspace view memory on this device (`moduo:tasks:<part>:<ws>`).
function lsKey(workspaceId: string, part: string): string {
  return `moduo:tasks:${part}:${workspaceId}`;
}
function readLS(workspaceId: string, part: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(lsKey(workspaceId, part));
  } catch {
    return null;
  }
}
function writeLS(workspaceId: string, part: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lsKey(workspaceId, part), value);
  } catch {
    /* ignore */
  }
}

/** What the page opened with in a workspace: read once, never re-read. */
type Entry = {
  workspaceId: string;
  lastBucket: string | null;
  legacyMode: boolean;
  /** The address bar's place on arrival; undefined once it changed. */
  url: string | null | undefined;
};

function readEntry(workspaceId: string, url: string | null): Entry {
  return {
    workspaceId,
    lastBucket: readLS(workspaceId, "lastBucket"),
    legacyMode: readLS(workspaceId, "mode") === "execute",
    url,
  };
}

export type PlanPlaceInput = {
  workspaceId: string;
  /** `?place=`, validated (search.ts). */
  urlPlace: string | null;
  /** Writes `?place=` (replace). */
  onUrlPlaceChange: (place: string) => void;
  inboxId: string | null;
  bucketIds: readonly string[];
  archivedBucketIds: readonly string[];
  viewSelections: readonly string[];
  firstView: string | null;
  loaded: boolean;
  reachedServer: boolean;
  /**
   * An inbound deep link owns the entry place (DF-1): the default isn't
   * written over it while it waits to be applied.
   */
  holdDefault: boolean;
};

export function usePlanPlace(input: PlanPlaceInput): {
  place: string;
  setPlace: (place: string) => void;
} {
  const { workspaceId, urlPlace, onUrlPlaceChange, loaded } = input;
  const [entry, setEntry] = useState(() => readEntry(workspaceId, urlPlace));
  // A pick the router hasn't committed yet: shown until the address bar moves
  // off the place it held when the pick was made (to the pick, or elsewhere).
  const [pending, setPending] = useState<{ value: string; base: string | null } | null>(null);

  // Render-time resets (no effect between them and the place they decide).
  let current = entry;
  if (entry.workspaceId !== workspaceId) {
    current = readEntry(workspaceId, urlPlace);
    setEntry(current);
  } else if (entry.url !== undefined && entry.url !== urlPlace) {
    current = { ...entry, url: undefined };
    setEntry(current);
  }
  let shown = pending;
  if (pending && urlPlace !== pending.base) {
    shown = null;
    setPending(null);
  }

  const url = shown ? shown.value : urlPlace;
  const place = resolveEntryPlace({
    url,
    reopening: !shown && current.url !== undefined,
    lastBucket: current.lastBucket,
    legacyMode: current.legacyMode,
    firstView: input.firstView,
    inboxId: input.inboxId,
    bucketIds: input.bucketIds,
    archivedBucketIds: input.archivedBucketIds,
    viewSelections: input.viewSelections,
    loaded,
    reachedServer: input.reachedServer,
  });

  // Stable, so the places that open a place (the rail, `?view=`, Focus's
  // request) don't re-run on each write; it reads the address bar as of the
  // last commit.
  const latest = useRef({ shown, urlPlace, onUrlPlaceChange });
  useLayoutEffect(() => {
    latest.current = { shown, urlPlace, onUrlPlaceChange };
  });
  const setPlace = useCallback((next: string) => {
    const { shown: now, urlPlace: inUrl, onUrlPlaceChange: write } = latest.current;
    if (next === (now ? now.value : inUrl)) return;
    const base = inUrl;
    setPending(next === base ? null : { value: next, base });
    latest.current = { ...latest.current, shown: next === base ? null : { value: next, base } };
    write(next);
  }, []);

  // The address bar names the place once it's settled: where Tasks opened, a
  // place that was gone, a view that turned out not to exist.
  useEffect(() => {
    if (!loaded || input.holdDefault) return;
    if (place !== url) setPlace(place);
  }, [loaded, input.holdDefault, place, url, setPlace]);

  // Remember where you were, so the next open lands back on it (REPLAN 30);
  // a place you only pass through isn't remembered (`remembersPlace`).
  const { archivedBucketIds } = input;
  useEffect(() => {
    if (!loaded || !remembersPlace(place, archivedBucketIds)) return;
    writeLS(workspaceId, "lastBucket", place);
  }, [loaded, workspaceId, place, archivedBucketIds]);

  return { place, setPlace };
}
