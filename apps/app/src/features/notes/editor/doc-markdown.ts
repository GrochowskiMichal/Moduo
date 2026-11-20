/**
 * The ONE markdown converter, applied to a note's Y.Doc (specs/notes-refresh.md
 * NR-3, assumption 3).
 *
 * `body_md` and `body_text` feed search, `.md` export, the published page and
 * the MCP connector. They used to come from `sync/doc-text.ts`, a hand-rolled
 * Yjs walker that dropped links, inline marks, in-block line breaks and tables,
 * so a note's markdown degraded the moment anyone edited it. Now the doc is
 * read back into a headless Lexical editor through the SAME v2 binding the live
 * editor uses, and serialized with the SAME `NOTES_TRANSFORMERS` that typing,
 * paste, copy and import use. One grammar, every door.
 *
 * The read happens on a CLONE of the doc: the binding never observes or writes
 * the live session's doc, and a failure here can never corrupt it.
 */

import { createHeadlessEditor } from "@lexical/headless";
import { $dfs } from "@lexical/utils";
import { createBindingV2__EXPERIMENTAL, syncYjsStateToLexicalV2__EXPERIMENTAL } from "@lexical/yjs";
import { $getRoot, type LexicalEditor } from "lexical";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { $notesMarkdown } from "./markdown";
import { NOTE_EDITOR_NODES } from "./schema/nodes";
import { $isTaskLineNode } from "./schema/task-line-node";

/** The Yjs root the live editor's v2 collab binding uses (its default, and
 * what `engine-v2` pre-registers on every session doc). */
export const NOTES_DOC_ROOT = "root-v2";

/** A headless editor configured exactly like the live one (node set only:
 * a headless editor never renders, so theme and plugins don't matter). */
export function createNotesHeadlessEditor(namespace: string): {
  editor: LexicalEditor;
  takeError: () => unknown;
} {
  let error: unknown = null;
  const editor = createHeadlessEditor({
    namespace,
    nodes: [...NOTE_EDITOR_NODES],
    onError: (e: Error) => {
      error = e;
    },
  });
  return { editor, takeError: () => error };
}

/**
 * Run `read` against the editor state a live editor would show for `doc`.
 * Throws if Lexical can't load the doc (callers decide what that means).
 */
export function readNoteDoc<T>(doc: Y.Doc, read: () => T): T {
  const clone = new Y.Doc();
  // Pre-register the typed root before the state applies (the text-loss
  // footgun when an update lands before its type is known).
  clone.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));

  const { editor, takeError } = createNotesHeadlessEditor("moduo-note-read");
  // The binding publishes cursor positions through the provider on every
  // sync; a detached Awareness keeps that path real without a transport.
  const awareness = new Awareness(clone);
  const provider = {
    awareness,
    connect() {},
    disconnect() {},
    on() {},
    off() {},
  } as any;
  try {
    const binding = createBindingV2__EXPERIMENTAL(
      editor,
      "read",
      clone,
      new Map([["read", clone]]),
    );
    syncYjsStateToLexicalV2__EXPERIMENTAL(binding, provider);
    const error = takeError();
    if (error) throw error;
    return editor.getEditorState().read(read);
  } finally {
    awareness.destroy();
    clone.destroy();
  }
}

/** Markdown for the current editor state (call inside a read or update). */
export function $noteMarkdown(): string {
  return $notesMarkdown();
}

/** The plain-text projection (call inside a read or update): what search
 * indexes and what the first-line title is cut from. Blocks are separated by
 * blank lines, chips and page rows read as their labels. */
export function $noteText(): string {
  return $getRoot()
    .getTextContent()
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Both derived bodies a push writes (`body_text`, `body_md`). */
export function deriveNoteBody(doc: Y.Doc): { text: string; md: string } {
  if (doc.getXmlElement(NOTES_DOC_ROOT).length === 0) return { text: "", md: "" };
  return readNoteDoc(doc, () => ({ text: $noteText(), md: $noteMarkdown() }));
}

/**
 * `deriveNoteBody`, but never throws: null when Lexical can't load the doc.
 * The sync engine pushes with null bodies then (the server keeps the last
 * good ones), because a derivation bug must never hold content back.
 */
export function tryDeriveNoteBody(doc: Y.Doc): { text: string; md: string } | null {
  try {
    return deriveNoteBody(doc);
  } catch (e) {
    console.warn("[notes] body derivation failed", e);
    return null;
  }
}

/** Task ids referenced by task lines in a doc — the trash flow detaches them
 * (NO-5 AC4) without needing a live editor. */
export function extractTaskLineIds(doc: Y.Doc): string[] {
  if (doc.getXmlElement(NOTES_DOC_ROOT).length === 0) return [];
  return readNoteDoc(doc, () => {
    const ids = new Set<string>();
    for (const { node } of $dfs()) {
      if (!$isTaskLineNode(node)) continue;
      const id = node.getTaskId();
      if (id) ids.add(id);
    }
    return [...ids];
  });
}
