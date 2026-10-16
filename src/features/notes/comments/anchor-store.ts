/**
 * The bridge between the open note's editor and its Comments panel (NR-8).
 * They mount apart (the panel may be closed while the editor runs), so they
 * meet here, keyed by note id:
 *
 *   - the editor publishes the thread ids anchored in its doc, in order;
 *   - the editor registers the actions only it can do (anchor the selection,
 *     unanchor a thread, scroll to one);
 *   - the panel publishes which threads are open, so only their marks are
 *     highlighted (a mark whose thread is resolved elsewhere, or that never
 *     got its first comment, reads as plain text);
 *   - either side can ask for a thread to be focused (clicking a highlight
 *     opens it in the panel; "Comment" opens the composer for a new one).
 */

import { useSyncExternalStore } from "react";

export type AnchorEditorActions = {
  /** The editor can change the doc (take a resolved thread's mark out). */
  editable: boolean;
  unanchor: (anchorId: string) => void;
  scrollTo: (anchorId: string) => void;
  /** Text under a thread's highlight (for the composer's quote). */
  textOf: (anchorId: string) => string;
};

type NoteAnchors = {
  /** null: no editor has reported this note's doc yet. */
  docOrder: string[] | null;
  /** null: not known yet, so no mark is highlighted. */
  openThreads: ReadonlySet<string> | null;
  focused: string | null;
  /** A thread anchored here whose first comment isn't posted yet. */
  pending: string | null;
};

const EMPTY: NoteAnchors = { docOrder: null, openThreads: null, focused: null, pending: null };

const state = new Map<string, NoteAnchors>();
const actions = new Map<string, AnchorEditorActions>();
const listeners = new Set<() => void>();

function patch(noteId: string, next: Partial<NoteAnchors>): void {
  const prev = state.get(noteId) ?? EMPTY;
  const merged = { ...prev, ...next };
  if (
    merged.docOrder === prev.docOrder &&
    merged.openThreads === prev.openThreads &&
    merged.focused === prev.focused &&
    merged.pending === prev.pending
  ) {
    return;
  }
  state.set(noteId, merged);
  for (const l of listeners) l();
}

function sameList(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((x, i) => x === b[i]);
}

export const anchorStore = {
  get(noteId: string): NoteAnchors {
    return state.get(noteId) ?? EMPTY;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setDocOrder(noteId: string, order: string[] | null): void {
    const prev = anchorStore.get(noteId).docOrder;
    if (order && sameList(prev, order)) return;
    patch(noteId, { docOrder: order });
  },
  setOpenThreads(noteId: string, ids: ReadonlySet<string> | null): void {
    patch(noteId, { openThreads: ids });
  },
  focus(noteId: string, anchorId: string | null): void {
    patch(noteId, { focused: anchorId });
  },
  setPending(noteId: string, anchorId: string | null): void {
    patch(noteId, { pending: anchorId });
  },
  register(noteId: string, a: AnchorEditorActions): () => void {
    actions.set(noteId, a);
    return () => {
      if (actions.get(noteId) === a) actions.delete(noteId);
    };
  },
  actions(noteId: string): AnchorEditorActions | null {
    return actions.get(noteId) ?? null;
  },
};

export function useNoteAnchors(noteId: string): NoteAnchors {
  return useSyncExternalStore(
    anchorStore.subscribe,
    () => anchorStore.get(noteId),
    () => EMPTY,
  );
}
