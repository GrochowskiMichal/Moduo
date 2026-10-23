import { $convertFromMarkdownString } from "@lexical/markdown";
import { describe, expect, it } from "@rstest/core";
import { $getRoot } from "lexical";

import { $blockMenuFor, $deleteBlock, $duplicateBlock, $turnBlockInto } from "./block-actions";
import { $noteMarkdown, createNotesHeadlessEditor } from "./doc-markdown";
import { NOTES_TRANSFORMERS } from "./markdown";
import { $createTaskLineNode } from "./schema/task-line-node";

function run(md: string, edit: () => void): string {
  const { editor } = createNotesHeadlessEditor("block-actions");
  editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
  editor.update(edit, { discrete: true });
  return editor.getEditorState().read($noteMarkdown);
}

describe("block menu", () => {
  it("turns a block into a heading, a list or a quote, keeping its text", () => {
    expect(
      run("One\n\n**Two** here", () => $turnBlockInto($getRoot().getChildAtIndex(1)!, "h2")),
    ).toBe("One\n\n## **Two** here");
    expect(run("One\n\nTwo", () => $turnBlockInto($getRoot().getChildAtIndex(1)!, "bullet"))).toBe(
      "One\n\n- Two",
    );
    expect(run("# One", () => $turnBlockInto($getRoot().getFirstChild()!, "quote"))).toBe("> One");
  });

  it("turns a list into another list, or into one block per item", () => {
    const list = () => $getRoot().getChildAtIndex(1)!;
    expect(run("One\n\n- a\n- b", () => $turnBlockInto(list(), "number"))).toBe(
      "One\n\n1. a\n2. b",
    );
    expect(run("One\n\n- a\n- b", () => $turnBlockInto(list(), "text"))).toBe("One\n\na\n\nb");
    expect(run("One\n\n1. a\n2. b", () => $turnBlockInto(list(), "quote"))).toBe(
      "One\n\n> a\n\n> b",
    );
    expect(run("One\n\n- [ ] a", () => $turnBlockInto(list(), "h2"))).toBe("One\n\n## a");
  });

  it("duplicates a block right under itself", () => {
    expect(
      run("One\n\n- a\n- b\n\nThree", () => $duplicateBlock($getRoot().getChildAtIndex(1)!)),
    ).toBe("One\n\n- a\n- b\n- a\n- b\n\nThree");
  });

  it("deletes a block, and an emptied note keeps one empty line", () => {
    expect(run("One\n\nTwo", () => $deleteBlock($getRoot().getFirstChild()!))).toBe("Two");
    expect(
      run("Only", () => {
        $deleteBlock($getRoot().getFirstChild()!);
        expect($getRoot().getChildrenSize()).toBe(1);
      }),
    ).toBe("");
  });

  it("a task line can't be turned or copied (its task would be orphaned or doubled)", () => {
    run("x", () => {
      expect($blockMenuFor($createTaskLineNode("t1", false))).toEqual({
        turnInto: false,
        duplicate: false,
      });
      expect($blockMenuFor($getRoot().getFirstChild()!)).toEqual({
        turnInto: true,
        duplicate: true,
      });
    });
  });
});
