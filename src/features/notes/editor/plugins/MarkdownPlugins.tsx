import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createCodeNode } from "@lexical/code";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
} from "lexical";
import { $isListItemNode, $isListNode, $insertList } from "@lexical/list";
import { $createToggleNode } from "../nodes/ToggleNode";

type MarkdownShortcut =
  | { type: "list"; listType: "number" | "bullet" | "check"; deleteCount: number; start?: number }
  | { type: "heading"; tag: "h1" | "h2" | "h3"; deleteCount: number }
  | { type: "quote"; deleteCount: number }
  | { type: "code"; deleteCount: number }
  | { type: "toggle"; deleteCount: number };

function resolveMarkdownShortcut(text: string): MarkdownShortcut | null {
  const numberListMatch = text.match(/^(\d+)\. $/);
  if (numberListMatch) {
    return { type: "list", listType: "number", deleteCount: text.length, start: Number(numberListMatch[1]) || 1 };
  }
  if (text === "- " || text === "* ") return { type: "list", listType: "bullet", deleteCount: 2 };
  if (text === "[] " || text === "[ ] " || text === "- [ ] ") {
    return { type: "list", listType: "check", deleteCount: text.length };
  }
  if (text === "# ") return { type: "heading", tag: "h1", deleteCount: 2 };
  if (text === "## ") return { type: "heading", tag: "h2", deleteCount: 3 };
  if (text === "### ") return { type: "heading", tag: "h3", deleteCount: 4 };
  if (text === "> ") return { type: "toggle", deleteCount: 2 };
  if (text === "\" ") return { type: "quote", deleteCount: 2 };
  if (text === "``` ") return { type: "code", deleteCount: 4 };
  return null;
}

export function NotesDividerShortcutPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const shouldConvert = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return false;
          node = parent;
        }

        if (node.getType() !== "paragraph") return false;
        const parent = node.getParent();
        return parent?.getType() === "root" && node.getTextContent().trim() === "---";
      });

      if (!shouldConvert) return;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return;
          node = parent;
        }

        if (node.getType() !== "paragraph") return;
        const parent = node.getParent();
        if (parent?.getType() !== "root") return;
        if (node.getTextContent().trim() !== "---") return;

        const divider = $createHorizontalRuleNode();
        const nextParagraph = $createParagraphNode();
        node.insertBefore(divider);
        divider.insertAfter(nextParagraph);
        node.remove();
        nextParagraph.select();
      });
    });
  }, [editor]);

  return null;
}

export function NotesMarkdownListShortcutPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const shouldConvert = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return false;
          node = parent;
        }

        if (node.getType() !== "paragraph") return false;
        return resolveMarkdownShortcut(node.getTextContent());
      });

      if (!shouldConvert) return;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return;
          node = parent;
        }

        if (node.getType() !== "paragraph") return;
        const shortcut = resolveMarkdownShortcut(node.getTextContent());
        if (!shortcut) return;
        if (!$isElementNode(node)) return;

        const textNode = node.getFirstChild();
        if (!$isTextNode(textNode)) return;

        textNode.spliceText(0, shortcut.deleteCount, "", false);
        selection.setTextNodeRange(textNode, 0, textNode, 0);

        if (shortcut.type === "list") {
          $insertList(shortcut.listType);

          if (shortcut.listType === "number") {
            const start = shortcut.start ?? 1;
            const anchorNode = selection.anchor.getNode();
            const listItem = $isListItemNode(anchorNode)
              ? anchorNode
              : anchorNode.getParent();
            if (!$isListItemNode(listItem)) return;
            const listNode = listItem.getParent();
            if (!$isListNode(listNode)) return;
            listNode.setStart(start);
            listItem.setValue(start);
          }
          return;
        }

        if (shortcut.type === "heading") {
          $setBlocksType(selection, () => $createHeadingNode(shortcut.tag));
          return;
        }
        if (shortcut.type === "quote") {
          $setBlocksType(selection, () => $createQuoteNode());
          return;
        }
        if (shortcut.type === "code") {
          $setBlocksType(selection, () => $createCodeNode());
          return;
        }
        if (shortcut.type === "toggle") {
          const toggle = $createToggleNode(true, "");
          node.replace(toggle);
          toggle.selectEnd();
        }
      });
    });
  }, [editor]);

  return null;
}
