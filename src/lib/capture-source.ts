// "The thing you're looking at rides along" (tasks-v3 call 93, AC5.4; TV-U14).
//
// A page with an email, note, event or contact open says so here; the capture
// reads it when it opens and shows a removable "From: …" chip that becomes a
// link when the task is created (linked by default, ⌘⇧K included: the agent's
// choice, deferred to by Maciej). Same shape as `create-events.ts`: no React
// state crosses modules, just one current value.

import { useEffect } from "react";

import type { EntityRef } from "./entity-links";

export type CaptureSourceKind = "email" | "note" | "event" | "contact";

export type CaptureSource = {
  kind: CaptureSourceKind;
  /** What the chip reads after "From:" (a subject, a title, a name). */
  label: string;
  /** The item, when it's already in the registry. */
  ref?: EntityRef;
  /**
   * Makes the item linkable when it isn't yet (an email thread joins the
   * registry on first link). Called once, on create, only if the chip is kept.
   */
  resolve?: () => Promise<EntityRef | null>;
};

let current: { owner: symbol; source: CaptureSource } | null = null;

/** Say what's open (or nothing). `owner` keeps one page from clearing another's. */
export function setCaptureSource(owner: symbol, source: CaptureSource | null): void {
  if (source) current = { owner, source };
  else if (current?.owner === owner) current = null;
}

/** What's open right now, if anything. */
export function getCaptureSource(): CaptureSource | null {
  return current?.source ?? null;
}

/**
 * A page's open item, kept current while it's mounted. Pass a stable object
 * (memoise it), or null when nothing is open.
 */
export function useCaptureSource(source: CaptureSource | null): void {
  useEffect(() => {
    const owner = Symbol("capture-source");
    setCaptureSource(owner, source);
    return () => setCaptureSource(owner, null);
  }, [source]);
}
