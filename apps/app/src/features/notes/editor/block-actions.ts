/**
 * The block menu's actions (NR-4, AC7): Turn into · Duplicate · Delete. Run
 * inside `editor.update`. Comment opens the Comments panel (anchored threads
 * arrive with NR-8).
 */

import { $createCodeNode } from "@lexical/code";
import {
  $insertList,
  $isListItemNode,
  $isListNode,
  type ListNode,
  type ListType,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $parseSerializedNode,
  type ElementNode,
  type LexicalNode,
  type SerializedLexicalNode,
} from "lexical";

import { TaskLineNode } from "./schema/task-line-node";

export type TurnIntoId =
  "text" | "h1" | "h2" | "h3" | "bullet" | "number" | "todo" | "quote" | "code";

export const TURN_INTO: ReadonlyArray<{ id: TurnIntoId; label: string }> = [
  { id: "text", label: "Text" },
  { id: "h1", label: "Heading 1" },
  { id: "h2", label: "Heading 2" },
  { id: "h3", label: "Heading 3" },
  { id: "bullet", label: "Bulleted list" },
  { id: "number", label: "Numbered list" },
  { id: "todo", label: "Checkbox list" },
  { id: "quote", label: "Quote" },
  { id: "code", label: "Code" },
];

/** What the menu may offer for this block. A task line keeps its own menu
 * (turning or copying it would orphan or double its task); a decorator block
 * (page row, divider, embed) and a table have no text to turn. */
export function $blockMenuFor(block: LexicalNode): { turnInto: boolean; duplicate: boolean } {
  if (block instanceof TaskLineNode) return { turnInto: false, duplicate: false };
  if ($isDecoratorNode(block)) return { turnInto: false, duplicate: false };
  if (block.getType() === "table") return { turnInto: false, duplicate: true };
  return { turnInto: true, duplicate: true };
}

/** A block of words that can become a task or a subpage (Turn into → Task,
 * Page): a paragraph, heading or quote holding text. Lists, code, tables and
 * task lines can't (a list turns per item, with ⌘⇧T). */
export function $isTextBlock(block: LexicalNode): boolean {
  if (!$isParagraphNode(block) && !$isHeadingNode(block) && !$isQuoteNode(block)) return false;
  return block.getTextContent().trim() !== "";
}

/** Run one block command on the current selection (the slash menu's Basics
 * use it too). */
export function $runBlockCommand(id: TurnIntoId): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  switch (id) {
    case "text":
      $setBlocksType(selection, () => $createParagraphNode());
      break;
    case "h1":
    case "h2":
    case "h3":
      $setBlocksType(selection, () => $createHeadingNode(id));
      break;
    case "bullet":
      $insertList("bullet");
      break;
    case "number":
      $insertList("number");
      break;
    case "todo":
      $insertList("check");
      break;
    case "quote":
      $setBlocksType(selection, () => $createQuoteNode());
      break;
    case "code":
      $setBlocksType(selection, () => $createCodeNode());
      break;
  }
}

/** A new block of kind `id` (a text kind; lists are handled apart). */
function $createBlockOf(id: TurnIntoId): ElementNode {
  switch (id) {
    case "h1":
    case "h2":
    case "h3":
      return $createHeadingNode(id);
    case "quote":
      return $createQuoteNode();
    case "code":
      return $createCodeNode();
    default:
      return $createParagraphNode();
  }
}

/** A list's items, nested ones included, as their inline content. */
function $listLines(list: ListNode): LexicalNode[][] {
  const lines: LexicalNode[][] = [];
  for (const item of list.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const inline = item.getChildren().filter((c) => !$isListNode(c));
    if (inline.length > 0) lines.push(inline);
    for (const nested of item.getChildren())
      if ($isListNode(nested)) lines.push(...$listLines(nested));
  }
  return lines;
}

const LIST_TYPE: Partial<Record<TurnIntoId, ListType>> = {
  bullet: "bullet",
  number: "number",
  todo: "check",
};

/**
 * Turn the whole block into `id`; the caret ends at the end of what it
 * became (not a stray selection under the format toolbar). A list was a
 * no-op: the commands need a text selection, a list block isn't one. A list
 * changes type in place, or becomes one block per item.
 */
export function $turnBlockInto(block: LexicalNode, id: TurnIntoId): void {
  if (!$isElementNode(block) || !$blockMenuFor(block).turnInto) return;
  if ($isListNode(block)) {
    const listType = LIST_TYPE[id];
    if (listType) {
      block.setListType(listType);
      block.selectEnd();
      return;
    }
    let last: ElementNode | null = null;
    for (const line of $listLines(block)) {
      const next = $createBlockOf(id);
      next.append(...line);
      (last ?? block).insertAfter(next);
      last = next;
    }
    block.remove();
    last?.selectEnd();
    return;
  }
  block.select(0, block.getChildrenSize());
  $runBlockCommand(id);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.anchor.getNode().getTopLevelElement()?.selectEnd();
  }
}

function $deepJSON(node: LexicalNode): SerializedLexicalNode {
  const json = node.exportJSON() as SerializedLexicalNode & { children?: unknown[] };
  if ($isElementNode(node)) json.children = node.getChildren().map($deepJSON);
  return json;
}

/** Insert a copy of the block right under it; the caret moves into the copy. */
export function $duplicateBlock(block: LexicalNode): LexicalNode | null {
  if (!$blockMenuFor(block).duplicate) return null;
  const copy = $parseSerializedNode($deepJSON(block));
  block.insertAfter(copy);
  if ($isElementNode(copy)) copy.selectEnd();
  return copy;
}

/** Remove the block, keeping one empty paragraph in an emptied note. */
export function $deleteBlock(block: LexicalNode): void {
  const next = block.getNextSibling() ?? block.getPreviousSibling();
  block.remove();
  const root = $getRoot();
  if (root.getChildrenSize() === 0) {
    const p = $createParagraphNode();
    root.append(p);
    p.select();
    return;
  }
  if ($isElementNode(next)) next.selectStart();
}
