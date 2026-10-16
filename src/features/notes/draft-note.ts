/**
 * Lazy drafts (specs/notes-refresh.md NR-2, AC3; assumption 13).
 *
 * A new note lives only on this device, under a client-minted id held in
 * `?id=`, until its first character. Then it is created exactly once (the
 * create op, then the doc push, through the FIFO meta-outbox). Leaving it
 * untouched drops it silently: no server row, no Trash entry, no toast.
 *
 * Pure: the reducer returns the next state plus the effects the shell runs
 * (discard a local session, create the note on the server).
 */

export type Draft = {
  id: string;
  /** null = a root capture (it lands in the Inbox); set = a child of that page. */
  parentId: string | null;
  /** A root started from Pages' "+ New page": filed into Pages on create. */
  toPages?: boolean;
  /** Created with a title already (`[[Create …]]`, NR-4). Default "". */
  title?: string;
};

export type DraftEvent =
  /** ⌘N / ⌘⇧N / palette / `+`: open a fresh draft. */
  | { type: "open"; draft: Draft }
  /** The draft's document gained real content. */
  | { type: "content"; id: string }
  /** The selection moved (null = nothing open). */
  | { type: "navigate"; toId: string | null };

export type DraftEffect = { type: "discard"; id: string } | { type: "materialize"; draft: Draft };

export type DraftStep = { draft: Draft | null; effects: DraftEffect[] };

export function draftReducer(current: Draft | null, event: DraftEvent): DraftStep {
  switch (event.type) {
    case "open": {
      // A second ⌘N without typing replaces the first draft, which never
      // reached the server, so only the draft you type into persists.
      const effects: DraftEffect[] =
        current && current.id !== event.draft.id ? [{ type: "discard", id: current.id }] : [];
      return { draft: event.draft, effects };
    }
    case "content": {
      if (!current || current.id !== event.id) return { draft: current, effects: [] };
      return { draft: null, effects: [{ type: "materialize", draft: current }] };
    }
    case "navigate": {
      if (!current || current.id === event.toId) return { draft: current, effects: [] };
      return { draft: null, effects: [{ type: "discard", id: current.id }] };
    }
  }
}

/** True once a document's derived text holds anything a person typed. The
 * editor's bootstrap writes an empty paragraph into a new doc, which must not
 * count as content. */
export function hasDraftContent(text: string): boolean {
  return text.trim().length > 0;
}
