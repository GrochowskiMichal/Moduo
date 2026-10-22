import {
  createBindingV2__EXPERIMENTAL,
  syncLexicalUpdateToYjsV2__EXPERIMENTAL,
  syncYjsStateToLexicalV2__EXPERIMENTAL,
} from "@lexical/yjs";
import { describe, expect, it } from "@rstest/core";
import { $getRoot, $isElementNode, $isTextNode, type LexicalEditor } from "lexical";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { decodeBase64ToUint8 } from "../utils/base64";
import { moveBlockInDoc, stepTarget } from "./block-move";
import { createNotesHeadlessEditor, deriveNoteBody, NOTES_DOC_ROOT } from "./doc-markdown";
import { buildDocStateFromMarkdown } from "./materialize";

/** A headless editor bound to `doc` with the live binding: edits write Yjs. */
function bind(doc: Y.Doc): LexicalEditor {
  const { editor } = createNotesHeadlessEditor("block-move");
  const provider = {
    awareness: new Awareness(doc),
    connect() {},
    disconnect() {},
    on() {},
    off() {},
  } as any;
  const binding = createBindingV2__EXPERIMENTAL(editor, "n", doc, new Map([["n", doc]]));
  syncYjsStateToLexicalV2__EXPERIMENTAL(binding, provider);
  editor.registerUpdateListener(
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
  return editor;
}

function peerOf(base: Uint8Array, clientID: number): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(doc, base);
  return doc;
}

const BASE_MD = "Alpha\n\nBravo\n\nCharlie";

describe("move under merge", () => {
  for (const direction of ["up", "down"] as const) {
    it(`moving a block ${direction} keeps a peer's concurrent text inside it`, () => {
      const base = decodeBase64ToUint8(buildDocStateFromMarkdown("bm", BASE_MD)!.docStateB64);
      const mover = peerOf(base, 101);
      const writer = peerOf(base, 202);
      bind(mover);
      const writerEditor = bind(writer);

      expect(moveBlockInDoc(mover, 1, stepTarget(1, direction, 3)!)).toBe(true);
      writerEditor.update(
        () => {
          const block = $getRoot().getChildAtIndex(1)!;
          const text = $isElementNode(block) ? block.getFirstChild() : null;
          if ($isTextNode(text)) text.setTextContent("Bravo two");
        },
        { discrete: true },
      );

      Y.applyUpdate(mover, Y.encodeStateAsUpdate(writer));
      Y.applyUpdate(writer, Y.encodeStateAsUpdate(mover));

      const expected =
        direction === "up" ? "Bravo two\n\nAlpha\n\nCharlie" : "Alpha\n\nCharlie\n\nBravo two";
      expect(deriveNoteBody(mover).md).toBe(expected);
      expect(deriveNoteBody(writer).md).toBe(expected);
    });
  }

  it("a drag across several blocks keeps formatting and the moved block's peer text", () => {
    const md = "# One\n\n- [ ] two\n\n**Three** and [link](https://x.dev)\n\nFour";
    const base = decodeBase64ToUint8(buildDocStateFromMarkdown("bm", md)!.docStateB64);
    const mover = peerOf(base, 11);
    const writer = peerOf(base, 22);
    bind(mover);
    const writerEditor = bind(writer);
    expect(moveBlockInDoc(mover, 3, 0)).toBe(true);
    writerEditor.update(
      () => {
        const last = $getRoot().getLastChild();
        const text = $isElementNode(last) ? last.getFirstChild() : null;
        if ($isTextNode(text)) text.setTextContent("Four!");
      },
      { discrete: true },
    );
    Y.applyUpdate(mover, Y.encodeStateAsUpdate(writer));
    Y.applyUpdate(writer, Y.encodeStateAsUpdate(mover));
    const expected = "Four!\n\n# One\n\n- [ ] two\n\n**Three** and [link](https://x.dev)";
    expect(deriveNoteBody(mover).md).toBe(expected);
    expect(deriveNoteBody(writer).md).toBe(expected);
    expect(moveBlockInDoc(mover, 0, 3)).toBe(true);
    expect(deriveNoteBody(mover).md).toBe(md.replace("Four", "Four!"));
  });

  it("refuses at the edges and out of range", () => {
    expect(stepTarget(0, "up", 3)).toBeNull();
    expect(stepTarget(2, "down", 3)).toBeNull();
    const doc = peerOf(
      decodeBase64ToUint8(buildDocStateFromMarkdown("bm", BASE_MD)!.docStateB64),
      7,
    );
    expect(moveBlockInDoc(doc, 1, 1)).toBe(false);
    expect(moveBlockInDoc(doc, 0, 5)).toBe(false);
    expect(deriveNoteBody(doc).md).toBe(BASE_MD);
  });
});
