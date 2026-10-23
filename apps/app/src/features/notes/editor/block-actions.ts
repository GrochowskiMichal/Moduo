/**
 * The block menu's actions (NR-4, AC7): Turn into · Duplicate · Delete. Run
 * inside `editor.update`. Comment opens the Comments panel (anchored threads
 * arrive with NR-8).
 */

import { $createCodeNode } from "@lexical/code";
import { $insertList } from "@lexical/list";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $parseSerializedNode,
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

/** Turn the whole block into `id`. */
export function $turnBlockInto(block: LexicalNode, id: TurnIntoId): void {
  if (!$isElementNode(block) || !$blockMenuFor(block).turnInto) return;
  block.select(0, block.getChildrenSize());
  $runBlockCommand(id);
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
