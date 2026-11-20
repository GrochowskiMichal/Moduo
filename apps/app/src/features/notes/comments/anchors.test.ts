import {
  createBindingV2__EXPERIMENTAL,
  syncLexicalUpdateToYjsV2__EXPERIMENTAL,
  syncYjsStateToLexicalV2__EXPERIMENTAL,
} from "@lexical/yjs";
import { describe, expect, it } from "@rstest/core";
import {
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import type { SpineComment } from "@/lib/runtime.types";

import { createNotesHeadlessEditor, deriveNoteBody, NOTES_DOC_ROOT } from "../editor/doc-markdown";
import { buildDocStateFromMarkdown } from "../editor/materialize";
import { ADD_COMMENT_COMMAND, registerAddComment } from "../editor/plugins/comment-marks-plugin";
import { decodeBase64ToUint8 } from "../utils/base64";
import { anchorStore } from "./anchor-store";
import {
  $anchorIdsInOrder,
  $anchorSelection,
  $firstMarkKey,
  $firstMarkKeys,
  $unanchor,
  groupThreads,
} from "./anchors";

function bind(doc: Y.Doc): LexicalEditor {
  const { editor } = createNotesHeadlessEditor("anchors");
  const provider = {
    awareness: new Awareness(doc),
    connect() {},
    disconnect() {},
    on() {},
    off() {},
  } as any;
  const binding = createBindingV2__EXPERIMENTAL(editor, "n", doc, new Map([["n", doc]]));
  syncYjsStateToLexicalV2__EXPERIMENTAL(binding, provider);
  editor.registerUpdateListener((p) => {
    syncLexicalUpdateToYjsV2__EXPERIMENTAL(
      binding,
      provider,
      p.prevEditorState,
      p.editorState,
      p.dirtyElements,
      p.dirtyLeaves,
      p.normalizedNodes,
      p.tags,
    );
  });
  return editor;
}

function docFrom(md: string, clientID: number, base?: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(doc, base ?? decodeBase64ToUint8(buildDocStateFromMarkdown("a", md)!.docStateB64));
  return doc;
}

/** Select `word` inside block `block` and anchor thread `id` to it. */
function anchorWord(editor: LexicalEditor, block: number, word: string, id: string): boolean {
  let ok = false;
  editor.update(
    () => {
      const el = $getRoot().getChildAtIndex(block);
      const text = $isElementNode(el)
        ? (el.getAllTextNodes().find((t) => t.getTextContent().includes(word)) ?? null)
        : null;
      if (!$isTextNode(text)) return;
      const at = text.getTextContent().indexOf(word);
      const sel = $createRangeSelection();
      sel.anchor.set(text.getKey(), at, "text");
      sel.focus.set(text.getKey(), at + word.length, "text");
      $setSelection(sel);
      ok = $anchorSelection(sel, id);
    },
    { discrete: true },
  );
  return ok;
}

const ids = (editor: LexicalEditor) => editor.getEditorState().read(() => $anchorIdsInOrder());

function comment(
  id: string,
  anchorId: string | null,
  at: string,
  resolvedAt: string | null = null,
) {
  return {
    id,
    workspaceId: "w",
    entityType: "note",
    entityId: "n",
    body: id,
    createdBy: "u",
    authorKind: "user",
    authorLabel: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    editedAt: null,
    reactions: [],
    anchorId,
    resolvedAt,
  } as SpineComment;
}

describe("anchor lifecycle", () => {
  it("mark ids map to threads, a deleted anchor detaches, and resolve unmarks", () => {
    const doc = docFrom("Alpha beta gamma\n\nSecond line here", 1);
    const editor = bind(doc);

    // Two threads, anchored out of creation order: the panel follows the doc.
    expect(anchorWord(editor, 1, "Second", "t2")).toBe(true);
    expect(anchorWord(editor, 0, "beta", "t1")).toBe(true);
    expect(ids(editor)).toEqual(["t1", "t2"]);

    // The marks live in the CRDT: a peer sees them, the markdown keeps only text.
    const peerDoc = docFrom("", 2, Y.encodeStateAsUpdate(doc));
    expect(ids(bind(peerDoc))).toEqual(["t1", "t2"]);
    expect(deriveNoteBody(doc).md).toBe("Alpha beta gamma\n\nSecond line here");

    const comments = [
      comment("c-t2", "t2", "2026-10-16T10:00:00Z"),
      comment("c-t1", "t1", "2026-10-16T10:01:00Z"),
      comment("c-t1b", "t1", "2026-10-16T10:02:00Z"),
      comment("c-note", null, "2026-10-16T09:00:00Z"),
    ];
    let g = groupThreads(comments, ids(editor));
    expect(g.open.map((t) => t.anchorId)).toEqual(["t1", "t2"]);
    expect(g.open[0].comments.map((c) => c.id)).toEqual(["c-t1", "c-t1b"]);
    expect(g.noteLevel.map((c) => c.id)).toEqual(["c-note"]);
    expect(g.detached).toEqual([]);

    // Deleting the anchored text moves its thread to Detached, still readable.
    editor.update(() => $getRoot().getChildAtIndex(1)?.remove(), { discrete: true });
    g = groupThreads(comments, ids(editor));
    expect(g.open.map((t) => t.anchorId)).toEqual(["t1"]);
    expect(g.detached.map((t) => t.anchorId)).toEqual(["t2"]);
    expect(g.detached[0].comments.map((c) => c.id)).toEqual(["c-t2"]);

    // Resolve unmarks: the highlight goes, the text stays.
    editor.update(() => $unanchor("t1"), { discrete: true });
    expect(ids(editor)).toEqual([]);
    expect(deriveNoteBody(doc).md).toBe("Alpha beta gamma");
    const resolved = comments.map((c) =>
      c.anchorId === "t1" ? { ...c, resolvedAt: "2026-10-16T11:00:00Z" } : c,
    );
    g = groupThreads(resolved, ids(editor));
    expect(g.resolved.map((t) => t.anchorId)).toEqual(["t1"]);
    expect(g.open).toEqual([]);
  });

  it("finds every thread's first mark in one walk, the same as one at a time", () => {
    const doc = docFrom("Alpha beta gamma\n\nSecond line here", 1);
    const editor = bind(doc);
    anchorWord(editor, 0, "beta", "t1");
    anchorWord(editor, 1, "line", "t2");
    editor.getEditorState().read(() => {
      const all = $firstMarkKeys();
      expect([...all.keys()]).toEqual(["t1", "t2"]);
      expect(all.get("t1")).toBe($firstMarkKey("t1"));
      expect(all.get("t2")).toBe($firstMarkKey("t2"));
    });
  });

  it("overlapping threads keep each other when one is resolved", () => {
    const editor = bind(docFrom("one two three", 3));
    anchorWord(editor, 0, "one two", "a");
    anchorWord(editor, 0, "two", "b");
    expect(ids(editor).sort()).toEqual(["a", "b"]);
    editor.update(() => $unanchor("a"), { discrete: true });
    expect(ids(editor)).toEqual(["b"]);
  });

  it("a collapsed or blank selection anchors nothing", () => {
    const editor = bind(docFrom("hello", 4));
    expect(anchorWord(editor, 0, "", "x")).toBe(false);
    expect(ids(editor)).toEqual([]);
  });

  it("without an open editor no thread counts as detached", () => {
    const g = groupThreads([comment("c", "gone", "2026-10-16T10:00:00Z")], null);
    expect(g.open.map((t) => t.anchorId)).toEqual(["gone"]);
    expect(g.detached).toEqual([]);
  });

  it("the Comment command anchors the selection, opens the composer, and drops an unposted draft", () => {
    const editor = bind(docFrom("Alpha beta gamma", 5));
    let opened = 0;
    registerAddComment(editor, "note-cmd", true, () => {
      opened += 1;
    });
    const select = (word: string) =>
      editor.update(
        () => {
          const text = $getRoot()
            .getAllTextNodes()
            .find((t) => t.getTextContent().includes(word))!;
          const at = text.getTextContent().indexOf(word);
          const sel = $createRangeSelection();
          sel.anchor.set(text.getKey(), at, "text");
          sel.focus.set(text.getKey(), at + word.length, "text");
          $setSelection(sel);
        },
        { discrete: true },
      );

    select("beta");
    expect(editor.dispatchCommand(ADD_COMMENT_COMMAND, undefined)).toBe(true);
    editor.update(() => {}, { discrete: true }); // commit the command's update
    const first = anchorStore.get("note-cmd").pending;
    expect(first).toBeTruthy();
    expect(ids(editor)).toEqual([first]);
    expect(anchorStore.get("note-cmd").focused).toBe(first);
    expect(opened).toBe(1);

    // A second Comment before posting replaces the draft's mark.
    select("gamma");
    expect(editor.dispatchCommand(ADD_COMMENT_COMMAND, undefined)).toBe(true);
    editor.update(() => {}, { discrete: true }); // commit the command's update
    const second = anchorStore.get("note-cmd").pending;
    expect(second).not.toBe(first);
    expect(ids(editor)).toEqual([second]);
  });

  it("a read-only editor never anchors", () => {
    const editor = bind(docFrom("Alpha", 6));
    registerAddComment(editor, "note-ro", false, () => {});
    expect(editor.dispatchCommand(ADD_COMMENT_COMMAND, undefined)).toBe(false);
    expect(ids(editor)).toEqual([]);
  });
});
