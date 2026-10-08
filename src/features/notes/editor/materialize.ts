/**
 * Headless markdown → Yjs materializer (NOTE-FIX-1).
 *
 * NO-8's import wrote `body_md`/`body_text` and left `doc_state` EMPTY, relying
 * on a session-scoped in-memory map to seed the CRDT the first time the note was
 * opened *that session*. Reload, or open on another device, and the note
 * rendered blank — the single worst dogfooding bug (the content was never lost,
 * it just wasn't in the doc the editor reads).
 *
 * This builds the same doc the live editor would build, off-screen: a headless
 * Lexical editor bound to a throwaway Y.Doc through the SAME experimental v2
 * binding + `root-v2` root the live `CollaborationPluginV2__EXPERIMENTAL` uses,
 * fed the SAME `NOTES_TRANSFORMERS`. Output is a base64 `doc_state` snapshot the
 * import writes directly, so a note renders everywhere, forever, with no seeding.
 *
 * DETERMINISM IS DEFENCE-IN-DEPTH. The Y.Doc's `clientID` is derived from the
 * note id rather than random, so two devices materializing the same note
 * produce BYTE-IDENTICAL updates: Yjs dedupes structs by `(clientID, clock)`,
 * so applying both is a no-op instead of a merge that duplicates the content.
 *
 * That only holds for two devices on the SAME bundle — the node set, the
 * transformer list and the Lexical version all feed the serialization, so
 * different app versions can produce different bytes. The real guarantee is
 * the once-only server guard in `notes_op_seed_doc`: whatever the bytes, only
 * the FIRST writer's snapshot is ever stored, and everyone else pulls it.
 */

import { createHeadlessEditor } from "@lexical/headless";
import { $convertFromMarkdownString } from "@lexical/markdown";
import {
  createBindingV2__EXPERIMENTAL,
  syncLexicalUpdateToYjsV2__EXPERIMENTAL,
} from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { deriveBody } from "../sync/doc-text";
import { encodeUint8ToBase64 } from "../utils/base64";
import { NOTES_TRANSFORMERS } from "./markdown";
import { NOTE_EDITOR_NODES } from "./note-nodes";

/** The Yjs root the live editor's v2 collab binding uses (its default, and what
 * `engine-v2` pre-registers on every session doc). */
export const NOTES_DOC_ROOT = "root-v2";

/** A note's materialization identity: a stable uint32 from its id (FNV-1a).
 * Same note → same clientID on every device and every run, which is what makes
 * two independent builds byte-identical. */
export function seedClientId(noteId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < noteId.length; i++) {
    h ^= noteId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Yjs clientIDs are uint32.
  return h >>> 0;
}

export type MaterializedDoc = {
  /** base64 `Y.encodeStateAsUpdate` — goes straight into `notes.doc_state`. */
  docStateB64: string;
  /** Derived bodies from the SAME walker the sync engine uses on every push,
   * so the stored body can't drift from the doc that now backs it. */
  bodyText: string;
  bodyMd: string;
};

/**
 * Build a note's CRDT doc from its markdown. Returns null when there is nothing
 * to materialize (blank markdown), so callers can skip the write entirely.
 *
 * Throws only if Lexical itself fails to parse — callers treat that as "leave
 * this note alone", never as data loss (`body_md` remains the source of truth).
 */
export function buildDocStateFromMarkdown(
  noteId: string,
  markdown: string,
): MaterializedDoc | null {
  if (!markdown.trim()) return null;

  const doc = new Y.Doc();
  // Deterministic identity BEFORE any content — the clock starts at 0 either
  // way, but the struct ids are (clientID, clock), so this must be set first.
  doc.clientID = seedClientId(noteId);
  // Pre-register the typed root exactly as engine-v2 does (the known
  // text-loss footgun when an update applies before the type is known).
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);

  let error: unknown = null;
  const editor = createHeadlessEditor({
    namespace: `moduo-note-${noteId}`,
    nodes: [...NOTE_EDITOR_NODES],
    onError: (e: Error) => {
      error = e;
    },
  });

  const docMap = new Map<string, Y.Doc>([[noteId, doc]]);
  const binding = createBindingV2__EXPERIMENTAL(editor, noteId, doc, docMap);
  // The binding only reaches `provider` to publish the local selection into
  // awareness; a detached Awareness keeps that path real without a transport.
  const awareness = new Awareness(doc);
  const provider = {
    awareness,
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as any;

  const unregister = editor.registerUpdateListener(
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

  // `doc.destroy()` must run on EVERY exit — a note whose markdown reliably
  // throws is retried on each sweep, so leaking one Y.Doc per attempt adds up.
  let result: MaterializedDoc | null = null;
  try {
    // `discrete` forces the update to commit synchronously — a headless editor
    // has no host to flush a deferred one, so without it the listener above
    // never runs and the doc comes back empty.
    editor.update(
      () => {
        $convertFromMarkdownString(markdown, NOTES_TRANSFORMERS);
      },
      { discrete: true },
    );

    if (error) throw error;

    const root = doc.getXmlElement(NOTES_DOC_ROOT);
    if (root.toArray().length > 0) {
      const body = deriveBody(doc);
      result = {
        docStateB64: encodeUint8ToBase64(Y.encodeStateAsUpdate(doc)),
        bodyText: body.text,
        bodyMd: body.md,
      };
    }
  } finally {
    unregister();
    awareness.destroy();
    doc.destroy();
  }

  return result;
}
