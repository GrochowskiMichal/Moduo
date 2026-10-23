/**
 * ⌘Z in a note is the Yjs undo manager the collaboration plugin installs: it
 * tracks only this editor's own transactions, so an undo never rolls back a
 * teammate's or an agent's text (Lexical's HistoryPlugin restored whole
 * snapshots, remote edits included). These helpers reach that manager.
 */

import type { LexicalEditor } from "lexical";
import type * as Y from "yjs";

/** Where `@lexical/react`'s collaboration plugin publishes its manager. */
const COLLAB_UNDO_MANAGER = Symbol.for("@lexical/yjs/UndoManager");

export function collabUndoManager(editor: LexicalEditor): Y.UndoManager | null {
  return (
    (editor as unknown as Record<symbol, Y.UndoManager | undefined>)[COLLAB_UNDO_MANAGER] ?? null
  );
}

/**
 * Commit `fn` without it becoming (or joining) an undo step: a task id stamped
 * onto a line the user just inserted, or a remote task state reconciled into
 * the doc. The update is discrete so the binding writes it to Yjs while the
 * capture is off.
 */
export function updateWithoutUndo(editor: LexicalEditor, fn: () => void, tag?: string): void {
  const manager = collabUndoManager(editor);
  if (!manager) {
    editor.update(fn, { tag, discrete: true });
    return;
  }
  const capture = manager.captureTransaction;
  manager.captureTransaction = () => false;
  try {
    editor.update(fn, { tag, discrete: true });
  } finally {
    manager.captureTransaction = capture;
  }
}

/** Let ⌘Z undo transactions written straight to the doc under `origin`. */
export function trackUndoOrigin(editor: LexicalEditor, origin: unknown): void {
  const manager = collabUndoManager(editor);
  if (!manager) return;
  manager.trackedOrigins.add(origin);
  // A block move is one step of its own, never merged with the typing before.
  manager.stopCapturing();
}
