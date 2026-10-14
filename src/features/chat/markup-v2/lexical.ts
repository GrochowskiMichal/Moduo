// The composer's side of the stored form: the shared Lexical editor's nodes
// (RF-1's Reference and date chip, plus quote, code, list and link) to the
// tree and back. Export walks the editor into a canonical tree and serializes
// it; import parses the stored text and builds the nodes, so an edit opens
// exactly what was sent. Lexical never parses Markdown here: the one parser is
// ./parse.ts (the Markdown shortcuts while typing are CV-7b's, and only create
// these same nodes).
//
// What maps to what (docs/build/chat-v2/CV-0-S4.md §Constructs):
//   paragraph + line breaks ↔ `p`        · QuoteNode ↔ `quote`
//   CodeNode (language) ↔ `pre`         · ListNode bullet / number ↔ `list`
//   text formats bold / italic / strikethrough / code ↔ marks, `code`
//   LinkNode ↔ `[label](href)`          · ReferenceNode ↔ `moduo://type/id`
//   DateNode ↔ `moduo://date/day`       · `@channel`, `:name:`, URLs are text
// A reference's display isn't stored: it follows RF-1's insert rule (alone on
// its line in a paragraph → card where the kind has one; a tag → link; else
// chip), so "Show as" stays off in the chat composer.

import { $createCodeNode, $isCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code";
import {
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  AutoLinkNode,
  LinkNode,
} from "@lexical/link";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { $createQuoteNode, $isQuoteNode, QuoteNode } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type ElementNode,
  type Klass,
  type LexicalNode,
} from "lexical";

import { $createDateNode, $isDateNode, DateNode } from "../../spine/references/date-node";
import { canShowAsCard, referenceKind } from "../../spine/references/kinds";
import {
  $createReferenceNode,
  $isReferenceNode,
  ReferenceNode,
} from "../../spine/references/reference-node";
import type { ReferenceDisplay } from "../../spine/references/types";
import { canonicalBlocks } from "./canonical";
import { parseStored } from "./parse";
import { serializeBlocks } from "./serialize";
import { tokenText } from "./tokens";
import { ALL_MARKS, type Block, type CodeLeaf, type Inline, type TextLeaf } from "./types";

/** Lexical's IS_CODE text format bit (bold, italic and strikethrough equal our marks). */
const IS_CODE = 16;

/** The nodes the chat composer registers (the shared editor's, plus the block nodes). */
export const CHAT_EDITOR_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  ReferenceNode,
  DateNode,
  QuoteNode,
  CodeNode,
  CodeHighlightNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
];

/** A reference's display in chat: RF-1's insert rule, decided by where it sits. */
export function chatReferenceDisplay(type: string, aloneOnLine: boolean): ReferenceDisplay {
  if (type === "tag") return "link";
  return aloneOnLine && canShowAsCard(referenceKind(type)) ? "card" : "chip";
}

// ── editor → tree ───────────────────────────────────────────────────────────

/** A link's label: its text and inline code (anything else reads as its text). */
function labelOf(link: ElementNode): Array<TextLeaf | CodeLeaf> {
  return inlineOf(link).flatMap((leaf): Array<TextLeaf | CodeLeaf> => {
    if (leaf.t === "text" || leaf.t === "code") return [leaf];
    if (leaf.t === "br") return [{ t: "text", v: " ", m: 0 }];
    if (leaf.t === "url" || leaf.t === "channel" || leaf.t === "emoji") {
      return [{ t: "text", v: tokenText(leaf), m: leaf.m }];
    }
    if (leaf.t === "link") return leaf.c;
    return [];
  });
}

/** One inline node as leaves. */
function leavesOf(node: LexicalNode): Inline[] {
  if ($isLineBreakNode(node)) return [{ t: "br" }];
  if ($isTextNode(node)) {
    const format = node.getFormat();
    const v = node.getTextContent();
    const m = format & ALL_MARKS;
    return [format & IS_CODE ? { t: "code", v, m } : { t: "text", v, m }];
  }
  if ($isReferenceNode(node)) {
    const latest = node.getLatest();
    return [{ t: "ref", type: latest.__entityType, id: latest.__entityId }];
  }
  if ($isDateNode(node)) return [{ t: "date", day: node.getDay() }];
  // A bare URL is text in the stored form (the parser finds it again).
  if ($isAutoLinkNode(node)) return inlineOf(node);
  if ($isLinkNode(node)) return [{ t: "link", href: node.getURL(), c: labelOf(node) }];
  if ($isElementNode(node)) return inlineOf(node);
  // Other decorators (none in the chat composer) have no stored form.
  return [];
}

/** An element's inline children as leaves. */
function inlineOf(element: ElementNode): Inline[] {
  return element.getChildren().flatMap(leavesOf);
}

/** List items, flattened to one level (a nested list's items join its parent's). */
function itemsOf(list: ElementNode): Inline[][] {
  const items: Inline[][] = [];
  for (const child of list.getChildren()) {
    if (!$isListItemNode(child)) continue;
    const nested = child.getChildren().filter($isListNode);
    if (nested.length > 0) {
      for (const sub of nested) items.push(...itemsOf(sub));
    } else {
      items.push(inlineOf(child));
    }
  }
  return items;
}

/** The editor's content as a canonical tree (call inside `editor.read` / `update`). */
export function $editorToBlocks(): Block[] {
  const blocks: Block[] = [];
  for (const node of $getRoot().getChildren()) {
    if ($isCodeNode(node)) {
      blocks.push({ t: "pre", v: node.getTextContent(), lang: node.getLanguage() ?? null });
    } else if ($isListNode(node)) {
      const ordered = node.getListType() === "number";
      blocks.push({
        t: "list",
        ordered,
        start: ordered ? node.getStart() : 1,
        items: itemsOf(node),
      });
    } else if ($isQuoteNode(node)) {
      blocks.push({ t: "quote", c: inlineOf(node) });
    } else if ($isElementNode(node)) {
      // Paragraphs, and anything else block-shaped (a pasted heading) as one.
      blocks.push({ t: "p", c: inlineOf(node) });
    } else {
      blocks.push({ t: "p", c: leavesOf(node) });
    }
  }
  return canonicalBlocks(blocks);
}

/** The editor's content in the stored form (inside `editor.read` / `update`). */
export function $exportStored(): string {
  return serializeBlocks($editorToBlocks());
}

// ── tree → editor ───────────────────────────────────────────────────────────

/** Text (with tabs as tab nodes, as typing or pasting makes them) carrying a format. */
function textNodes(v: string, format: number): LexicalNode[] {
  const out: LexicalNode[] = [];
  v.split(/(\t)/).forEach((part) => {
    if (!part) return;
    out.push((part === "\t" ? $createTabNode() : $createTextNode(part)).setFormat(format));
  });
  return out;
}

/** Inline leaves as Lexical nodes; `cards` lets a reference alone on its line be a card. */
function inlineNodes(leaves: readonly Inline[], cards: boolean): LexicalNode[] {
  const out: LexicalNode[] = [];
  leaves.forEach((leaf, k) => {
    switch (leaf.t) {
      case "text":
      case "url":
      case "channel":
      case "emoji":
        out.push(...textNodes(leaf.t === "text" ? leaf.v : tokenText(leaf), leaf.m));
        break;
      case "code":
        out.push(...textNodes(leaf.v, leaf.m | IS_CODE));
        break;
      case "ref": {
        const before = leaves[k - 1];
        const after = leaves[k + 1];
        const alone = cards && (!before || before.t === "br") && (!after || after.t === "br");
        out.push(
          $createReferenceNode({
            entityType: leaf.type,
            entityId: leaf.id,
            display: chatReferenceDisplay(leaf.type, alone),
          }),
        );
        break;
      }
      case "date":
        out.push($createDateNode(leaf.day));
        break;
      case "link": {
        const link = $createLinkNode(leaf.href);
        for (const part of leaf.c) {
          link.append(...textNodes(part.v, part.m | (part.t === "code" ? IS_CODE : 0)));
        }
        out.push(link);
        break;
      }
      case "br":
        out.push($createLineBreakNode());
        break;
    }
  });
  return out;
}

/** Code block text: lines joined by line breaks, tabs as tab nodes. */
function codeNodes(v: string): LexicalNode[] {
  const out: LexicalNode[] = [];
  v.split("\n").forEach((line, i) => {
    if (i > 0) out.push($createLineBreakNode());
    out.push(...textNodes(line, 0));
  });
  return out;
}

/** The tree as top-level Lexical nodes (for an edit, or a clean paste to insert). */
export function $blocksToNodes(blocks: readonly Block[]): LexicalNode[] {
  return blocks.map($blockToNode);
}

function $blockToNode(block: Block): LexicalNode {
  if (block.t === "p") return $createParagraphNode().append(...inlineNodes(block.c, true));
  if (block.t === "quote") return $createQuoteNode().append(...inlineNodes(block.c, false));
  if (block.t === "pre") return $createCodeNode(block.lang).append(...codeNodes(block.v));
  const list = $createListNode(block.ordered ? "number" : "bullet", block.start);
  for (const item of block.items)
    list.append($createListItemNode().append(...inlineNodes(item, false)));
  return list;
}

/** Replace the editor's content with a stored message (inside `editor.update`). */
export function $importStored(stored: string): void {
  $importBlocks(parseStored(stored));
}

/** Replace the editor's content with a tree (inside `editor.update`). */
export function $importBlocks(blocks: readonly Block[]): void {
  const root = $getRoot();
  root.clear();
  const nodes = $blocksToNodes(blocks);
  if (nodes.length === 0) nodes.push($createParagraphNode());
  root.append(...nodes);
}

/**
 * The canonical form of what's in the editor (what sending and re-opening
 * would show). Parity is exact against this: export → parse → import equals
 * it. Inside `editor.update`.
 */
export function $canonicalizeEditor(): void {
  $importBlocks($editorToBlocks());
}
