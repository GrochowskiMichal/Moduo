import { describe, expect, it } from "vitest";
import { useEffect, useRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { $createCodeNode, CodeNode } from "@lexical/code";
import { $createHeadingNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { $isTableNode, TableNode } from "@lexical/table";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ToggleNode, $createToggleNode, $isToggleNode } from "../nodes/ToggleNode";
import {
  convertBlock,
  insertParagraphNear,
  moveKeys,
  NotesBlockControlsPlugin,
  resolveBlockNodeFromLexicalNode,
} from "./NotesBlockControlsPlugin";
import { SlashCommandPlugin } from "./SlashCommandPlugin";
import type { SlashCommand } from "../../types";
import { validateDropZone } from "./BlockControlsModel";

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

function EditorCapture({ editorRef, codeKeyRef }: { editorRef: { current: LexicalEditor | null }; codeKeyRef: { current: LexicalNodeKey | null } }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  useEffect(() => {
    editor.read(() => {
      const code = $getRoot().getFirstChild();
      if (code) codeKeyRef.current = code.getKey();
    });
  }, [editor, codeKeyRef]);
  return null;
}

function flushAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

describe("code block gutter + slash picker behavior", () => {
  it("exposes .notes-block-grip on the code block's outer shell when hovered", async () => {
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const codeKeyRef: { current: LexicalNodeKey | null } = { current: null };

    const { container, unmount } = render(
      <LexicalComposer
        initialConfig={{
          namespace: "code-block-shell-test",
          nodes: [CodeNode, HeadingNode, ListNode, ListItemNode, QuoteNode, TableNode, ToggleNode],
          onError: (error) => { throw error; },
          editorState: () => {
            const code = $createCodeNode();
            code.append($createTextNode("const x = 1;"));
            $getRoot().append(code);
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <EditorCapture editorRef={editorRef} codeKeyRef={codeKeyRef} />
        <NotesBlockControlsPlugin />
      </LexicalComposer>,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
      expect(codeKeyRef.current).not.toBeNull();
    });

    const editor = editorRef.current!;
    const codeKey = codeKeyRef.current!;
    const shell = editor.getElementByKey(codeKey);
    expect(shell).not.toBeNull();

    await act(async () => {
      shell!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }));
      await flushAnimationFrame();
    });

    await waitFor(() => {
      const grip = document.querySelector(".notes-block-grip");
      expect(grip).not.toBeNull();
    });

    // Sanity: the grip lives outside the code block shell so it doesn't pollute
    // the editor tree's key map.
    expect(container.contains(document.querySelector(".notes-block-grip"))).toBe(true);

    unmount();
  });

  it("suppresses the slash picker when a slash token lives inside code text", async () => {
    const editorRef: { current: LexicalEditor | null } = { current: null };

    const { unmount } = render(
      <LexicalComposer
        initialConfig={{
          namespace: "code-block-slash-test",
          nodes: [CodeNode, HeadingNode, ListNode, ListItemNode, QuoteNode, TableNode, ToggleNode],
          onError: (error) => { throw error; },
          editorState: () => {
            const code = $createCodeNode();
            code.append($createTextNode("/heading"));
            $getRoot().append(code);
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <EditorCapture editorRef={editorRef} codeKeyRef={{ current: null }} />
        <SlashCommandPlugin />
      </LexicalComposer>,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    // The slash command plugin should not render its listbox because the
    // anchor is inside a code block (see resolveSlashMenuState guard).
    await act(async () => {
      await flushAnimationFrame();
    });

    const picker = document.querySelector("[role='listbox'][aria-label='Slash Commands']");
    expect(picker).toBeNull();

    unmount();
  });
});
