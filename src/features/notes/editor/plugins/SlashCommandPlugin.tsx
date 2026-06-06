import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { $createCodeNode } from "@lexical/code";
import { $insertList } from "@lexical/list";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createTableNodeWithDimensions } from "@lexical/table";
import { $isCodeNode } from "@lexical/code";
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
} from "lexical";
import type { SlashCommand } from "../../types";
import { $createToggleNode } from "../nodes/ToggleNode";

// ─── Types ───────────────────────────────────────────────────────────────────

type SlashMenuState = {
  query: string;
  nodeKey: NodeKey;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
};

// ─── Command Definitions ─────────────────────────────────────────────────────

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
  { id: "table", title: "Table", keywords: ["grid", "spreadsheet"], group: "Media" },
];

// Icon map (SVG paths) keyed by command id
const COMMAND_ICONS: Record<string, string> = {
  paragraph:
    "M11 4v16M7 4h8a4 4 0 0 1 0 8H7",
  h1:
    "M4 6h1v12M4 12h6M11 6h1v12M17 14l2-2v8",
  h2:
    "M4 6h1v12M4 12h6M11 6h1v12M17 11a2 2 0 1 1 4 0c0 1.5-4 3-4 5h4",
  h3:
    "M4 6h1v12M4 12h6M11 6h1v12M17 9a2 2 0 1 1 4 0c0 1-1.5 2-2 2s2 1 2 2a2 2 0 1 1-4 0",
  bullet:
    "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  number:
    "M10 6h11M10 12h11M10 18h11M4 6v.01M4 12l-1 1h2l-1 1M3 18h2l-2 2h2",
  todo:
    "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  quote:
    "M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1zm12 0c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z",
  code:
    "M16 18l6-6-6-6M8 6l-6 6 6 6",
  divider:
    "M5 12h14M12 5v2M12 17v2",
  toggle:
    "M9 18l6-6-6-6",
  table:
    "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
};

function CommandIcon({ id }: { id: string }) {
  const path = COMMAND_ICONS[id];
  if (!path) return null;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-60"
      aria-hidden="true"
    >
      {path.split("M").filter(Boolean).map((segment, i) => (
        <path key={i} d={`M${segment}`} />
      ))}
    </svg>
  );
}

// ─── Table Size Picker ────────────────────────────────────────────────────────

const TABLE_MAX_ROWS = 8;
const TABLE_MAX_COLS = 8;

type TablePickerProps = {
  onPick: (rows: number, cols: number) => void;
};

function TableSizePicker({ onPick }: TablePickerProps) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  const rows = hovered?.row ?? 0;
  const cols = hovered?.col ?? 0;

  return (
    <div className="notes-table-picker px-[10px] py-[8px]">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${TABLE_MAX_COLS}, 1fr)`, gap: "3px" }}
        onMouseLeave={() => setHovered(null)}
      >
        {Array.from({ length: TABLE_MAX_ROWS }, (_, r) =>
          Array.from({ length: TABLE_MAX_COLS }, (_, c) => {
            const isActive = r < rows && c < cols;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                aria-label={`${r + 1}×${c + 1} table`}
                className="notes-table-picker-cell"
                data-active={isActive}
                onMouseEnter={() => setHovered({ row: r + 1, col: c + 1 })}
                onClick={() => onPick(r + 1, c + 1)}
              />
            );
          })
        )}
      </div>
      <p className="mt-[8px] text-center text-[12px] text-[#888]">
        {hovered ? `${hovered.row} × ${hovered.col}` : "Hover to select size"}
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterCommands(query: string): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return COMMANDS;

  return COMMANDS.filter((command) => {
    if (command.title.toLowerCase().includes(normalized)) return true;
    return command.keywords.some((keyword) => keyword.toLowerCase().includes(normalized));
  });
}

function runCommand(command: SlashCommand, tableSize?: { rows: number; cols: number }): void {
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
      {
        let node = selection.anchor.getNode();
        while (node && !$isCodeNode(node)) {
          const parent = node.getParent();
          if (!parent) return;
          node = parent;
        }
        if ($isCodeNode(node) && !node.getNextSibling()) {
          node.insertAfter($createParagraphNode());
        }
      }
      return;
    case "divider":
      selection.insertNodes([$createHorizontalRuleNode(), $createParagraphNode()]);
      return;
    case "toggle": {
      const toggle = $createToggleNode(true);
      toggle.append($createTextNode("Toggle"));
      selection.insertNodes([toggle, $createParagraphNode()]);
      toggle.selectEnd();
      return;
    }
    case "table": {
      const { rows = 3, cols = 3 } = tableSize ?? {};
      const tableNode = $createTableNodeWithDimensions(rows, cols, true);
      selection.insertNodes([tableNode, $createParagraphNode()]);
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
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const menuMinWidth = 280;
    const menuMaxHeight = 420;
    const margin = 12;

    let top = rect.bottom + 8;
    // If opening downward would clip, flip above caret.
    if (top + menuMaxHeight > viewportH - margin) {
      top = Math.max(margin, rect.top - 8 - menuMaxHeight);
    }
    // Final clamp for safety.
    top = Math.min(top, Math.max(margin, viewportH - margin - menuMaxHeight));

    const maxLeft = Math.max(margin, viewportW - menuMinWidth - margin);
    const left = Math.max(margin, Math.min(rect.left, maxLeft));

    return {
      query,
      nodeKey: node.getKey(),
      startOffset,
      endOffset: anchor.offset,
      top,
      left,
    };
  });
}

// ─── Group helpers ────────────────────────────────────────────────────────────

function groupedCommands(commands: SlashCommand[]) {
  const groups: Array<{ group: string; items: SlashCommand[] }> = [];
  const seen = new Map<string, number>();

  for (const cmd of commands) {
    const idx = seen.get(cmd.group);
    if (idx === undefined) {
      seen.set(cmd.group, groups.length);
      groups.push({ group: cmd.group, items: [cmd] });
    } else {
      groups[idx]!.items.push(cmd);
    }
  }

  return groups;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Table picker
  const [tablePickerOpen, setTablePickerOpen] = useState(false);

  const menuRef = useRef<SlashMenuState | null>(null);
  const menuElementRef = useRef<HTMLDivElement | null>(null);
  const commandsRef = useRef<SlashCommand[]>([]);
  const selectedIndexRef = useRef(0);
  const menuSigRef = useRef<string | null>(null);
  const dismissedMenuSigRef = useRef<string | null>(null);
  const tablePickerOpenRef = useRef(false);

  menuRef.current = menu;
  tablePickerOpenRef.current = tablePickerOpen;

  const commands = useMemo(() => filterCommands(menu?.query ?? ""), [menu?.query]);
  commandsRef.current = commands;
  selectedIndexRef.current = selectedIndex;

  // Flat index → command (needed for keyboard navigation, skipping group headers)
  const flatCommands = commands;

  // ── Reset selected when menu opens/switches ────────────────────────────────
  useEffect(() => {
    if (!menu) {
      setSelectedIndex(0);
      setTablePickerOpen(false);
      return;
    }
    setSelectedIndex((current) => Math.min(current, Math.max(0, commands.length - 1)));
  }, [commands.length, menu]);

  // ── Detect slash token in the editor ──────────────────────────────────────
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (typeof window === "undefined") return;
      const next = resolveSlashMenuState(editor);
      const nextSig = next ? `${next.nodeKey}:${next.startOffset}` : null;
      const nextDismissSig = next ? `${next.nodeKey}:${next.startOffset}:${next.endOffset}:${next.query}` : null;
      if (nextDismissSig !== dismissedMenuSigRef.current) {
        dismissedMenuSigRef.current = null;
      }
      if (nextSig && nextSig !== menuSigRef.current) {
        selectedIndexRef.current = 0;
        setSelectedIndex(0);
        setTablePickerOpen(false);
      }
      menuSigRef.current = nextSig;
      setMenu(nextDismissSig === dismissedMenuSigRef.current ? null : next);
    });
  }, [editor]);

  // ── Close when clicking outside the menu ──────────────────────────────────
  useEffect(() => {
    if (!menu) return;

    const onPointerDown = (event: PointerEvent) => {
      const menuElement = menuElementRef.current;
      const target = event.target;
      if (menuElement && target instanceof Node && menuElement.contains(target)) return;

      dismissedMenuSigRef.current = `${menu.nodeKey}:${menu.startOffset}:${menu.endOffset}:${menu.query}`;
      setTablePickerOpen(false);
      setMenu(null);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [menu]);

  // ── Apply a command ────────────────────────────────────────────────────────
  const applyCommand = (command: SlashCommand, activeMenu: SlashMenuState, tableSize?: { rows: number; cols: number }) => {
    editor.focus();
    editor.update(() => {
      removeSlashToken(activeMenu);
      runCommand(command, tableSize);
    });
  };

  // ── Handle table pick ──────────────────────────────────────────────────────
  const handleTablePick = (rows: number, cols: number) => {
    const activeMenu = menuRef.current;
    if (!activeMenu) return;
    const tableCommand = commands.find((c) => c.id === "table");
    if (!tableCommand) return;
    applyCommand(tableCommand, activeMenu, { rows, cols });
    setMenu(null);
    setTablePickerOpen(false);
  };

  // ── Arrow key navigation ───────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        const activeMenu = menuRef.current;
        const activeCommands = commandsRef.current;
        if (!activeMenu || activeCommands.length === 0) return false;
        event?.preventDefault();
        const next = (selectedIndexRef.current + 1) % activeCommands.length;
        selectedIndexRef.current = next;
        setSelectedIndex(next);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        const activeMenu = menuRef.current;
        const activeCommands = commandsRef.current;
        if (!activeMenu || activeCommands.length === 0) return false;
        event?.preventDefault();
        const next = (selectedIndexRef.current - 1 + activeCommands.length) % activeCommands.length;
        selectedIndexRef.current = next;
        setSelectedIndex(next);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  // ── Escape ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (tablePickerOpen) {
          event?.preventDefault();
          setTablePickerOpen(false);
          return true;
        }
        if (!menuRef.current) return false;
        event?.preventDefault();
        setMenu(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, tablePickerOpen]);

  // ── Enter ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const activeMenu = menuRef.current;
        const activeCommands = commandsRef.current;
        if (!activeMenu || activeCommands.length === 0) return false;
        event?.preventDefault();
        const command = activeCommands[selectedIndexRef.current] ?? activeCommands[0];
        if (!command) return true;

        if (command.id === "table" && tablePickerOpenRef.current) {
          applyCommand(command, activeMenu, { rows: 3, cols: 3 });
          setMenu(null);
          setTablePickerOpen(false);
          return true;
        }

        if (command.id === "table") {
          setTablePickerOpen(true);
          return true;
        }

        applyCommand(command, activeMenu);
        setMenu(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Keep selection visible ─────────────────────────────────────────────────
  useEffect(() => {
    if (!menu) return;
    editor.focus();
  }, [editor, menu]);

  useEffect(() => {
    const activeMenu = menuRef.current;
    if (!activeMenu) return;
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-slashcmd-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedIndex]);

  if (!menu || commands.length === 0) return null;

  const groups = groupedCommands(flatCommands);

  // Absolute flat index counter for data-slashcmd-index
  let flatIdx = 0;

  return createPortal(
    <div
      ref={menuElementRef}
      className="fixed z-[999] max-h-[420px] min-w-[280px] overflow-y-auto rounded-[14px] border border-[#252525] bg-[#161616] p-[6px] shadow-[0_16px_40px_#00000070] custom-scrollbar"
      style={{ top: menu.top, left: menu.left }}
      role="listbox"
      aria-label="Slash Commands"
    >
      {groups.map(({ group, items }) => (
        <div key={group}>
          {/* Group header */}
          <div
            className="mb-[2px] mt-[6px] px-[10px] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#505050] first:mt-[2px]"
            role="presentation"
          >
            {group}
          </div>

          {items.map((command) => {
            const idx = flatIdx++;
            const isSelected = selectedIndex === idx;
            const isTable = command.id === "table";

            return (
              <div key={command.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-haspopup={isTable ? "true" : undefined}
                  aria-expanded={isTable && tablePickerOpen ? "true" : undefined}
                  data-slashcmd-index={idx}
                  className={`group flex w-full cursor-pointer items-center gap-[10px] rounded-[10px] px-[10px] py-[7px] text-left text-[14px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/10 ${isSelected
                    ? "bg-[#202020] text-[#f1f1f1]"
                    : "bg-transparent text-[#d0d0d0] hover:bg-[#1c1c1c] hover:text-[#f1f1f1]"
                    }`}
                  onMouseEnter={() => {
                    setSelectedIndex(idx);
                    if (!isTable) setTablePickerOpen(false);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    const activeMenu = menuRef.current;
                    if (!activeMenu) return;

                    if (isTable) {
                      setTablePickerOpen((prev) => !prev);
                      return;
                    }

                    applyCommand(command, activeMenu);
                    setMenu(null);
                  }}
                >
                  {/* Icon */}
                  <span
                    className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] border transition-colors ${isSelected
                      ? "border-[#333] bg-[#2a2a2a] text-[#e0e0e0]"
                      : "border-[#2a2a2a] bg-[#1a1a1a] text-[#888]"
                      }`}
                  >
                    <CommandIcon id={command.id} />
                  </span>

                  <span className="min-w-0 flex-1 truncate">{command.title}</span>

                  {isTable && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`shrink-0 transition-transform ${tablePickerOpen && isSelected ? "rotate-90" : ""} opacity-40`}
                      aria-hidden="true"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </button>

                {/* Table size picker (inline, under the table button) */}
                {isTable && tablePickerOpen && isSelected && (
                  <TableSizePicker onPick={handleTablePick} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>,
    document.body
  );
}
