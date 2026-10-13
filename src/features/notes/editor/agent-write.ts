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
import { $getRoot } from "lexical";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";
import {
  $noteMarkdown,
  $noteText,
  createNotesHeadlessEditor,
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
  const before = Y.encodeStateVector(doc);
  let touched = false;
  const onUpdate = () => {
    touched = true;
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
        if (root.getChildrenSize() === 1 && only && only.getTextContent() === "") only.remove();
        root.append(...$generateNodesFromMarkdownString(edit.markdown, NOTES_TRANSFORMERS));
      },
      { discrete: true },
    );
    const error = takeError();
    if (error) throw error;
    const body = editor.getEditorState().read(() => ({ md: $noteMarkdown(), text: $noteText() }));
    return {
      update: touched ? Y.encodeStateAsUpdate(doc, before) : null,
      bodyMd: body.md,
      bodyText: body.text,
    };
  } finally {
    doc.off("update", onUpdate);
    unregister();
    awareness.destroy();
  }
}

/**
 * The connector's entry point: rebuild the note's doc from what the server
 * holds (snapshot + update log), apply the edit, return the update to push.
 *
 * A note that has a body but no doc yet (created or imported before it was
 * ever opened) is first materialized from that body with the deterministic
 * per-note builder, the same bytes the app's blank-note sweep would write, so
 * a concurrent sweep merges instead of duplicating the text.
 */
export function agentWriteFromLog(input: {
  noteId: string;
  snapshotB64: string | null;
  updatesB64: string[];
  /** The note's current `body_md`, used only when it has no doc yet. */
  bodyMd: string;
  edit: AgentEdit;
}): AgentWriteResult {
  const doc = new Y.Doc();
  try {
    doc.get(NOTES_DOC_ROOT, Y.XmlElement);
    if (input.snapshotB64) Y.applyUpdate(doc, decodeBase64ToUint8(input.snapshotB64));
    for (const b64 of input.updatesB64) Y.applyUpdate(doc, decodeBase64ToUint8(b64));
    const before = Y.encodeStateVector(doc);
    if (doc.getXmlElement(NOTES_DOC_ROOT).length === 0 && input.bodyMd.trim()) {
      const seeded = buildDocStateFromMarkdown(input.noteId, input.bodyMd);
      if (seeded) Y.applyUpdate(doc, decodeBase64ToUint8(seeded.docStateB64));
    }
    const result = applyAgentEdit(doc, input.edit);
    const sinceServer = Y.encodeStateAsUpdate(doc, before);
    // Push everything new since the server's state: the seed (if any) and
    // the edit travel as one update.
    const changed = result.update !== null;
    return {
      updateB64: changed ? encodeUint8ToBase64(sinceServer) : null,
      bodyMd: result.bodyMd,
      bodyText: result.bodyText,
    };
  } finally {
    doc.destroy();
  }
}

/** A brand-new note's doc from markdown (the connector's `notes_create`). */
export function agentCreateDoc(noteId: string, markdown: string): MaterializedDoc | null {
  return buildDocStateFromMarkdown(noteId, markdown);
}
