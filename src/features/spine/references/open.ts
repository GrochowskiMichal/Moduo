// Opening a reference (tasks-v3 §11, 72a): a click opens it in the right
// panel as "← item" where the page hosts a panel stack; ⌘-click (Ctrl on
// Windows) opens it full, in its own module, through the app's entity-open
// route. Pages without a stack open full on a plain click too.

import { ENTITY_OPEN_EVENT } from "../../../lib/entity-open";
import type { ReferenceRef } from "./types";

/** Open an item full, in its own module (the `moduo:entity:open` route). */
export function openReferenceFull(ref: ReferenceRef): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: ref.type, id: ref.id } }),
  );
}

/** Whether a click asks for the full item (⌘ on a Mac, Ctrl elsewhere). */
export function wantsFullOpen(event: { metaKey?: boolean; ctrlKey?: boolean }): boolean {
  return !!(event.metaKey || event.ctrlKey);
}

/** Route one click: the panel when the page has one and the click is plain, else full. */
export function openReference(
  ref: ReferenceRef,
  event: { metaKey?: boolean; ctrlKey?: boolean },
  openInPanel?: (ref: ReferenceRef) => void,
): void {
  if (openInPanel && !wantsFullOpen(event)) openInPanel(ref);
  else openReferenceFull(ref);
}
