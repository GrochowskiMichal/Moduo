import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  $createParagraphNode,
  $createTextNode,
  $copyNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import {
  $createListNode,
  $createListItemNode,
  $isListItemNode,
  $isListNode,
  type ListNode,
  type ListItemNode,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $isTableNode } from "@lexical/table";
import { ArrowDown, ArrowUp, Copy, GripVertical, ListPlus, Trash2 } from "lucide-react";
import type { SlashCommand } from "../../types";
import { $createToggleNode, $isToggleNode } from "../nodes/ToggleNode";
import { getRegistryEntryForNode, isCodeBlockShellDomTarget, isInsideCodeBlock } from "./BlockRegistry";
import {
  areContiguousSiblings,
  BLOCK_ACTION_COMMAND_IDS,
  decideSiblingDrop,
  resolveDropPlacement,
  shouldExposeSlashLikeControls,
  uniqueKeys,
  getDraggableUnit,
  getBlockRegistryEntry,
  validateDropZone,
  shouldConvertListDragToParagraph,
  isListType,
  type DropPlacement,
} from "./BlockControlsModel";
import { NOTES_BLOCK_COMMANDS, OPEN_PICKER_FOR_NODE_COMMAND, runNotesBlockCommand } from "./SlashCommandPlugin";

// ─── Types ────────────────────────────────────────────────────────────────────

type HoveredBlock = {
  key: NodeKey;
  type: string;
  rect: DOMRect;
};

type MenuState = {
  key: NodeKey;
  type: string;
  top: number;
  left: number;
  activeIndex: number;
};

type DropState = {
  targetKey: NodeKey;
  placement: DropPlacement;
  top: number;
  left: number;
  width: number;
  convertToParagraph?: boolean;
  convertToListItem?: boolean;
};

type MultiSelectState = {
  keys: NodeKey[];
  anchorKey: NodeKey;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAG_FORMAT = "application/x-moduo-note-block";
const DRAG_THRESHOLD_PX = 4;
const FAOUT_DELAY_MS = 120;
const TOOLTIP_DELAY_MS = 400;
const MENU_WIDTH_PX = 220;

const TURN_INTO_COMMANDS = NOTES_BLOCK_COMMANDS.filter((command) =>
  BLOCK_ACTION_COMMAND_IDS.includes(command.id),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function commandLabel(command: SlashCommand): string {
  return command.id === "todo" ? "To-do list" : command.title;
}

function findTableAncestor(node: LexicalNode): LexicalNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isTableNode(current)) return current;
    current = current.getParent();
  }
  return null;
}

export function resolveBlockNodeFromLexicalNode(startNode: LexicalNode): LexicalNode | null {
  const table = findTableAncestor(startNode);
  if (table) return table;

  // Toggle title (first child paragraph) resolves to the toggle wrapper for control
  // purposes, while other toggle body children resolve to themselves.
  if ($isToggleNode(startNode)) return startNode;
  let parent = startNode.getParent();
  if (parent && $isToggleNode(parent) && $isElementNode(parent)) {
    const first = parent.getFirstChild();
    if (startNode === first || startNode.getParent() === first) return parent;
  }

  let node: LexicalNode | null = startNode;
  if (!$isElementNode(node)) node = node.getParent();
  if (!node) return null;

  if ($isListItemNode(node) || $isCodeNode(node)) return node;

  let current: LexicalNode | null = node;
  while (current) {
    const parent: LexicalNode | null = current.getParent();
    if ($isListItemNode(parent)) return parent;
    if ($isListNode(parent)) return current;
    if (!parent || parent.getType() === "root" || $isToggleNode(parent)) return current;
    current = parent;
  }
  return node;
}

function registryTypeForBlock(block: LexicalNode): string {
  const entry = getRegistryEntryForNode(block);
  if (!entry) return block.getType();
  return entry.headingTag ?? entry.type;
}

function resolveBlockKeyFromDom(target: HTMLElement): { key: NodeKey; type: string } | null {
  const nearest = $getNearestNodeFromDOMNode(target);
  if (!nearest) return null;
  const block = resolveBlockNodeFromLexicalNode(nearest);
  if (!block || block.getType() === "root") return null;
  return { key: block.getKey(), type: registryTypeForBlock(block) };
}

function isInsideCodeBlockFromDom(target: HTMLElement): boolean {
  const nearest = $getNearestNodeFromDOMNode(target);
  return isInsideCodeBlock(nearest);
}

/**
 * Returns true when the active Lexical range selection's anchor lives inside
 * the text body of a code block. Used to suppress slash-like controls (slash
 * picker, block menu, keyboard shortcuts that open them) when the user is
 * actively typing code — the code block owns its own internal cursor per
 * PRD section 08.
 */
function isActiveSelectionInsideCodeBlock(editor: ReturnType<typeof useLexicalComposerContext>[0]): boolean {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return false;
    return isInsideCodeBlock(selection.anchor.getNode());
  });
}

/**
 * Geometry-based drop resolver.
 *
 * Instead of relying on `elementFromPoint` (which returns null/the root when
 * the pointer is in inter-block whitespace or gutter area), this function
 * enumerates every visible top-level block unit from the editor state, reads
 * their DOM rects, and selects the closest before/after boundary for the given
 * pointer Y position.  The pointer's X is allowed anywhere within the editor's
 * horizontal bounds (content + gutter), so drags that land in whitespace or
 * beside the text column still resolve correctly.
 *
 * Must be called inside an `editor.getEditorState().read()` call.
 */
function resolveDropByGeometry(
  clientX: number,
  clientY: number,
  editorRoot: HTMLElement,
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  draggedKeys: NodeKey[],
): { key: NodeKey; placement: DropPlacement; rect: DOMRect; validation: ReturnType<typeof validateDropZone> } | null {
  // Allow drops within the editor's full horizontal extent (including gutter).
  const rootRect = editorRoot.getBoundingClientRect();
  // Extend left boundary by 80 px to cover the gutter / handle column.
  if (clientX < rootRect.left - 80 || clientX > rootRect.right) return null;

  const rootNode = $getRoot();
  const children = rootNode.getChildren();
  if (children.length === 0) return null;

  const draggedNode = $getNodeByKey(draggedKeys[0] ?? "");
  if (!draggedNode) return null;
  const draggedType = registryTypeForBlock(draggedNode);

  // Build a list of {key, rect} for every top-level block unit that is a
  // valid drop zone and not part of the dragged selection.
  type Candidate = { key: NodeKey; rect: DOMRect; node: LexicalNode };
  const candidates: Candidate[] = [];
  for (const child of children) {
    const block = resolveBlockNodeFromLexicalNode(child);
    if (!block || block.getType() === "root") continue;
    const key = block.getKey();
    if (draggedKeys.includes(key)) continue;
    const el = editor.getElementByKey(key);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    candidates.push({ key, rect, node: block });
  }
  if (candidates.length === 0) return null;

  // Find the candidate whose midpoint Y is closest to the pointer Y.
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const mid = (candidates[i]!.rect.top + candidates[i]!.rect.bottom) / 2;
    const dist = Math.abs(mid - clientY);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  const best = candidates[bestIdx]!;
  const placement = resolveDropPlacement(clientY, best.rect.top, best.rect.height);

  const bestParent = best.node.getParent();
  const draggedParent = draggedNode.getParent();
  const validation = validateDropZone({
    draggedType,
    targetType: registryTypeForBlock(best.node),
    targetParentType: bestParent?.getType() ?? null,
    isTopLevel: bestParent?.getType() === "root",
    sourceParentKey: draggedParent?.getKey() ?? null,
    sourceParentType: draggedParent?.getType() ?? null,
    targetParentKey: bestParent?.getKey() ?? null,
    draggedUnit: getDraggableUnit(draggedType),
    targetToggleOpen: $isToggleNode(bestParent) ? bestParent.isOpen() : undefined,
  });
  if (!validation.valid) return null;

  return { key: best.key, placement, rect: best.rect, validation };
}

function selectedBlockKeys(): NodeKey[] {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return [];
  return uniqueKeys(
    selection
      .getNodes()
      .map((node) => resolveBlockNodeFromLexicalNode(node)?.getKey())
      .filter(Boolean) as NodeKey[],
  );
}

function resolveBlockKeyFromSelection(): { key: NodeKey; type: string } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchorNode = selection.anchor.getNode();
  const block = resolveBlockNodeFromLexicalNode(anchorNode);
  if (!block || block.getType() === "root") return null;
  return { key: block.getKey(), type: registryTypeForBlock(block) };
}

function siblingOrderFor(node: LexicalNode): NodeKey[] {
  const parent = node.getParent();
  return $isElementNode(parent) ? parent.getChildrenKeys() : [];
}

function parentKeyOf(key: NodeKey): NodeKey | null {
  const node = $getNodeByKey(key);
  return node?.getParent()?.getKey() ?? null;
}

function sameParent(keys: NodeKey[], targetKey: NodeKey): boolean {
  const target = $getNodeByKey(targetKey);
  const parentKey = target?.getParent()?.getKey();
  if (!parentKey) return false;
  return keys.every((key) => $getNodeByKey(key)?.getParent()?.getKey() === parentKey);
}

function siblingRange(anchorKey: NodeKey, targetKey: NodeKey): NodeKey[] {
  const anchor = $getNodeByKey(anchorKey);
  const target = $getNodeByKey(targetKey);
  const parent = anchor?.getParent();
  if (!anchor || !target || !parent || parent.getKey() !== target.getParent()?.getKey() || !$isElementNode(parent)) {
    return [anchorKey];
  }
  const order = parent.getChildrenKeys();
  const start = order.indexOf(anchorKey);
  const end = order.indexOf(targetKey);
  if (start < 0 || end < 0) return [anchorKey];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

function blockRectForKeys(editor: ReturnType<typeof useLexicalComposerContext>[0], keys: NodeKey[]): DOMRect | null {
  const rects = keys.map((key) => editor.getElementByKey(key)?.getBoundingClientRect()).filter(Boolean) as DOMRect[];
  if (!rects.length) return null;
  const top = Math.min(...rects.map((rect) => rect.top));
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function draggableKeysForHandle(handleKey: NodeKey): NodeKey[] {
  const handleNode = $getNodeByKey(handleKey);
  if (!handleNode) return [];

  const selected = selectedBlockKeys();
  if (!selected.includes(handleKey)) return [handleKey];

  const siblingOrder = siblingOrderFor(handleNode);
  return selected.length > 1 &&
    sameParent(selected, handleKey) &&
    areContiguousSiblings(selected, siblingOrder)
    ? selected
    : [handleKey];
}

function deepCopyNode<T extends LexicalNode>(node: T): T {
  const copy = $copyNode(node);
  if ($isElementNode(node) && $isElementNode(copy)) {
    for (const child of node.getChildren()) {
      copy.append(deepCopyNode(child));
    }
  }
  return copy;
}

function ensureRootHasEditableBlock(): void {
  const root = $getRoot();
  if (root.getChildrenSize() === 0) {
    const paragraph = $createParagraphNode();
    root.append(paragraph);
    paragraph.selectStart();
  }
}

export function insertParagraphNear(key: NodeKey, placement: DropPlacement): NodeKey | null {
  const node = $getNodeByKey(key);
  if (!node) return null;

  // PRD: gutter/menu insert near a list item must insert outside the whole list
  // wrapper, never between list item children (which would fragment the list).
  let topList: LexicalNode | null = null;
  let current: LexicalNode | null = node;
  while (current) {
    if ($isListNode(current)) topList = current;
    current = current.getParent();
  }

  const insertTarget: LexicalNode = topList ? topList : node;

  const paragraph = $createParagraphNode();
  if (placement === "before") {
    insertTarget.insertBefore(paragraph);
  } else {
    insertTarget.insertAfter(paragraph);
  }
  paragraph.selectStart();
  return paragraph.getKey();
}

function listItemToParagraph(node: LexicalNode): LexicalNode {
  const paragraph = $createParagraphNode();
  if ($isElementNode(node)) moveChildren(node, paragraph);
  node.replace(paragraph);
  return paragraph;
}

export function blockToListItem(node: LexicalNode): LexicalNode {
  const listItem = $createListItemNode();
  if ($isElementNode(node)) moveChildren(node, listItem);
  node.replace(listItem);
  return listItem;
}

function targetListNodeForKey(key: NodeKey): ListNode | null {
  const node = $getNodeByKey(key);
  if (!node) return null;
  if ($isListNode(node)) return node;
  const ancestor = findListAncestor(node);
  return ancestor ? (ancestor as ListNode) : null;
}

export function moveKeys(keys: NodeKey[], targetKey: NodeKey, placement: DropPlacement, options?: { convertListItemsToParagraph?: boolean; convertToListItem?: boolean }): boolean {
  const movingNodes = keys.map((key) => $getNodeByKey(key)).filter(Boolean) as LexicalNode[];
  const target = $getNodeByKey(targetKey);
  if (!target || movingNodes.length === 0 || movingNodes.includes(target)) return false;

  const draggedParentForMove = (movingNodes[0] ?? target).getParent();
  const targetParentForMove = target.getParent();
  const draggedTypeForMove = registryTypeForBlock(movingNodes[0] ?? target);
  const validation = validateDropZone({
    draggedType: draggedTypeForMove,
    targetType: registryTypeForBlock(target),
    targetParentType: targetParentForMove?.getType() ?? null,
    isTopLevel: targetParentForMove?.getType() === "root",
    sourceParentKey: draggedParentForMove?.getKey() ?? null,
    sourceParentType: draggedParentForMove?.getType() ?? null,
    targetParentKey: targetParentForMove?.getKey() ?? null,
    draggedUnit: getDraggableUnit(draggedTypeForMove),
    targetToggleOpen: $isToggleNode(targetParentForMove) ? targetParentForMove.isOpen() : undefined,
  });
  if (!validation.valid) return false;

  const shouldConvertToListItem = options?.convertToListItem && validation.convertToListItem;
  const nodesToMove = options?.convertListItemsToParagraph
    ? movingNodes.map((node) => ($isListItemNode(node) ? listItemToParagraph(node) : node))
    : shouldConvertToListItem
    ? movingNodes.map((node) => ($isListItemNode(node) ? node : blockToListItem(node)))
    : movingNodes;

  const targetParent = target.getParent();
  if ($isListNode(targetParent)) {
    const allListItems = nodesToMove.every((node) => $isListItemNode(node));
    if (!allListItems) return false;
  }

  if (placement === "before") {
    for (const node of nodesToMove) target.insertBefore(node);
  } else {
    for (const node of [...nodesToMove].reverse()) target.insertAfter(node);
  }
  const first = nodesToMove[0];
  if ($isElementNode(first)) first.selectStart();
  ensureRootHasEditableBlock();
  return true;
}

function createTextBlockForCommand(command: SlashCommand): ReturnType<typeof $createParagraphNode> | ReturnType<typeof $createHeadingNode> | ReturnType<typeof $createQuoteNode> | ReturnType<typeof $createCodeNode> | null {
  switch (command.id) {
    case "paragraph":
      return $createParagraphNode();
    case "h1":
      return $createHeadingNode("h1");
    case "h2":
      return $createHeadingNode("h2");
    case "h3":
      return $createHeadingNode("h3");
    case "quote":
      return $createQuoteNode();
    case "code":
      return $createCodeNode();
    default:
      return null;
  }
}

function moveChildren(from: LexicalNode, to: LexicalNode): void {
  if (!$isElementNode(from) || !$isElementNode(to)) return;
  const children = from.getChildren();
  for (const child of children) to.append(child);
}

function replaceListItemWithBlock(node: LexicalNode, replacement: LexicalNode): void {
  const list = node.getParent();
  if (!$isListItemNode(node) || !list || !$isListNode(list)) {
    node.replace(replacement);
    return;
  }
  if ($isElementNode(replacement)) moveChildren(node, replacement);
  const listType = (list as { getListType?: () => string }).getListType?.() ?? "bullet";
  const children = list.getChildren();
  const index = children.findIndex((child) => child.getKey() === node.getKey());
  const afterItems = index >= 0 ? children.slice(index + 1) : [];

  if (afterItems.length > 0 && index > 0) {
    const afterList = $createListNode(listType as "bullet" | "number" | "check");
    for (const item of afterItems) afterList.append(item);
    list.insertAfter(replacement);
    replacement.insertAfter(afterList);
    node.remove();
  } else if (index === 0) {
    list.insertBefore(replacement);
    node.remove();
  } else {
    list.insertAfter(replacement);
    node.remove();
  }
  if (list.getChildrenSize() === 0) list.remove();
}

function convertCodeToParagraphs(node: LexicalNode): void {
  const lines = node.getTextContent().split("\n");
  const paragraphs = lines.length ? lines.map((line) => {
    const paragraph = $createParagraphNode();
    if (line) paragraph.append($createTextNode(line));
    return paragraph;
  }) : [$createParagraphNode()];
  node.replace(paragraphs[0]!);
  let previous: LexicalNode = paragraphs[0]!;
  for (let i = 1; i < paragraphs.length; i += 1) {
    previous.insertAfter(paragraphs[i]!);
    previous = paragraphs[i]!;
  }
  paragraphs[0]?.selectStart();
}

function convertToggleToTextBlock(node: LexicalNode, command: SlashCommand): void {
  if (!$isToggleNode(node)) return;
  const replacement = createTextBlockForCommand(command) ?? $createParagraphNode();
  const children = node.getChildren();
  const [title, ...body] = children;
  if (title && $isElementNode(replacement) && $isElementNode(title)) moveChildren(title, replacement);
  node.replace(replacement);
  let previous: LexicalNode = replacement;
  for (const child of body) {
    previous.insertAfter(child);
    previous = child;
  }
  if ($isElementNode(replacement)) replacement.selectStart();
}

export function convertBlock(key: NodeKey, command: SlashCommand): void {
  const node = $getNodeByKey(key);
  if (!node) return;

  if (command.id === "toggle") {
    if ($isToggleNode(node) || $isTableNode(node)) return;
    const toggle = $createToggleNode(true, "");
    toggle.clear();
    const title = $createParagraphNode();
    if ($isElementNode(node)) moveChildren(node, title);
    const body = $createParagraphNode();
    toggle.append(title, body);
    if ($isListItemNode(node)) replaceListItemWithBlock(node, toggle);
    else node.replace(toggle);
    body.selectStart();
    return;
  }

  if ($isToggleNode(node)) {
    convertToggleToTextBlock(node, command);
    return;
  }

  if ($isCodeNode(node) && command.id === "paragraph") {
    convertCodeToParagraphs(node);
    return;
  }

  const replacement = createTextBlockForCommand(command);
  if (replacement) {
    if ($isListItemNode(node)) {
      replaceListItemWithBlock(node, replacement);
    } else {
      if ($isElementNode(node)) moveChildren(node, replacement);
      node.replace(replacement);
    }
    if ($isElementNode(replacement)) replacement.selectStart();
    return;
  }

  // List conversions are delegated to Lexical's list commands after selecting
  // the resolved block; Lexical preserves inline content and list state.
  if ($isElementNode(node)) node.selectStart();
  runNotesBlockCommand(command);
}

function copyBlockText(key: NodeKey): string {
  const node = $getNodeByKey(key);
  if (!node) return "";
  if ($isToggleNode(node)) {
    const firstChild = node.getFirstChild();
    return firstChild?.getTextContent() ?? "";
  }
  return node.getTextContent();
}

function duplicateBlock(key: NodeKey): void {
  const node = $getNodeByKey(key);
  if (!node) return;
  const copy = deepCopyNode(node);
  if ($isToggleNode(copy)) copy.setOpen(false);
  node.insertAfter(copy);
  if ($isElementNode(copy)) copy.selectStart();
}

function deleteBlock(key: NodeKey): void {
  const node = $getNodeByKey(key);
  if (!node) return;
  const next = node.getNextSibling();
  const previous = node.getPreviousSibling();
  node.remove();
  ensureRootHasEditableBlock();
  if ($isElementNode(next)) next.selectStart();
  else if ($isElementNode(previous)) previous.selectEnd();
}

function moveOne(key: NodeKey, direction: "up" | "down"): void {
  const node = $getNodeByKey(key);
  if (!node) return;
  const target = direction === "up" ? node.getPreviousSibling() : node.getNextSibling();
  if (!target) return;
  if (direction === "up") target.insertBefore(node);
  else target.insertAfter(node);
  if ($isElementNode(node)) node.selectStart();
}

function findListAncestor(node: LexicalNode): LexicalNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    const parent: LexicalNode | null = current.getParent();
    if ($isListNode(parent)) return parent;
    if (!parent || parent.getType() === "root" || $isToggleNode(parent)) return null;
    current = parent;
  }
  return null;
}

function copyBlockPlainText(key: NodeKey): string {
  const node = $getNodeByKey(key);
  if (!node) return "";
  if ($isTableNode(node)) {
    const rows: string[] = [];
    for (const row of node.getChildren()) {
      if (!$isElementNode(row)) continue;
      const cells: string[] = [];
      for (const cell of row.getChildren()) {
        cells.push(cell.getTextContent());
      }
      rows.push(cells.join("\t"));
    }
    return rows.join("\n");
  }
  if ($isToggleNode(node)) {
    return node.getFirstChild()?.getTextContent() ?? "";
  }
  return node.getTextContent();
}

// ─── Menu Button ──────────────────────────────────────────────────────────────

function MenuButton({
  children,
  onClick,
  isActive,
  disabled,
  onMouseEnter,
}: {
  children: ReactNode;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`notes-block-menu-button ${isActive ? "notes-block-menu-button-active" : ""}`}
      disabled={disabled}
      aria-disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </button>
  );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function NotesBlockControlsPlugin() {
  const [editor] = useLexicalComposerContext();
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [multiSelect, setMultiSelect] = useState<MultiSelectState | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    keys: NodeKey[];
    top: number;
    left: number;
    label: string;
  } | null>(null);
  const [placeholder, setPlaceholder] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [copyToast, setCopyToast] = useState<{ top: number; left: number } | null>(null);

  const draggedKeysRef = useRef<NodeKey[]>([]);
  const dropRef = useRef<DropState | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const touchLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isComposingRef = useRef(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const editable = editor.isEditable();
  dropRef.current = drop;

  // ── Hovered rect refresh ──────────────────────────────────────────────────

  const refreshHoveredRect = useCallback(
    (key: NodeKey, type: string) => {
      const element = editor.getElementByKey(key);
      if (!element) {
        setHovered(null);
        return;
      }
      setHovered({ key, type, rect: element.getBoundingClientRect() });
    },
    [editor],
  );

  // ── Show controls for resolved block ──────────────────────────────────────

  const showControlsForResolvedBlock = useCallback(
    (resolved: { key: NodeKey; type: string } | null, pointerTarget: HTMLElement | null = null) => {
      if (!resolved) return;

      // Code blocks: per PRD section 08, the drag handle and `+` button are
      // shown on the code block's outer shell, never over the code text. When
      // we have a pointer target (pointer-move / long-press path) require the
      // target to be the shell element itself. When we don't (focus / update
      // path) fall back to the active-selection ancestor — if the selection
      // is inside the code text the controls stay hidden.
      if (resolved.type === "code") {
        const shellElement = editor.getElementByKey(resolved.key);
        if (pointerTarget) {
          if (!isCodeBlockShellDomTarget(pointerTarget, shellElement)) return;
        } else if (isActiveSelectionInsideCodeBlock(editor)) {
          return;
        }
      } else if (!shouldExposeSlashLikeControls(resolved.type)) {
        return;
      }

      const element = editor.getElementByKey(resolved.key);
      if (!element) return;
      setHovered({ key: resolved.key, type: resolved.type, rect: element.getBoundingClientRect() });
    },
    [editor],
  );

  // ── Hide controls with fade delay ─────────────────────────────────────────

  useEffect(() => {
    if (!hovered) {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      return;
    }
  }, [hovered]);

  const hideControls = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setHovered(null);
      fadeTimerRef.current = null;
    }, FAOUT_DELAY_MS);
  }, []);

  // ── Pointer move / hover detection ────────────────────────────────────────

  useEffect(() => {
    if (!editable) return;

    let activeRoot: HTMLElement | null = null;

    const onPointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (controlsRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      if (!activeRoot?.contains(target)) return;

      if (isDraggingRef.current || isComposingRef.current) return;

      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        editor.getEditorState().read(() => {
          const resolved = resolveBlockKeyFromDom(target);
          if (!resolved) {
            hideControls();
            return;
          }
          showControlsForResolvedBlock(resolved, target);
        });
      });
    };

    const onPointerLeave = (event: PointerEvent) => {
      const related = event.relatedTarget;
      if (related instanceof Node && controlsRef.current?.contains(related)) return;
      if (related instanceof Node && menuRef.current?.contains(related)) return;
      hideControls();
    };

    const onCompositionStart = () => {
      isComposingRef.current = true;
      setMenu(null);
    };

    const onCompositionEnd = () => {
      isComposingRef.current = false;
    };

    const clearTouchTimer = () => {
      if (touchLongPressTimerRef.current) clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
      touchStartRef.current = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (isComposingRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !activeRoot?.contains(target)) return;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchLongPressTimerRef.current = setTimeout(() => {
        editor.getEditorState().read(() => {
          const resolved = resolveBlockKeyFromDom(target);
          if (!resolved) return;
          // Mirror the pointer-move guard: code blocks only open the menu on
          // shell long-press, never from a press inside the code text.
          if (resolved.type === "code") {
            const shell = editor.getElementByKey(resolved.key);
            if (!isCodeBlockShellDomTarget(target, shell)) return;
          }
          const rect = editor.getElementByKey(resolved.key)?.getBoundingClientRect();
          if (!rect) return;
          setHovered({ key: resolved.key, type: resolved.type, rect });
          setMenu({ key: resolved.key, type: resolved.type, top: rect.top, left: Math.max(8, rect.left - 38), activeIndex: 0 });
        });
      }, 500);
    };

    const onTouchMove = (event: TouchEvent) => {
      const start = touchStartRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      if (Math.abs(touch.clientX - start.x) > DRAG_THRESHOLD_PX || Math.abs(touch.clientY - start.y) > DRAG_THRESHOLD_PX) {
        clearTouchTimer();
      }
    };

    const unregisterRoot = editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("pointermove", onPointerMove);
      previousRootElement?.removeEventListener("pointerleave", onPointerLeave);
      previousRootElement?.removeEventListener("compositionstart", onCompositionStart);
      previousRootElement?.removeEventListener("compositionend", onCompositionEnd);
      previousRootElement?.removeEventListener("touchstart", onTouchStart);
      previousRootElement?.removeEventListener("touchmove", onTouchMove);
      previousRootElement?.removeEventListener("touchend", clearTouchTimer);
      previousRootElement?.removeEventListener("touchcancel", clearTouchTimer);
      activeRoot = rootElement;
      rootElement?.addEventListener("pointermove", onPointerMove);
      rootElement?.addEventListener("pointerleave", onPointerLeave);
      rootElement?.addEventListener("compositionstart", onCompositionStart);
      rootElement?.addEventListener("compositionend", onCompositionEnd);
      rootElement?.addEventListener("touchstart", onTouchStart);
      rootElement?.addEventListener("touchmove", onTouchMove);
      rootElement?.addEventListener("touchend", clearTouchTimer);
      rootElement?.addEventListener("touchcancel", clearTouchTimer);
    });

    return () => {
      activeRoot?.removeEventListener("pointermove", onPointerMove);
      activeRoot?.removeEventListener("pointerleave", onPointerLeave);
      activeRoot?.removeEventListener("compositionstart", onCompositionStart);
      activeRoot?.removeEventListener("compositionend", onCompositionEnd);
      activeRoot?.removeEventListener("touchstart", onTouchStart);
      activeRoot?.removeEventListener("touchmove", onTouchMove);
      activeRoot?.removeEventListener("touchend", clearTouchTimer);
      activeRoot?.removeEventListener("touchcancel", clearTouchTimer);
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
      clearTouchTimer();
      unregisterRoot();
    };
  }, [editable, editor, hideControls, showControlsForResolvedBlock]);

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editable) return;

    let activeRoot: HTMLElement | null = null;

    const resolveDropFromEvent = (event: DragEvent): DropState | null => {
      if (!event.dataTransfer?.types.includes(DRAG_FORMAT)) return null;
      if (!activeRoot) return null;

      // Primary: geometry-based resolver — works in whitespace and gutter.
      const geo = resolveDropByGeometry(event.clientX, event.clientY, activeRoot!, editor, draggedKeysRef.current);
      if (geo) {
        if (sameParent(draggedKeysRef.current, geo.key)) {
          const targetNode = $getNodeByKey(geo.key);
          const decision = decideSiblingDrop({
            selectedKeys: draggedKeysRef.current,
            targetKey: geo.key,
            siblingOrder: targetNode ? siblingOrderFor(targetNode) : [],
            sameParent: true,
          });
          if (!decision.allowed) return null;
        }
        return {
          targetKey: geo.key,
          placement:geo.placement,
          top: geo.placement === "before" ? geo.rect.top : geo.rect.bottom,
          left: geo.rect.left,
          width: geo.rect.width,
          convertToParagraph: geo.validation.convertToParagraph,
          convertToListItem: geo.validation.convertToListItem,
        };
      }

      // Fallback: element-under-cursor resolution (handles nested structures
      // like table cells that are not enumerated by the top-level scan).
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!(target instanceof HTMLElement)) return null;
      const isInsideOrWrapper = activeRoot!.contains(target) || target.contains(activeRoot!);
      if (!isInsideOrWrapper) return null;

      const resolved = resolveBlockKeyFromDom(target);
      if (!resolved) return null;
      const targetNode = $getNodeByKey(resolved.key);
      const draggedNode = $getNodeByKey(draggedKeysRef.current[0] ?? "");
      if (!targetNode || !draggedNode || draggedKeysRef.current.includes(resolved.key)) return null;

      if (sameParent(draggedKeysRef.current, resolved.key)) {
        const decision = decideSiblingDrop({
          selectedKeys: draggedKeysRef.current,
          targetKey: resolved.key,
          siblingOrder: siblingOrderFor(targetNode),
          sameParent: true,
        });
        if (!decision.allowed) return null;
      }

      const evtTargetParent = targetNode.getParent();
      const evtDraggedParent = draggedNode.getParent();
      const evtDraggedType = registryTypeForBlock(draggedNode);
      const validation = validateDropZone({
        draggedType: evtDraggedType,
        targetType: registryTypeForBlock(targetNode),
        targetParentType: evtTargetParent?.getType() ?? null,
        isTopLevel: evtTargetParent?.getType() === "root",
        sourceParentKey: evtDraggedParent?.getKey() ?? null,
        sourceParentType: evtDraggedParent?.getType() ?? null,
        targetParentKey: evtTargetParent?.getKey() ?? null,
        draggedUnit: getDraggableUnit(evtDraggedType),
        targetToggleOpen: $isToggleNode(evtTargetParent) ? evtTargetParent.isOpen() : undefined,
      });
      if (!validation.valid) return null;

      const rect = editor.getElementByKey(resolved.key)?.getBoundingClientRect();
      if (!rect) return null;
      const placement = resolveDropPlacement(event.clientY, rect.top, rect.height);
      return {
        targetKey: resolved.key,
        placement,
        top: placement === "before" ? rect.top : rect.bottom,
        left: rect.left,
        width: rect.width,
        convertToParagraph: validation.convertToParagraph,
        convertToListItem: validation.convertToListItem,
      };
    };

    const onDragOver = (event: DragEvent) => {
      const nextDrop = resolveDropFromEvent(event);
      if (!nextDrop) {
        if (dropRef.current) setDrop(null);
        event.dataTransfer!.dropEffect = "none";
        event.preventDefault();
        return;
      }
      event.preventDefault();
      event.dataTransfer!.dropEffect = "move";
      setDrop(nextDrop);
    };

    const onDrop = (event: DragEvent) => {
      const activeDrop = dropRef.current ?? resolveDropFromEvent(event);
      if (!activeDrop || !event.dataTransfer?.types.includes(DRAG_FORMAT)) return;
      event.preventDefault();
      const keys = draggedKeysRef.current;

      editor.update(() => {
        moveKeys(keys, activeDrop.targetKey, activeDrop.placement, {
          convertListItemsToParagraph: activeDrop.convertToParagraph,
          convertToListItem: activeDrop.convertToListItem,
        });
      });

      draggedKeysRef.current = [];
      isDraggingRef.current = false;
      setDrop(null);
      setDragPreview(null);
      setPlaceholder(null);
    };

    const onDragEnd = () => {
      draggedKeysRef.current = [];
      isDraggingRef.current = false;
      setDrop(null);
      setDragPreview(null);
      setPlaceholder(null);
    };

    const onScrollOrResize = () => {
      const current = hovered;
      if (current) refreshHoveredRect(current.key, current.type);
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    const unregisterRoot = editor.registerRootListener((rootElement) => {
      activeRoot = rootElement;
    });

    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      unregisterRoot();
    };
  }, [editable, editor, hovered, refreshHoveredRect]);

  // ── Multi-select styling ──────────────────────────────────────────────────

  useEffect(() => {
    const selected = new Set(multiSelect?.keys ?? []);
    const touched: HTMLElement[] = [];
    for (const key of selected) {
      const element = editor.getElementByKey(key);
      if (element) {
        element.classList.add("notes-block-selected");
        touched.push(element);
      }
    }
    return () => {
      for (const element of touched) element.classList.remove("notes-block-selected");
    };
  }, [editor, multiSelect]);

  // ── Menu outside-click handler ────────────────────────────────────────────

  useEffect(() => {
    if (!menu) return;
    window.requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']");
      first?.focus();
    });
  }, [menu?.key]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || controlsRef.current?.contains(target))
      )
        return;
      setMenu(null);
      editor.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menu]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (menu) {
          event?.preventDefault();
          setMenu(null);
          editor.focus();
          return true;
        }
        if (multiSelect) {
          event?.preventDefault();
          setMultiSelect(null);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, menu, multiSelect]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (!editor.isEditable()) return false;

        if (menu) {
          const items = Array.from(document.querySelectorAll<HTMLButtonElement>(".notes-block-menu [role='menuitem']"));
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const next = (menu.activeIndex + direction + Math.max(items.length, 1)) % Math.max(items.length, 1);
            setMenu({ ...menu, activeIndex: next });
            window.requestAnimationFrame(() => items[next]?.focus());
            return true;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            items[menu.activeIndex]?.click();
            return true;
          }
        }

        if ((event.ctrlKey || event.metaKey) && event.key === "/") {
          if (isActiveSelectionInsideCodeBlock(editor)) return false;
          const block = editor.getEditorState().read(() => resolveBlockKeyFromSelection());
          if (!block) return false;
          const rect = editor.getElementByKey(block.key)?.getBoundingClientRect();
          if (!rect) return false;
          event.preventDefault();
          setMenu({ key: block.key, type: block.type, top: rect.top, left: Math.max(8, rect.left - 38), activeIndex: 0 });
          return true;
        }

        if (event.altKey && event.key === "Enter") {
          if (isActiveSelectionInsideCodeBlock(editor)) return false;
          const block = editor.getEditorState().read(() => resolveBlockKeyFromSelection());
          if (!block) return false;
          event.preventDefault();
          editor.update(() => {
            const paragraphKey = insertParagraphNear(block.key, "after");
            if (paragraphKey) editor.dispatchCommand(OPEN_PICKER_FOR_NODE_COMMAND, paragraphKey);
          });
          return true;
        }

        if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          const block = editor.getEditorState().read(() => resolveBlockKeyFromSelection());
          if (!block) return false;
          event.preventDefault();
          editor.update(() => moveOne(block.key, event.key === "ArrowUp" ? "up" : "down"));
          return true;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
          const block = editor.getEditorState().read(() => resolveBlockKeyFromSelection());
          if (!block) return false;
          event.preventDefault();
          editor.update(() => duplicateBlock(block.key));
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, menu]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
          const block = editor.getEditorState().read(() => resolveBlockKeyFromSelection());
          if (block && editor.isEditable()) {
            event.preventDefault();
            editor.update(() => deleteBlock(block.key));
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  // ── Visible commands for "Turn into" ──────────────────────────────────────

  const visibleCommands = useMemo(() => {
    if (!menu) return [];
    const entry = getBlockRegistryEntry(menu.type);
    const allowedIds = entry?.convertibleTo ?? [];
    if (menu.type === "table") return [];
    return TURN_INTO_COMMANDS.filter((cmd) => allowedIds.includes(cmd.id));
  }, [menu]);

  // ── Copy toast timer ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!copyToast) return;
    const timer = setTimeout(() => setCopyToast(null), 1500);
    return () => clearTimeout(timer);
  }, [copyToast]);

  // ── Nothing to render ─────────────────────────────────────────────────────

  if (!editable || (!hovered && !menu && !drop && !dragPreview && !copyToast)) return null;

  // ── Controls position ─────────────────────────────────────────────────────

  const rootElement = editor.getRootElement();
  const rootLeft = rootElement?.getBoundingClientRect().left ?? (hovered?.rect.left ?? 0);
  
  const controlTop = hovered
    ? hovered.rect.top + Math.min(8, Math.max(0, hovered.rect.height / 2 - 14))
    : 0;
  const controlLeft = hovered ? Math.max(8, rootLeft - 72) : 0;
  const multiSelectRect = multiSelect?.keys.length ? blockRectForKeys(editor, multiSelect.keys) : null;

  const openMenu = () => {
    if (!hovered || isComposingRef.current || isDraggingRef.current) return;
    // PRD section 08: don't open the block menu while the active selection is
    // inside code text — code blocks manage their own cursor.
    if (isActiveSelectionInsideCodeBlock(editor)) return;
    setMenu({
      key: hovered.key,
      type: hovered.type,
      top: controlTop,
      left: controlLeft + 34,
      activeIndex: 0,
    });
  };

  const runUpdate = (fn: () => void) => {
    if (!editor.isEditable()) return;
    editor.focus();
    editor.update(fn);
    setMenu(null);
  };

  const insertAndOpenPicker = (key: NodeKey, placement: DropPlacement) => {
    if (isActiveSelectionInsideCodeBlock(editor)) return;
    runUpdate(() => {
      const paragraphKey = insertParagraphNear(key, placement);
      if (paragraphKey) editor.dispatchCommand(OPEN_PICKER_FOR_NODE_COMMAND, paragraphKey);
    });
  };

  const resolveDropFromPoint = (clientX: number, clientY: number): DropState | null => {
    const root = editor.getRootElement();
    if (!root) return null;

    return editor.getEditorState().read(() => {
      const keys = draggedKeysRef.current;

      // Primary: geometry-based resolver — works in whitespace and gutter.
      const geo = resolveDropByGeometry(clientX, clientY, root, editor, keys);
      if (geo) {
        if (sameParent(keys, geo.key)) {
          const targetNode = $getNodeByKey(geo.key);
          const decision = decideSiblingDrop({
            selectedKeys: keys,
            targetKey: geo.key,
            siblingOrder: targetNode ? siblingOrderFor(targetNode) : [],
            sameParent: true,
          });
          if (!decision.allowed) return null;
        }
        return {
          targetKey: geo.key,
          placement: geo.placement,
          top: geo.placement === "before" ? geo.rect.top : geo.rect.bottom,
          left: geo.rect.left,
          width: geo.rect.width,
          convertToParagraph: geo.validation.convertToParagraph,
          convertToListItem: geo.validation.convertToListItem,
        };
      }

      // Fallback: element-under-cursor resolution (handles nested structures).
      const target = document.elementFromPoint(clientX, clientY);
      if (!(target instanceof HTMLElement)) return null;
      const isInsideOrWrapper = root.contains(target) || target.contains(root);
      if (!isInsideOrWrapper) return null;

      const resolved = resolveBlockKeyFromDom(target);
      if (!resolved) return null;
      const targetNode = $getNodeByKey(resolved.key);
      const draggedNode = $getNodeByKey(keys[0] ?? "");
      if (!targetNode || !draggedNode || keys.includes(resolved.key)) return null;

      if (sameParent(keys, resolved.key)) {
        const decision = decideSiblingDrop({
          selectedKeys: keys,
          targetKey: resolved.key,
          siblingOrder: siblingOrderFor(targetNode),
          sameParent: true,
        });
        if (!decision.allowed) return null;
      }

      const ptTargetParent = targetNode.getParent();
      const ptDraggedParent = draggedNode.getParent();
      const ptDraggedType = registryTypeForBlock(draggedNode);
      const validation = validateDropZone({
        draggedType: ptDraggedType,
        targetType: registryTypeForBlock(targetNode),
        targetParentType: ptTargetParent?.getType() ?? null,
        isTopLevel: ptTargetParent?.getType() === "root",
        sourceParentKey: ptDraggedParent?.getKey() ?? null,
        sourceParentType: ptDraggedParent?.getType() ?? null,
        targetParentKey: ptTargetParent?.getKey() ?? null,
        draggedUnit: getDraggableUnit(ptDraggedType),
        targetToggleOpen: $isToggleNode(ptTargetParent) ? ptTargetParent.isOpen() : undefined,
      });
      if (!validation.valid) return null;

      const rect = editor.getElementByKey(resolved.key)?.getBoundingClientRect();
      if (!rect) return null;
      const placement = resolveDropPlacement(clientY, rect.top, rect.height);
      return {
        targetKey: resolved.key,
        placement,
        top: placement === "before" ? rect.top : rect.bottom,
        left: rect.left,
        width: rect.width,
        convertToParagraph: validation.convertToParagraph,
        convertToListItem: validation.convertToListItem,
      };
    });
  };

  const clearDragDecorations = () => {
    for (const key of draggedKeysRef.current) {
      editor.getElementByKey(key)?.removeAttribute("data-drag-placeholder");
    }
  };

  const startGripPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!hovered || isComposingRef.current || !editor.isEditable()) return;
    event.preventDefault();
    event.stopPropagation();
    const { keys, label } = editor.getEditorState().read(() => {
      const nextKeys = draggableKeysForHandle(hovered.key);
      const blockNode = $getNodeByKey(hovered.key);
      return {
        keys: nextKeys,
        label: blockNode?.getTextContent()?.slice(0, 40) ?? "Block",
      };
    });
    draggedKeysRef.current = keys;
    dragStartPosRef.current = { x: event.clientX, y: event.clientY };
    isDraggingRef.current = false;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    const cleanup = () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.body.style.cursor = "";
      dragStartPosRef.current = null;
      clearDragDecorations();
    };

    const beginDrag = (clientX: number, clientY: number) => {
      isDraggingRef.current = true;
      window.getSelection()?.removeAllRanges();
      setMenu(null);
      setHovered(null);
      document.body.style.cursor = "grabbing";
      for (const key of keys) {
        const element = editor.getElementByKey(key);
        element?.setAttribute("data-drag-placeholder", "true");
      }
      setDragPreview({
        keys,
        top: clientY - 20,
        left: clientX + 10,
        label: keys.length > 1 ? `${label} and ${keys.length - 1} more` : label,
      });
    };

    function onPointerMove(moveEvent: PointerEvent) {
      const start = dragStartPosRef.current;
      if (!start) return;
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (!isDraggingRef.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        beginDrag(moveEvent.clientX, moveEvent.clientY);
      }
      moveEvent.preventDefault();
      setDragPreview((prev) =>
        prev ? { ...prev, top: moveEvent.clientY - 20, left: moveEvent.clientX + 10 } : prev,
      );
      const nextDrop = resolveDropFromPoint(moveEvent.clientX, moveEvent.clientY);
      setDrop(nextDrop);
    }

    function onPointerUp(upEvent: PointerEvent) {
      upEvent.preventDefault();
      const didDrag = isDraggingRef.current;
      if (didDrag) {
        const activeDrop = dropRef.current ?? resolveDropFromPoint(upEvent.clientX, upEvent.clientY);
        if (activeDrop) {
          editor.update(() => {
            moveKeys(draggedKeysRef.current, activeDrop.targetKey, activeDrop.placement, {
              convertListItemsToParagraph: activeDrop.convertToParagraph,
              convertToListItem: activeDrop.convertToListItem,
            });
          });
        }
      } else {
        openMenu();
      }
      isDraggingRef.current = false;
      setDrop(null);
      setDragPreview(null);
      setPlaceholder(null);
      cleanup();
      draggedKeysRef.current = [];
    }

    function onPointerCancel() {
      isDraggingRef.current = false;
      setDrop(null);
      setDragPreview(null);
      setPlaceholder(null);
      cleanup();
      draggedKeysRef.current = [];
    }

    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
  };

  const startGutterSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hovered || !editor.isEditable() || event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest("button")) return;
    event.preventDefault();
    const currentKey = hovered.key;
    if (event.shiftKey && multiSelect?.anchorKey) {
      const keys = editor.getEditorState().read(() => siblingRange(multiSelect.anchorKey, currentKey));
      setMultiSelect({ anchorKey: multiSelect.anchorKey, keys });
      return;
    }

    setMultiSelect({ anchorKey: currentKey, keys: [currentKey] });
    const startY = event.clientY;
    const anchorKey = currentKey;

    const onMove = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!(target instanceof HTMLElement)) return;
      editor.getEditorState().read(() => {
        const resolved = resolveBlockKeyFromDom(target);
        if (!resolved) return;
        const keys = siblingRange(anchorKey, resolved.key);
        setMultiSelect({ anchorKey, keys });
      });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  };

  // ── Portal ────────────────────────────────────────────────────────────────

  const portal = (
    <>
      {hovered && !isDraggingRef.current ? (
        <div
          ref={controlsRef}
          className="notes-block-controls"
          style={{ top: controlTop, left: controlLeft }}
          onPointerDown={startGutterSelection}
          onMouseEnter={() => {
            if (fadeTimerRef.current) {
              clearTimeout(fadeTimerRef.current);
              fadeTimerRef.current = null;
            }
            refreshHoveredRect(hovered.key, hovered.type);
          }}
          onMouseLeave={hideControls}
        >
          <button
            type="button"
            className="notes-block-control-button notes-block-grip"
            aria-label="Block options"
            aria-grabbed={isDraggingRef.current}
            onPointerDown={startGripPointerDrag}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openMenu();
              }
            }}
            onMouseEnter={() => {
              tooltipTimerRef.current = setTimeout(() => setShowTooltip(true), TOOLTIP_DELAY_MS);
            }}
            onMouseLeave={() => {
              if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
              setShowTooltip(false);
            }}
          >
            <GripVertical size={18} />
            {showTooltip && (
              <span className="notes-block-tooltip">Drag to move · Click for options</span>
            )}
          </button>
        </div>
      ) : null}

      {drop ? (
        <div
          className="notes-block-drop-line"
          style={{ top: drop.top, left: drop.left, width: drop.width }}
          aria-hidden="true"
        />
      ) : null}

      {dragPreview ? (
        <div
          className="notes-block-drag-preview"
          style={{ top: dragPreview.top, left: dragPreview.left }}
          aria-hidden="true"
        >
          <GripVertical size={14} />
          <span className="notes-block-drag-preview-text">{dragPreview.label}</span>
        </div>
      ) : null}

      {menu ? (
        <div
          ref={menuRef}
          className="notes-block-menu"
          style={{ top: menu.top, left: menu.left, width: MENU_WIDTH_PX }}
          role="menu"
          aria-label="Block actions"
        >
          <div className="notes-block-menu-section">
            <MenuButton onClick={() => insertAndOpenPicker(menu.key, "before")}>
              <ListPlus size={15} /> Insert above
            </MenuButton>
            <MenuButton onClick={() => insertAndOpenPicker(menu.key, "after")}>
              <Plus size={15} /> Insert below
            </MenuButton>
          </div>

          <div className="notes-block-menu-section">
            <MenuButton onClick={() => runUpdate(() => duplicateBlock(menu.key))}>
              <Copy size={15} /> Duplicate
            </MenuButton>
            <MenuButton
              onClick={() => {
                const text = editor.getEditorState().read(() => copyBlockPlainText(menu.key));
                void navigator.clipboard?.writeText(text);
                const rect = editor.getElementByKey(menu.key)?.getBoundingClientRect();
                if (rect) setCopyToast({ top: rect.top - 32, left: rect.left });
                setMenu(null);
              }}
            >
              <Copy size={15} /> Copy text
            </MenuButton>
            <MenuButton onClick={() => runUpdate(() => deleteBlock(menu.key))}>
              <Trash2 size={15} /> Delete
            </MenuButton>
          </div>

          <div className="notes-block-menu-section">
            <MenuButton onClick={() => runUpdate(() => moveOne(menu.key, "up"))}>
              <ArrowUp size={15} /> Move up
            </MenuButton>
            <MenuButton onClick={() => runUpdate(() => moveOne(menu.key, "down"))}>
              <ArrowDown size={15} /> Move down
            </MenuButton>
          </div>

          {visibleCommands.length > 0 ? (
            <>
              <div className="notes-block-menu-heading">Turn into</div>
              <div className="notes-block-menu-section">
                {visibleCommands.map((command) => (
                  <MenuButton
                    key={command.id}
                    isActive={command.id === menu.type}
                    onClick={() => runUpdate(() => convertBlock(menu.key, command))}
                  >
                    <span className="notes-block-menu-dot" /> {commandLabel(command)}
                  </MenuButton>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {multiSelect && multiSelect.keys.length > 1 && multiSelectRect ? (
        <div
          className="notes-block-multisel-toolbar"
          role="toolbar"
          aria-label="Selected blocks"
          style={{ top: Math.max(8, multiSelectRect.top - 42), left: multiSelectRect.left }}
        >
          <MenuButton
            onClick={() =>
              runUpdate(() => {
                for (const key of multiSelect.keys) deleteBlock(key);
                setMultiSelect(null);
              })
            }
          >
            <Trash2 size={14} /> Delete selected
          </MenuButton>
          <MenuButton
            onClick={() =>
              runUpdate(() => {
                for (const key of [...multiSelect.keys].reverse()) duplicateBlock(key);
                setMultiSelect(null);
              })
            }
          >
            <Copy size={14} /> Duplicate selected
          </MenuButton>
          <MenuButton
            onClick={() =>
              runUpdate(() => {
                for (const key of multiSelect.keys) moveOne(key, "up");
                setMultiSelect(null);
              })
            }
          >
            <ArrowUp size={14} /> Move up
          </MenuButton>
          <MenuButton
            onClick={() =>
              runUpdate(() => {
                for (const key of [...multiSelect.keys].reverse()) moveOne(key, "down");
                setMultiSelect(null);
              })
            }
          >
            <ArrowDown size={14} /> Move down
          </MenuButton>
        </div>
      ) : null}

      {copyToast ? (
        <div
          className="notes-block-copy-toast"
          style={{ top: copyToast.top, left: copyToast.left }}
          role="status"
        >
          Copied
        </div>
      ) : null}
    </>
  );

  return createPortal(portal, document.body);
}
