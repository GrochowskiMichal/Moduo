import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { $createCodeNode } from "@lexical/code";
import { $insertList } from "@lexical/list";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  type NodeKey,
  type TextNode,
} from "lexical";
import type { SlashCommand } from "../../types";

type SlashMenuState = {
  query: string;
  nodeKey: NodeKey;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
};

const COMMANDS: SlashCommand[] = [
  { id: "paragraph", title: "Paragraph", keywords: ["text", "normal"], group: "Basic" },
  { id: "h1", title: "Heading 1", keywords: ["title", "h1"], group: "Basic" },
  { id: "h2", title: "Heading 2", keywords: ["subtitle", "h2"], group: "Basic" },
  { id: "h3", title: "Heading 3", keywords: ["h3"], group: "Basic" },
  { id: "bullet", title: "Bulleted List", keywords: ["list", "bullet"], group: "Lists" },
  { id: "number", title: "Numbered List", keywords: ["list", "number"], group: "Lists" },
  { id: "todo", title: "To-do List", keywords: ["check", "task"], group: "Lists" },
  { id: "quote", title: "Quote", keywords: ["blockquote"], group: "Blocks" },
  { id: "code", title: "Code Block", keywords: ["snippet", "code"], group: "Blocks" },
  { id: "divider", title: "Divider", keywords: ["hr", "separator"], group: "Blocks" },
  { id: "toggle", title: "Toggle", keywords: ["collapsible", "disclosure"], group: "Blocks" },
];

function filterCommands(query: string): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return COMMANDS;

  return COMMANDS.filter((command) => {
    if (command.title.toLowerCase().includes(normalized)) return true;
    return command.keywords.some((keyword) => keyword.toLowerCase().includes(normalized));
  });
}

function runCommand(command: SlashCommand): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  switch (command.id) {
    case "paragraph":
      $setBlocksType(selection, () => $createParagraphNode());
      return;
    case "h1":
      $setBlocksType(selection, () => $createHeadingNode("h1"));
      return;
    case "h2":
      $setBlocksType(selection, () => $createHeadingNode("h2"));
      return;
    case "h3":
      $setBlocksType(selection, () => $createHeadingNode("h3"));
      return;
    case "bullet":
      $insertList("bullet");
      return;
    case "number":
      $insertList("number");
      return;
    case "todo":
      $insertList("check");
      return;
    case "quote":
      $setBlocksType(selection, () => $createQuoteNode());
      return;
    case "code":
      $setBlocksType(selection, () => $createCodeNode());
      return;
    case "divider":
      selection.insertNodes([$createHorizontalRuleNode(), $createParagraphNode()]);
      return;
    case "toggle": {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("▸ Toggle"));
      selection.insertNodes([paragraph]);
      return;
    }
    default:
      return;
  }
}

function removeSlashToken(menu: SlashMenuState): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  const node = $getNodeByKey(menu.nodeKey);
  if (!$isTextNode(node)) return;

  const nodeText = node.getTextContent();
  if (menu.startOffset < 0 || menu.endOffset > nodeText.length || menu.startOffset >= menu.endOffset) return;

  const deleteCount = menu.endOffset - menu.startOffset;
  node.spliceText(menu.startOffset, deleteCount, "", false);
  selection.setTextNodeRange(node, menu.startOffset, node, menu.startOffset);
}

function resolveSlashMenuState(editor: LexicalEditor): SlashMenuState | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

    const anchor = selection.anchor;
    if (anchor.type !== "text") return null;

    const node = anchor.getNode();
    if (!$isTextNode(node) || !node.isSimpleText()) return null;

    const textBefore = node.getTextContent().slice(0, anchor.offset);
    const match = textBefore.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!match) return null;

    const query = match[1] ?? "";
    const slashToken = `/${query}`;
    const startOffset = textBefore.lastIndexOf(slashToken);
    if (startOffset < 0) return null;

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return null;

    const range = domSelection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();

    return {
      query,
      nodeKey: node.getKey(),
      startOffset,
      endOffset: anchor.offset,
      top: rect.bottom + 8,
      left: rect.left,
    };
  });
}

export function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<SlashMenuState | null>(null);

  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);

  const commands = useMemo(() => filterCommands(menu?.query ?? ""), [menu?.query]);

  const applyCommandFromMenu = (command: SlashCommand, activeMenu: SlashMenuState) => {
    editor.focus();
    editor.update(() => {
      removeSlashToken(activeMenu);
      runCommand(command);
    });
  };

  useEffect(() => {
    if (!menu) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, Math.max(0, commands.length - 1)));
  }, [commands.length, menu]);

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (typeof window === "undefined") return;
      const next = resolveSlashMenuState(editor);
      setMenu(next);
    });
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (!menuRef.current || commands.length === 0) return false;
        event?.preventDefault();
        setSelectedIndex((current) => (current + 1) % commands.length);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [commands.length, editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!menuRef.current || commands.length === 0) return false;
        event?.preventDefault();
        setSelectedIndex((current) => (current - 1 + commands.length) % commands.length);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [commands.length, editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (!menuRef.current) return false;
        event?.preventDefault();
        setMenu(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const activeMenu = menuRef.current;
        if (!activeMenu || commands.length === 0) return false;

        event?.preventDefault();
        const command = commands[selectedIndex] ?? commands[0];
        if (!command) return true;

        applyCommandFromMenu(command, activeMenu);
        setMenu(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [commands, editor, selectedIndex]);

  if (!menu || commands.length === 0) return null;

  return createPortal(
    <div
      className="fixed z-[999] min-w-[260px] rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-[6px] shadow-[0_14px_30px_#00000057]"
      style={{ top: menu.top, left: menu.left }}
      role="listbox"
      aria-label="Slash Commands"
    >
      {commands.map((command, index) => (
        <button
          key={command.id}
          type="button"
          role="option"
          className={`flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-2 text-[#d8d8d8] hover:bg-[#202020] ${selectedIndex === index ? "bg-[#202020]" : ""}`}
          onMouseEnter={() => setSelectedIndex(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            const activeMenu = menuRef.current;
            if (!activeMenu) return;
            applyCommandFromMenu(command, activeMenu);
            setMenu(null);
          }}
        >
          <span>{command.title}</span>
          <span className="text-[11px] text-[#8a8a8a]">{command.group}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
