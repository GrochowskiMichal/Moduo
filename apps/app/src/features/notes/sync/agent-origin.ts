/**
 * Agent-origin updates and their Undo (specs/notes-refresh.md NR-6, AC11).
 *
 * An MCP write is stored as an `api_key` row in `note_updates`. A session
 * learns of it by pulling (the live channel only carries a cue to pull, never
 * the bytes, so nobody can pass their own edit off as an agent's), and
 * applies those rows with an `AgentOrigin` instead of "remote". A per-session
 * `Y.UndoManager` tracks exactly those transactions; the undo itself is an
 * ordinary local edit, so the engine pushes it like typing.
 *
 * What Undo promises, and how it stays safe:
 * - It reverts the most recent agent write only. Older agent steps are
 *   dropped from the stack, so one click can never reach past the write the
 *   header names.
 * - Text typed elsewhere in the note is kept. Text typed INSIDE a block the
 *   agent added goes with that block (Yjs undoes the block as a whole).
 * - The moment anyone else's change arrives (another person, another device,
 *   another tab, including their own Undo of this write), the stack is
 *   cleared. Yjs records "already undone" locally only, so a second Undo of
 *   the same write elsewhere would restore replaced text twice.
 *
 * Yjs matches tracked origins by identity OR by constructor, which is why
 * this is a class: one `AgentOrigin` entry in `trackedOrigins` covers every
 * key's writes.
 */

import * as Y from "yjs";

import { NOTES_DOC_ROOT } from "../editor/doc-markdown";

export class AgentOrigin {
  constructor(
    /** The API key that wrote it, when known. */
    readonly keyId: string | null,
  ) {}
}

export function isAgentOrigin(origin: unknown): origin is AgentOrigin {
  return origin instanceof AgentOrigin;
}

/** Updates the sync engine must NOT push back out:
 * they came from the server (or a peer) and are already stored. */
export function isForeignOrigin(origin: unknown, persistence: unknown): boolean {
  return origin === "remote" || origin === persistence || isAgentOrigin(origin);
}

export type AgentUndo = {
  canUndo: () => boolean;
  /** Revert the most recent agent write (the only step kept). */
  undo: () => void;
  /** Called whenever Undo becomes available or goes away. */
  subscribe: (cb: () => void) => () => void;
  destroy: () => void;
};

export function createAgentUndo(doc: Y.Doc): AgentUndo {
  const root = doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  // captureTimeout 0: each agent write is its own step, never merged with
  // the one before it.
  const manager = new Y.UndoManager(root, {
    trackedOrigins: new Set<unknown>([AgentOrigin]),
    captureTimeout: 0,
  });
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of listeners) cb();
  };
  const onAdded = (event: { type: "undo" | "redo" }) => {
    if (event.type === "undo") {
      // Keep only the newest agent write.
      manager.undoStack.splice(0, manager.undoStack.length - 1);
    }
    notify();
  };
  const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== "remote" || manager.undoStack.length === 0) return;
    manager.clear(true, true);
    notify();
  };
  manager.on("stack-item-added", onAdded);
  doc.on("update", onDocUpdate);
  return {
    canUndo: () => manager.undoStack.length > 0,
    undo: () => {
      manager.undo();
      // No redo: the header offers Undo once, and a stale redo step could
      // re-apply text someone else has since changed.
      manager.clear(true, true);
      notify();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {
      listeners.clear();
      manager.off("stack-item-added", onAdded);
      doc.off("update", onDocUpdate);
      manager.destroy();
    },
  };
}
