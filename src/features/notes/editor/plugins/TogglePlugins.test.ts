import { describe, expect, it } from "vitest";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { TableNode } from "@lexical/table";
import { $createToggleNode, ToggleNode } from "../nodes/ToggleNode";
import { moveKeys } from "./NotesBlockControlsPlugin";
import { validateDropZone } from "./BlockControlsModel";
import { resolveToggleTitleEnterAction } from "./TogglePlugins";

function createTestEditor(): LexicalEditor {
  return createEditor({
    nodes: [CodeNode, HeadingNode, ListNode, ListItemNode, QuoteNode, TableNode, ToggleNode],
    onError: (error) => { throw error; },
  });
}

function update<T>(editor: LexicalEditor, fn: () => T): T {
  let result!: T;
  editor.update(() => { result = fn(); }, { discrete: true });
  return result;
}

describe("toggle title enter behavior", () => {
  it("removes an empty toggle title", () => {
    expect(resolveToggleTitleEnterAction({ titleText: "", isOpen: true })).toBe("remove");
    expect(resolveToggleTitleEnterAction({ titleText: "   ", isOpen: false })).toBe("remove");
  });

  it("creates toggle body content from an open titled toggle", () => {
    expect(resolveToggleTitleEnterAction({ titleText: "Project notes", isOpen: true })).toBe("body");
  });

  it("creates a sibling toggle from a closed titled toggle", () => {
    expect(resolveToggleTitleEnterAction({ titleText: "Project notes", isOpen: false })).toBe("sibling");
  });
});

describe("toggle child drop validation", () => {
  it("allows reordering children within the same toggle (same-parent reorder)", () => {
    const result = validateDropZone({
      draggedType: "paragraph",
      targetType: "paragraph",
      targetParentType: "toggle",
      isTopLevel: false,
      sourceParentType: "toggle",
      sourceParentKey: "toggle-1",
      targetParentKey: "toggle-1",
      targetToggleOpen: true,
    });
    expect(result.valid).toBe(true);
  });

  it("allows moving a toggle child to top-level", () => {
    const result = validateDropZone({
      draggedType: "paragraph",
      targetType: "paragraph",
      targetParentType: "root",
      isTopLevel: true,
      sourceParentType: "toggle",
      sourceParentKey: "toggle-1",
      targetParentKey: "root",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects moving a toggle child into a different toggle", () => {
    const result = validateDropZone({
      draggedType: "paragraph",
      targetType: "paragraph",
      targetParentType: "toggle",
      isTopLevel: false,
      sourceParentType: "toggle",
      sourceParentKey: "toggle-1",
      targetParentKey: "toggle-2",
      targetToggleOpen: true,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("cross-parent");
  });

  it("rejects dropping into a collapsed toggle body", () => {
    const result = validateDropZone({
      draggedType: "paragraph",
      targetType: "paragraph",
      targetParentType: "toggle",
      isTopLevel: false,
      sourceParentType: "root",
      sourceParentKey: "root",
      targetParentKey: "toggle-1",
      targetToggleOpen: false,
    });
    expect(result.valid).toBe(false);
  });

  it("moveKeys: same-toggle child reorder succeeds", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const toggle = $createToggleNode(true, "Parent");
      const childA = $createParagraphNode().append($createTextNode("A"));
      const childB = $createParagraphNode().append($createTextNode("B"));
      toggle.append(childA, childB);
      $getRoot().append(toggle);
      const moved = moveKeys([childA.getKey()], childB.getKey(), "after");
      return {
        moved,
        order: toggle.getChildren().map((c) => c.getTextContent()),
      };
    });
    expect(result.moved).toBe(true);
    expect(result.order).toEqual(["B", "A"]);
  });

  it("moveKeys: toggle child moved to top-level succeeds", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const toggle = $createToggleNode(true, "Parent");
      const child = $createParagraphNode().append($createTextNode("Child"));
      toggle.append(child);
      const topLevel = $createParagraphNode().append($createTextNode("Top"));
      $getRoot().append(toggle, topLevel);
      const moved = moveKeys([child.getKey()], topLevel.getKey(), "after");
      return {
        moved,
        rootTypes: $getRoot().getChildren().map((c) => c.getType()),
      };
    });
    expect(result.moved).toBe(true);
    // toggle + original top-level + moved child (now a top-level paragraph)
    expect(result.rootTypes).toContain("paragraph");
  });

  it("moveKeys: cross-toggle child move is rejected", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const toggleA = $createToggleNode(true, "A");
      const toggleB = $createToggleNode(true, "B");
      const childA = $createParagraphNode().append($createTextNode("from A"));
      const childB = $createParagraphNode().append($createTextNode("from B"));
      toggleA.append(childA);
      toggleB.append(childB);
      $getRoot().append(toggleA, toggleB);
      const moved = moveKeys([childA.getKey()], childB.getKey(), "after");
      return {
        moved,
        toggleAChildren: toggleA.getChildrenSize(),
        toggleBChildren: toggleB.getChildrenSize(),
      };
    });
    expect(result.moved).toBe(false);
    expect(result.toggleAChildren).toBe(1);
    expect(result.toggleBChildren).toBe(1);
  });
});
