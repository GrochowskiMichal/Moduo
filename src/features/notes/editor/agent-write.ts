/**
 * Agent writes as real CRDT changes (specs/notes-refresh.md NR-6, AC11).
 *
 * The MCP connector used to write `body_md` only, so an edit to a note that
 * already had a Yjs doc never reached the editor, and the next keystroke
 * re-derived the body from the doc and threw the agent's text away. Now the
 * connector rebuilds the note's doc from the server log, applies the edit
 * through a headless Lexical editor bound with the SAME v2 binding, node set
 * and `NOTES_TRANSFORMERS` the live editor uses, and pushes the resulting Yjs
 * update like any other client. Open editors merge it live; closed ones pull
 * it on the next open.
 *
 * This file is the connector's whole notes-doc dependency. It runs in Deno
 * through a prebuilt bundle (`bun run build:notes-doc`, which writes
 * `supabase/functions/_shared/notes-doc/notes-doc.bundle.js`), so it must stay
 * free of React, the DOM and app runtime imports.
 */

import { $convertFromMarkdownString, $generateNodesFromMarkdownString } from "@lexical/markdown";
import {
  createBindingV2__EXPERIMENTAL,
  syncLexicalUpdateToYjsV2__EXPERIMENTAL,
  syncYjsStateToLexicalV2__EXPERIMENTAL,
} from "@lexical/yjs";
import { $getRoot, $isParagraphNode } from "lexical";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";
import {
  $noteMarkdown,
  $noteText,
  createNotesHeadlessEditor,
  deriveNoteBody,
  NOTES_DOC_ROOT,
} from "./doc-markdown";
import { NOTES_TRANSFORMERS } from "./markdown";
import { buildDocStateFromMarkdown, type MaterializedDoc } from "./materialize";

/** What an agent asked for: add to the end, or replace the whole body. */
export type AgentEdit =
  | { kind: "append"; markdown: string }
  | { kind: "replace"; markdown: string };

export type AgentWriteResult = {
  /** The Yjs update to push, base64; null when the edit changed nothing. */
  updateB64: string | null;
  /** Bodies derived from the edited doc, with the same converter clients use. */
  bodyMd: string;
  bodyText: string;
};

/**
 * Apply `edit` to `doc` in place and return the Yjs update it produced (null
 * if nothing changed) plus the derived bodies. Throws when Lexical can't load
 * the doc; callers must not fall back to a body-only write.
 */
export function applyAgentEdit(
  doc: Y.Doc,
  edit: AgentEdit,
): { update: Uint8Array | null; bodyMd: string; bodyText: string } {
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  // Only the edit's own changes: an update encoded against a state vector
  // would also carry every deletion the doc already held, and a client that
  // hadn't seen one yet would file it under the agent's Undo.
  const own: Uint8Array[] = [];
  const onUpdate = (update: Uint8Array) => {
    own.push(update);
  };

  const { editor, takeError } = createNotesHeadlessEditor("moduo-note-agent");
  const awareness = new Awareness(doc);
  const provider = {
    awareness,
    connect() {},
    disconnect() {},
    on() {},
    off() {},
  } as any;
  const binding = createBindingV2__EXPERIMENTAL(editor, "agent", doc, new Map([["agent", doc]]));
  let unregister: () => void = () => {};
  try {
    // Load the current doc into the editor first, THEN start mirroring edits
    // back: the load itself must never be written into the doc.
    syncYjsStateToLexicalV2__EXPERIMENTAL(binding, provider);
    const loadError = takeError();
    if (loadError) throw loadError;
    unregister = editor.registerUpdateListener(
      ({ prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags }) => {
        syncLexicalUpdateToYjsV2__EXPERIMENTAL(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        );
      },
    );
    doc.on("update", onUpdate);
    editor.update(
      () => {
        if (edit.kind === "replace") {
          $convertFromMarkdownString(edit.markdown, NOTES_TRANSFORMERS);
          return;
        }
        const root = $getRoot();
        // An empty doc still holds one blank paragraph after load; appending
        // below it would leave a stray empty first line.
        const only = root.getFirstChild();
        if (root.getChildrenSize() === 1 && $isParagraphNode(only) && only.isEmpty()) only.remove();
        root.append(...$generateNodesFromMarkdownString(edit.markdown, NOTES_TRANSFORMERS));
      },
      { discrete: true },
    );
    const error = takeError();
    if (error) throw error;
    const body = editor.getEditorState().read(() => ({ md: $noteMarkdown(), text: $noteText() }));
    return {
      update: own.length > 0 ? Y.mergeUpdates(own) : null,
      bodyMd: body.md,
      bodyText: body.text,
    };
  } finally {
    doc.off("update", onUpdate);
    unregister();
    awareness.destroy();
  }
}

/** Rebuild a note's doc from what the server holds (snapshot + update log).
 * A row Yjs can't decode is skipped, as the app's pull does: one poison row
 * must not block every later write to the note. */
function docFromLog(snapshotB64: string | null, updatesB64: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  for (const b64 of snapshotB64 ? [snapshotB64, ...updatesB64] : updatesB64) {
    try {
      Y.applyUpdate(doc, decodeBase64ToUint8(b64));
    } catch {
      // Skipped; clients skip it too, so nobody's doc holds it.
    }
  }
  return doc;
}

/**
 * The connector's entry point: rebuild the note's doc from the server's
 * state, apply the edit, return the update to push (the edit's own changes
 * only) and the bodies derived from the edited doc.
 *
 * A note with a body but no doc yet must be seeded first, through
 * `notes_op_seed_doc` (the once-only guard), never inside this update.
 */
export function agentWriteFromLog(input: {
  snapshotB64: string | null;
  updatesB64: string[];
  edit: AgentEdit;
}): AgentWriteResult {
  const doc = docFromLog(input.snapshotB64, input.updatesB64);
  try {
    const result = applyAgentEdit(doc, input.edit);
    return {
      updateB64: result.update ? encodeUint8ToBase64(result.update) : null,
      bodyMd: result.bodyMd,
      bodyText: result.bodyText,
    };
  } finally {
    doc.destroy();
  }
}

/** The bodies of the doc the server holds, for a re-save after a write that
 * raced another one (the write's own bodies can miss the other change). */
export function bodyFromLog(input: { snapshotB64: string | null; updatesB64: string[] }): {
  bodyMd: string;
  bodyText: string;
} {
  const doc = docFromLog(input.snapshotB64, input.updatesB64);
  try {
    const body = deriveNoteBody(doc);
    return { bodyMd: body.md, bodyText: body.text };
  } finally {
    doc.destroy();
  }
}

/** A brand-new note's doc from markdown (the connector's `notes_create`). */
export function agentCreateDoc(noteId: string, markdown: string): MaterializedDoc | null {
  return buildDocStateFromMarkdown(noteId, markdown);
}
