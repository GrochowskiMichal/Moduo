import { describe, expect, it, vi } from "vitest";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { $createCodeNode, CodeNode } from "@lexical/code";
import { $createHeadingNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { $isTableNode, TableNode } from "@lexical/table";
import { ToggleNode, $createToggleNode, $isToggleNode } from "../nodes/ToggleNode";
import {
  convertBlock,
  insertParagraphNear,
  moveKeys,
  resolveBlockNodeFromLexicalNode,
} from "./NotesBlockControlsPlugin";
import { resolveSlashMenuState } from "./SlashCommandPlugin";
import type { SlashCommand } from "../../types";
import { validateDropZone } from "./BlockControlsModel";

// The full @lexical/react/LexicalComposer hits a circular-import
// (HISTORY_MERGE_TAG) when loaded under vitest, so we mock the composer
// context to provide a real editor instance for the integration tests below.
vi.mock("@lexical/react/LexicalComposerContext", () => ({
  LexicalComposerContext: undefined,
  useLexicalComposerContext: () => [globalThis.__MODUO_TEST_EDITOR__],
}));

// LexicalHorizontalRuleNode has its own circular import in dev mode that
// surfaces when SlashCommandPlugin is loaded under vitest. The plugin under
// test doesn't depend on the horizontal rule node, so stub it out.
vi.mock("@lexical/react/LexicalHorizontalRuleNode", () => ({
  HorizontalRuleNode: class HorizontalRuleNode {},
  $createHorizontalRuleNode: () => ({}) as unknown as ReturnType<typeof Object>,
}));

// @lexical/selection also has a circular import ($cloneWithProperties)
// when loaded under vitest. The plugin doesn't directly depend on it, so
// stub the one symbol it transitively pulls in.
vi.mock("@lexical/selection", () => ({
  $setBlocksType: () => undefined,
  $patchRangeStyle: () => undefined,
}));

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

const command = (id: SlashCommand["id"]): SlashCommand => ({ id, title: id, keywords: [], group: "Basic" });

describe("NotesBlockControlsPlugin helpers", () => {
  it("resolves collapsed toggles and title lines to the toggle shell but body blocks to themselves", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const collapsed = $createToggleNode(false, "Closed");
      const open = $createToggleNode(true, "Open");
      const body = $createParagraphNode().append($createTextNode("Body"));
      open.append(body);
      $getRoot().append(collapsed, open);

      return {
        collapsed: resolveBlockNodeFromLexicalNode(collapsed.getFirstChildOrThrow())?.getKey() === collapsed.getKey(),
        title: resolveBlockNodeFromLexicalNode(open.getFirstChildOrThrow())?.getKey() === open.getKey(),
        body: resolveBlockNodeFromLexicalNode(body.getFirstChildOrThrow())?.getKey() === body.getKey(),
      };
    });

    expect(result).toEqual({ collapsed: true, title: true, body: true });
  });

  it("inserts outside a list wrapper when inserting near a list item", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const list = $createListNode("bullet");
      const item = $createListItemNode().append($createTextNode("item"));
      list.append(item);
      $getRoot().append(list);
      const insertedKey = insertParagraphNear(item.getKey(), "after");
      const rootChildren = $getRoot().getChildren();
      return {
        insertedKey,
        rootTypes: rootChildren.map((child) => child.getType()),
        listChildren: list.getChildren().map((child) => child.getType()),
      };
    });

    expect(result.insertedKey).toBeTruthy();
    expect(result.rootTypes).toEqual(["list", "paragraph"]);
    expect(result.listChildren).toEqual(["listitem"]);
  });

  it("preserves paragraph content when converting to heading", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const paragraph = $createParagraphNode().append($createTextNode("Keep me"));
      $getRoot().append(paragraph);
      convertBlock(paragraph.getKey(), command("h2"));
      const first = $getRoot().getFirstChildOrThrow();
      return { type: first.getType(), text: first.getTextContent() };
    });

    expect(result).toEqual({ type: "heading", text: "Keep me" });
  });

  it("moves paragraph content into toggle title and creates an empty body paragraph", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const paragraph = $createParagraphNode().append($createTextNode("Toggle title"));
      $getRoot().append(paragraph);
      convertBlock(paragraph.getKey(), command("toggle"));
      const toggle = $getRoot().getFirstChildOrThrow();
      return {
        type: toggle.getType(),
        isToggle: $isToggleNode(toggle),
        childCount: $isToggleNode(toggle) ? toggle.getChildrenSize() : 0,
        titleText: $isToggleNode(toggle) ? toggle.getFirstChildOrThrow().getTextContent() : "",
        bodyType: $isToggleNode(toggle) ? toggle.getChildAtIndex(1)?.getType() : "",
      };
    });

    expect(result).toEqual({ type: "toggle", isToggle: true, childCount: 2, titleText: "Toggle title", bodyType: "paragraph" });
  });

  it("splits code blocks into paragraphs by newline when converting to text", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const code = $createCodeNode().append($createTextNode("one\ntwo"));
      $getRoot().append(code);
      convertBlock(code.getKey(), command("paragraph"));
      return $getRoot().getChildren().map((child) => [child.getType(), child.getTextContent()]);
    });

    expect(result).toEqual([["paragraph", "one"], ["paragraph", "two"]]);
  });

  it("converts list items to paragraphs when dragging out to top level", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const list = $createListNode("bullet");
      const item = $createListItemNode().append($createTextNode("item"));
      const target = $createParagraphNode().append($createTextNode("target"));
      list.append(item);
      $getRoot().append(list, target);
      const moved = moveKeys([item.getKey()], target.getKey(), "after", { convertListItemsToParagraph: true });
      return {
        moved,
        root: $getRoot().getChildren().map((child) => [child.getType(), child.getTextContent()]),
      };
    });

    expect(result.moved).toBe(true);
    expect(result.root).toEqual([["paragraph", "target"], ["paragraph", "item"]]);
  });

  it("converts a paragraph to a list item when dragging into a bullet list", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const list = $createListNode("bullet").append($createListItemNode().append($createTextNode("before")));
      const itemKey = list.getFirstChild()?.getKey() ?? list.getKey();
      const paragraph = $createParagraphNode().append($createTextNode("paragraph"));
      $getRoot().append(list, paragraph);
      const moved = moveKeys([paragraph.getKey()], itemKey, "after", { convertToListItem: true });
      return {
        moved,
        root: $getRoot().getChildren().map((child) => child.getType()),
        listChildren: list.getChildren().map((child) => child.getType()),
      };
    });

    expect(result.moved).toBe(true);
    expect(result.root).toEqual(["list"]);
    expect(result.listChildren).toEqual(["listitem", "listitem"]);
  });

  it("validateDropZone rejects code block dragged into a list", () => {
    const result = validateDropZone({
      draggedType: "code",
      targetType: "listitem",
      targetParentType: "list",
      isTopLevel: false,
    });
    expect(result.valid).toBe(false);
  });

  it("validateDropZone rejects toggle dragged into a list", () => {
    const result = validateDropZone({
      draggedType: "toggle",
      targetType: "listitem",
      targetParentType: "list",
      isTopLevel: false,
    });
    expect(result.valid).toBe(false);
  });

  it("validateDropZone rejects table dragged into a list", () => {
    const result = validateDropZone({
      draggedType: "table",
      targetType: "listitem",
      targetParentType: "list",
      isTopLevel: false,
    });
    expect(result.valid).toBe(false);
  });

  it("validateDropZone rejects divider dragged into a list (no convertible list type)", () => {
    const result = validateDropZone({
      draggedType: "divider",
      targetType: "listitem",
      targetParentType: "list",
      isTopLevel: false,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("non-list-to-list");
  });

  it("validateDropZone allows quote dragged into a list (has convertible list type)", () => {
    const result = validateDropZone({
      draggedType: "quote",
      targetType: "listitem",
      targetParentType: "list",
      isTopLevel: false,
    });
    expect(result.valid).toBe(true);
    expect(result.convertToListItem).toBe(true);
  });

  it("moveKeys safety-net: rejects inserting an unconverted paragraph directly into a list parent", () => {
    const editor = createTestEditor();
    const result = update(editor, () => {
      const list = $createListNode("bullet").append($createListItemNode().append($createTextNode("item")));
      const paragraph = $createParagraphNode().append($createTextNode("intruder"));
      $getRoot().append(list, paragraph);
      // Pass convertToListItem: false so no conversion runs — the safety net should block it.
      const moved = moveKeys([paragraph.getKey()], list.getFirstChild()!.getKey(), "after", { convertToListItem: false });
      return {
        moved,
        listChildren: list.getChildren().map((c) => c.getType()),
      };
    });
    expect(result.moved).toBe(false);
    expect(result.listChildren).toEqual(["listitem"]);
  });
});

// ─── Code block behavior (gutter shell + slash picker suppression) ───────────

type LexicalNodeKey = string;

declare global {
  // eslint-disable-next-line no-var
  var __MODUO_TEST_EDITOR__: LexicalEditor | undefined;
}

function mountTestEditor(buildState: () => void): { editor: LexicalEditor; dispose: () => void } {
  const editorRoot = document.createElement("div");
  // The editor's DOM root needs to be content-editable so Lexical's active
  // editor detection (which scans for [contenteditable] descendants) can find
  // the test editor from $getNearestNodeFromDOMNode.
  editorRoot.setAttribute("contenteditable", "true");
  document.body.appendChild(editorRoot);
  const editor = createEditor({
    nodes: [CodeNode, HeadingNode, ListNode, ListItemNode, QuoteNode, TableNode, ToggleNode],
    onError: (error) => { throw error; },
  });
  globalThis.__MODUO_TEST_EDITOR__ = editor;
  editor.update(buildState, { discrete: true });
  editor.setRootElement(editorRoot);
  return {
    editor,
    dispose: () => {
      editor.setRootElement(null);
      editorRoot.remove();
    },
  };
}

describe("code block gutter + slash picker behavior", () => {
  it("suppresses the slash picker when a slash token lives inside code text", () => {
    const { editor, dispose } = mountTestEditor(() => {
      const code = $createCodeNode();
      code.append($createTextNode("/heading"));
      $getRoot().append(code);
    });
    // resolveSlashMenuState is the unit-level guard that the slash command
    // plugin uses; it must return null when the anchor is inside code text.
    const result = editor.getEditorState().read(() => resolveSlashMenuState(editor));
    expect(result).toBeNull();
    dispose();
  });

  it("renders the code block shell as the Lexical element for a code block", () => {
    let capturedKey: LexicalNodeKey = "";
    const { editor, dispose } = mountTestEditor(() => {
      const code = $createCodeNode();
      code.append($createTextNode("const x = 1;"));
      $getRoot().append(code);
      capturedKey = code.getKey();
    });
    const shell = editor.getElementByKey(capturedKey);
    expect(shell).not.toBeNull();
    expect(shell!.tagName.toLowerCase()).toBe("code");
    // The first descendant span is the code text node — distinct from the shell.
    const textSpan = shell!.querySelector("span");
    expect(textSpan).not.toBeNull();
    expect(textSpan).not.toBe(shell);
    dispose();
  });
});
