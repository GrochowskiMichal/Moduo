/**
 * ⌘Z in a note is the Yjs undo manager the collaboration plugin installs: it
 * tracks only this editor's own transactions, so an undo never rolls back a
 * teammate's or an agent's text (Lexical's HistoryPlugin restored whole
 * snapshots, remote edits included). These helpers reach that manager.
 */

import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
} from "lexical";
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

/**
 * Run a write made straight to the doc under `origin` (a block move) as one
 * ⌘Z step of its own: tracked, and merged with neither the typing before it
 * nor the typing right after.
 */
export function asUndoStep<T>(editor: LexicalEditor, origin: unknown, write: () => T): T {
  const manager = collabUndoManager(editor);
  manager?.trackedOrigins.add(origin);
  manager?.stopCapturing();
  try {
    return write();
  } finally {
    manager?.stopCapturing();
  }
}

const quietManagers = new WeakMap<Y.UndoManager, { quiet: boolean }>();

/** Wrap a manager's capture once, so a quiet window can keep writes out. */
function quietSwitch(manager: Y.UndoManager): { quiet: boolean } {
  let state = quietManagers.get(manager);
  if (state) return state;
  const s = { quiet: false };
  const capture = manager.captureTransaction;
  manager.captureTransaction = (tr) => !s.quiet && capture(tr);
  quietManagers.set(manager, s);
  state = s;
  return state;
}

/**
 * ⌘Z / ⇧⌘Z as a writer expects:
 *
 * - every line is its own step: Enter, or moving the caret to another block,
 *   closes the step (the Yjs manager merged everything typed within half a
 *   second, so the title and the first paragraph undid together);
 * - redo survives an undo: the editor's own follow-up write after one (an
 *   emptied note gets its empty paragraph back) is kept out of the history,
 *   or the manager read it as a new edit and threw the redo steps away.
 */
export function registerCollabUndo(editor: LexicalEditor): () => void {
  let lastBlock: string | null = null;
  const run = (which: "undo" | "redo") => {
    const manager = collabUndoManager(editor);
    if (!manager) return false;
    const state = quietSwitch(manager);
    if (which === "undo") manager.undo();
    else manager.redo();
    state.quiet = true;
    // The binding applies the step, then Lexical normalizes it in the
    // following updates: two frames cover both.
    requestAnimationFrame(() => requestAnimationFrame(() => (state.quiet = false)));
    manager.stopCapturing();
    return true;
  };
  return mergeRegister(
    editor.registerCommand(UNDO_COMMAND, () => run("undo"), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(REDO_COMMAND, () => run("redo"), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        collabUndoManager(editor)?.stopCapturing();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const block = editor.getEditorState().read(() => {
          const selection = $getSelection();
          return $isRangeSelection(selection)
            ? (selection.anchor.getNode().getTopLevelElement()?.getKey() ?? null)
            : null;
        });
        if (block !== lastBlock) {
          lastBlock = block;
          collabUndoManager(editor)?.stopCapturing();
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    ),
  );
}
