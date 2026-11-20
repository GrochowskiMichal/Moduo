import { $isListItemNode, $isListNode } from "@lexical/list";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { describe, expect, it } from "@rstest/core";
import { $getRoot, type LexicalEditor } from "lexical";

import { createNotesHeadlessEditor } from "../doc-markdown";
import { NOTES_TRANSFORMERS } from "../markdown";
import { $isTaskLineNode } from "../schema/task-line-node";
import { $convertItemToPendingLine } from "./task-line-plugin";

const CHECKLIST = "- [x] Freeze\n- [x] Dry-run\n- [ ] Write\n- [ ] Record";

function editorWith(md: string): LexicalEditor {
  const { editor } = createNotesHeadlessEditor("task-line-convert");
  editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
  return editor;
}

/** The root's blocks, as "list(…)" / "task(…)" in document order. */
function shape(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((block) => {
        if ($isTaskLineNode(block)) return `task(${block.getTextContent()})`;
        if ($isListNode(block)) {
          return `list(${block
            .getChildren()
            .map((i) => i.getTextContent())
            .join(",")})`;
        }
        return block.getType();
      }),
  );
}

function convert(editor: LexicalEditor, index: number) {
  editor.update(
    () => {
      const list = $getRoot().getFirstChild();
      if (!$isListNode(list)) throw new Error("no list");
      const item = list.getChildAtIndex(index);
      if (!$isListItemNode(item)) throw new Error("no item");
      // The real gesture reads the item first, as convertChecklistItems does.
      item.getTextContent();
      $convertItemToPendingLine(item);
    },
    { discrete: true },
  );
}

describe("converting a checkbox line to a task line", () => {
  it("keeps a middle item where it was, splitting the list around it", () => {
    const editor = editorWith(CHECKLIST);
    convert(editor, 2);
    expect(shape(editor)).toEqual(["list(Freeze,Dry-run)", "task(Write)", "list(Record)"]);
  });

  it("takes the first item out from the top, leaving no empty list", () => {
    const editor = editorWith(CHECKLIST);
    convert(editor, 0);
    expect(shape(editor)).toEqual(["task(Freeze)", "list(Dry-run,Write,Record)"]);
  });

  it("takes the last item out from the bottom, and an only item leaves no list", () => {
    const editor = editorWith(CHECKLIST);
    convert(editor, 3);
    expect(shape(editor)).toEqual(["list(Freeze,Dry-run,Write)", "task(Record)"]);
    const single = editorWith("- [ ] Only");
    convert(single, 0);
    expect(shape(single)).toEqual(["task(Only)"]);
  });
});
