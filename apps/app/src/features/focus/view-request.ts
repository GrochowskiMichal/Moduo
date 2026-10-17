// The chrome chip's "take me to Focus" request (DF-11). A one-shot flag covers
// a /tasks that isn't mounted yet (consumed on mount); a window event covers an
// already-mounted one. Both consume the flag, so a stranded flag can't force
// Focus on a later, unrelated /tasks visit.

export const FOCUS_VIEW_REQUEST_EVENT = "moduo:tasks:focus-view";

let focusViewRequested = false;

/** Chip → "open Focus". */
export function requestFocusView(): void {
  focusViewRequested = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FOCUS_VIEW_REQUEST_EVENT));
  }
}

/** Read-and-clear the one-shot "open Focus" flag. */
export function consumeFocusViewRequest(): boolean {
  const requested = focusViewRequested;
  focusViewRequested = false;
  return requested;
}
