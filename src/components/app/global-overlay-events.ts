// Mutual exclusion for the app's global command surfaces (the ⌘K search palette
// and the ⌘⇧K capture bar). Both are Radix Dialog roots; without this, opening
// one while the other is open stacks two overlays + two focus scopes and Esc
// only dismisses the top one. Each surface announces when it opens and closes
// itself when a *different* surface announces — loop-free, since closing sets
// open=false and never re-announces. DF-20.

const OVERLAY_OPEN_EVENT = "moduo:overlay:open";

/** Announce that the overlay `id` just opened (others close themselves). */
export function announceOverlayOpen(id: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OVERLAY_OPEN_EVENT, { detail: { id } }));
}

/** Run `close` when a global overlay OTHER than `id` announces it opened. */
export function onOtherOverlayOpen(id: string, close: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const openedId = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (openedId && openedId !== id) close();
  };
  window.addEventListener(OVERLAY_OPEN_EVENT, handler);
  return () => window.removeEventListener(OVERLAY_OPEN_EVENT, handler);
}
