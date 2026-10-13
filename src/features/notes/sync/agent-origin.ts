/**
 * Agent-origin updates and their Undo (specs/notes-refresh.md NR-6, AC11).
 *
 * An MCP write reaches an open note as a Yjs update, by the live broadcast or
 * by the next pull. It is applied with an `AgentOrigin` instead of "remote",
 * so a per-session `Y.UndoManager` can track exactly those transactions: undo
 * reverts the agent's change and keeps every human edit made since. The undo
 * itself is an ordinary local edit, so the engine pushes it like typing.
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
    /** The key's display name (the meta line says "<label> edited"). */
    readonly label: string | null,
  ) {}
}

export function isAgentOrigin(origin: unknown): origin is AgentOrigin {
  return origin instanceof AgentOrigin;
}

/** Updates the sync engine and the realtime relay must NOT push back out:
 * they came from the server (or a peer) and are already stored. */
export function isForeignOrigin(origin: unknown, persistence: unknown): boolean {
  return origin === "remote" || origin === persistence || isAgentOrigin(origin);
}

export type AgentUndo = {
  canUndo: () => boolean;
  /** Revert the most recent agent change still on the stack. */
  undo: () => void;
  /** Called whenever the stack changes (an agent edit arrives or is undone). */
  subscribe: (cb: () => void) => () => void;
  /** The last agent write this session saw (label + when it landed). */
  last: () => { label: string | null; at: number } | null;
  destroy: () => void;
};

export function createAgentUndo(doc: Y.Doc): AgentUndo {
  const root = doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  // captureTimeout 0: each agent write is its own undo step, never merged
  // with the one before it.
  const manager = new Y.UndoManager(root, {
    trackedOrigins: new Set<unknown>([AgentOrigin]),
    captureTimeout: 0,
  });
  const listeners = new Set<() => void>();
  let last: { label: string | null; at: number } | null = null;
  const notify = () => {
    for (const cb of listeners) cb();
  };
  const onAdded = (event: { origin: unknown; type: "undo" | "redo" }) => {
    if (event.type === "undo" && isAgentOrigin(event.origin)) {
      last = { label: event.origin.label, at: Date.now() };
    }
    notify();
  };
  const onPopped = () => notify();
  manager.on("stack-item-added", onAdded);
  manager.on("stack-item-popped", onPopped);
  return {
    canUndo: () => manager.undoStack.length > 0,
    undo: () => {
      manager.undo();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    last: () => last,
    destroy: () => {
      listeners.clear();
      manager.off("stack-item-added", onAdded);
      manager.off("stack-item-popped", onPopped);
      manager.destroy();
    },
  };
}
