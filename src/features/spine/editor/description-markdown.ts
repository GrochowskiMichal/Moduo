// A task's description as Markdown in the editor (dogfood call #15, MOD-98 /
// MOD-120): the transformer set the description editor types, imports and
// saves with. One dialect, written down once in `_shared/description-markdown`
// (the connector reads it too): bold, italic, strikethrough, inline code,
// fenced code blocks, links, bulleted, numbered and checkbox lists, quotes,
// and references and date chips as `moduo://` links. No headings (`#` is the
// tag menu).
//
// Words are escaped only where Markdown would read them as something else
// (`escapeMarkdownText`), so `file_name` is stored as written; a paragraph
// that starts like a list stays a paragraph (`escapeBlockStarts`); code keeps
// its content raw; and text too costly to read as Markdown comes in as raw
// text that saves back exactly as it was (`RawTextNode`).
//
// Schema imports only, no React (headless tests load it). Value imports stay
// relative.

import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { $isLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  CODE,
  type ElementTransformer,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  type TextMatchTransformer,
  type Transformer,
  UNORDERED_LIST,
} from "@lexical/markdown";
import { QuoteNode } from "@lexical/rich-text";
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type LexicalNode,
  ParagraphNode,
  type SerializedTextNode,
  TextNode,
} from "lexical";

import {
  DESCRIPTION_LINK,
  dateMarkdown,
  descriptionToMarkdown,
  escapeBlockStarts,
  escapeMarkdownText,
  guardMarkdownStart,
  referenceMarkdown,
} from "../../../../supabase/functions/_shared/description-markdown";
import { $createDateNode, $isDateNode, DateNode } from "../references/date-node";
import { isReferenceDisplay } from "../references/types";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./entity-ref-schema";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A pattern that never matches: export-only transformers. */
const NEVER = /(?!)/;

/**
 * Text read as it is stored, too costly or too large to read as Markdown (see
 * CHUNK_LIMIT). It saves back exactly as it came in, never escaped again, so
 * a save can't grow `user_id` into `user\\\_id`.
 */
export class RawTextNode extends TextNode {
  static getType(): string {
    return "description-raw";
  }

  static clone(node: RawTextNode): RawTextNode {
    return new RawTextNode(node.__text, node.__key);
  }

  static importJSON(serialized: SerializedTextNode): RawTextNode {
    return $createRawTextNode(serialized.text).updateFromJSON(serialized);
  }

  exportJSON(): SerializedTextNode {
    return { ...super.exportJSON(), type: "description-raw" };
  }
}

export function $createRawTextNode(text: string): RawTextNode {
  return $applyNodeReplacement(new RawTextNode(text));
}

export function $isRawTextNode(node: unknown): node is RawTextNode {
  return node instanceof RawTextNode;
}

/** Every node the description editor's Markdown needs. */
export const DESCRIPTION_MARKDOWN_NODES = [
  ReferenceNode,
  DateNode,
  ListNode,
  ListItemNode,
  QuoteNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
  RawTextNode,
];

/**
 * `[task](moduo://task/<id>)` ⇄ a reference (no title kept, RF-1), with its
 * "Show as" in the link's title when it isn't a chip; `[Oct 17](moduo://date/
 * 2026-10-17)` ⇄ a date chip. Must come before LINK, or the `moduo://` URI
 * becomes a plain link.
 */
export const DESCRIPTION_REFERENCE: TextMatchTransformer = {
  dependencies: [ReferenceNode, DateNode],
  export: (node) => {
    if ($isReferenceNode(node)) {
      return referenceMarkdown(node.__entityType, node.__entityId, node.getDisplay());
    }
    if ($isDateNode(node)) return dateMarkdown(node.getDay(), node.getTextContent());
    return null;
  },
  importRegExp: DESCRIPTION_LINK,
  regExp: new RegExp(`${DESCRIPTION_LINK.source}$`),
  replace: (textNode, match) => {
    const [, , type, id, display] = match;
    if (!type || !id) return;
    if (type === "date") {
      if (ISO_DAY.test(id)) textNode.replace($createDateNode(id));
      return;
    }
    textNode.replace(
      $createReferenceNode({
        entityType: type,
        entityId: id,
        display: isReferenceDisplay(display) ? display : "chip",
      }),
    );
  },
  trigger: ")",
  type: "text-match",
};

/** Whether `node` holds its block's only backtick (no inline code there either). */
function $onlyBacktickInBlock(node: TextNode): boolean {
  const block = node.getTopLevelElement();
  if (!block || !$isElementNode(block)) return false;
  let count = 0;
  for (const text of block.getAllTextNodes()) {
    if (text.hasFormat("code")) return false;
    for (const ch of text.getTextContent()) if (ch === "`" && ++count > 1) return false;
  }
  return count === 1;
}

/**
 * Plain words escaped only where Markdown would read them (call #15): Lexical
 * escapes every `*`, `_`, `~`, backtick and backslash, which stored
 * `file_name` as `file\_name` where the server's search can't find it. Raw
 * text goes out exactly as it is. Formatted words, words inside a link and
 * words right after one keep Lexical's own export (it closes the formats
 * there).
 */
export const DESCRIPTION_TEXT: TextMatchTransformer = {
  dependencies: [RawTextNode],
  export: (node) => {
    if ($isRawTextNode(node)) return node.getTextContent();
    if (!$isTextNode(node) || node.getType() !== "text" || node.getFormat() !== 0) return null;
    const previous = node.getPreviousSibling();
    if (previous && $isElementNode(previous)) return null;
    if ($isLinkNode(node.getParent())) return null;
    return escapeMarkdownText(node.getTextContent(), {
      lonelyBacktick: $onlyBacktickInBlock(node),
    });
  },
  importRegExp: NEVER,
  regExp: NEVER,
  replace: () => {},
  type: "text-match",
};

/** A paragraph of raw text (and line breaks) only: nothing to escape. */
function $isRawParagraph(node: LexicalNode): boolean {
  if (!$isParagraphNode(node)) return false;
  const children = node.getChildren();
  return (
    children.length > 0 &&
    children.every((child) => $isRawTextNode(child) || $isLineBreakNode(child)) &&
    children.some($isRawTextNode)
  );
}

/**
 * A paragraph exports with its block-like line starts escaped
 * (`escapeBlockStarts`); a raw one exactly as it is. Export only: its pattern
 * matches nothing, so import and typing never use it.
 */
export const DESCRIPTION_PARAGRAPH: ElementTransformer = {
  dependencies: [ParagraphNode],
  export: (node, traverseChildren) => {
    if (!$isParagraphNode(node)) return null;
    const text = traverseChildren(node);
    return $isRawParagraph(node) ? text : escapeBlockStarts(text);
  },
  regExp: NEVER,
  replace: () => false,
  type: "element",
};

/** The description's Markdown, in import order: code fences first, checkboxes
 *  before bullets (CHECK_LIST isn't in ELEMENT_TRANSFORMERS), references
 *  before links. */
export const DESCRIPTION_TRANSFORMERS: Transformer[] = [
  CODE,
  DESCRIPTION_PARAGRAPH,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  QUOTE,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  DESCRIPTION_REFERENCE,
  DESCRIPTION_TEXT,
  LINK,
];

/**
 * How Markdown is read in pieces, every route capped. Lexical's importer
 * slows down sharply on one long block: a long line of crafted delimiters
 * (`[`, `` ` ``, `[x](`: seconds at 50 KB) or thousands of lines in one
 * paragraph or list item (4 s at 100 KB), which would freeze the panel for
 * everyone who opens the task; dense emphasis (`*a*a*a…`) is worse still to
 * save. So every description, however short, goes through one reader:
 * - it is read in chunks of whole blocks (cut at blank lines outside code
 *   fences), each chunk within CHUNK_LIMIT characters and CHUNK_LINES lines
 *   (a short description is one chunk);
 * - a block too costly to read comes in as raw text that saves back unchanged:
 *   a paragraph, quote or anything not a plain list past CHUNK_LIMIT or
 *   CHUNK_LINES, a line longer than LINE_LIMIT or with more than
 *   DELIMITER_LIMIT delimiters (`costlyDelimiters`: a real paragraph with
 *   dozens of links, code spans and bold words has under 200), and any block
 *   once the whole description has spent DELIMITER_BUDGET of them;
 * - everything past TOTAL_LIMIT characters or TOTAL_LINES lines is one raw
 *   paragraph.
 * A list whose every line is an item reads in linear time, and a fence's
 * content isn't parsed at all, so those stay Markdown up to the totals.
 */
const CHUNK_LIMIT = 5_000;
const CHUNK_LINES = 100;
const TOTAL_LINES = 5_000;
const LINE_LIMIT = 5_000;
const DELIMITER_LIMIT = 300;
const DELIMITER_BUDGET = 3_000;
const TOTAL_LIMIT = 100_000;

const WORD = /[\p{L}\p{N}]/u;

/** Every character a description transformer scans for: emphasis, code, links, references, escapes. */
const SCANNED = new Set(["[", "]", "(", ")", "!", "`", "*", "~", "\\"]);

/**
 * How many delimiters a line holds, counted conservatively: every character
 * any transformer here scans for (`[ ] ( ) !`, backticks, `*`, `~`, `\`), and
 * `_` unless inside a word (`file_name` can't start emphasis, so identifiers
 * cost nothing). A line of `*a*a*a…` becomes thousands of formatted runs:
 * seconds to read, minutes to save; links and escapes are counted too, so no
 * shape the guard lets through is slower to parse than one it counts.
 */
function costlyDelimiters(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (SCANNED.has(ch)) n++;
    else if (ch === "_" && !(WORD.test(line[i - 1] ?? "") && WORD.test(line[i + 1] ?? ""))) n++;
  }
  return n;
}

type Block = {
  lines: string[];
  /** A code fence, start to end: its content isn't parsed. */
  fence: boolean;
  /** Every line a list item: reads in linear time. */
  list: boolean;
  /** A line too costly to read as Markdown. */
  costlyLine: boolean;
  /** Its `[` and backticks, outside a fence. */
  delimiters: number;
};

const FENCE_OPEN = /^[ \t]*(`{3,})(.*)$/;
const LIST_LINE = /^[ \t]*(?:[-*+]|\d{1,9}\.)[ \t]/;

/** The description's blocks: runs of lines between blank lines; a code fence is a block of its own. */
function markdownBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const empty = (): Block => ({
    lines: [],
    fence: false,
    list: true,
    costlyLine: false,
    delimiters: 0,
  });
  let current = empty();
  let fenceClose: RegExp | null = null;
  const end = () => {
    if (current.lines.length > 0) blocks.push(current);
    current = empty();
  };
  for (const line of markdown.split("\n")) {
    if (fenceClose) {
      current.lines.push(line);
      if (fenceClose.test(line)) {
        fenceClose = null;
        end();
      }
      continue;
    }
    if (line.trim() === "") {
      end();
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !/`{3,}[ \t]*$/.test(open[2] ?? "")) {
      end();
      current.fence = true;
      current.list = false;
      current.lines.push(line);
      fenceClose = new RegExp(`^[ \\t]*\`{${(open[1] ?? "```").length},}[ \\t]*$`);
      continue;
    }
    current.lines.push(line);
    if (!LIST_LINE.test(line)) current.list = false;
    const delimiters = costlyDelimiters(line);
    current.delimiters += delimiters;
    if (line.length > LINE_LIMIT || delimiters > DELIMITER_LIMIT) current.costlyLine = true;
  }
  end();
  return blocks;
}

/** A paragraph of raw text: read as it is stored, saved back as it was. */
function $rawParagraph(text: string): ParagraphNode {
  return $createParagraphNode().append($createRawTextNode(text));
}

/** Import a long description in chunks of whole blocks (see CHUNK_LIMIT). */
function $importInChunks(markdown: string): void {
  const root = $getRoot();
  const blocks = markdownBlocks(markdown);
  let chunk: string[] = [];
  let chunkChars = 0;
  let chunkLines = 0;
  let usedChars = 0;
  let usedLines = 0;
  let budget = DELIMITER_BUDGET;
  const flush = () => {
    if (chunk.length > 0) {
      root.append(...$generateNodesFromMarkdownString(chunk.join("\n"), DESCRIPTION_TRANSFORMERS));
    }
    chunk = [];
    chunkChars = 0;
    chunkLines = 0;
  };
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b] as Block;
    const text = block.lines.join("\n");
    usedChars += text.length + 2;
    usedLines += block.lines.length + 1;
    if (usedChars > TOTAL_LIMIT || usedLines > TOTAL_LINES) {
      // Everything from here is one paragraph of raw text, however long.
      flush();
      root.append(
        $rawParagraph(
          blocks
            .slice(b)
            .map((x) => x.lines.join("\n"))
            .join("\n\n"),
        ),
      );
      return;
    }
    const tooLong = text.length > CHUNK_LIMIT || block.lines.length > CHUNK_LINES;
    const costly =
      !block.fence && (block.costlyLine || (tooLong && !block.list) || block.delimiters > budget);
    if (costly) {
      flush();
      root.append($rawParagraph(text));
      continue;
    }
    budget -= block.delimiters;
    if (
      chunk.length > 0 &&
      (chunkChars + text.length > CHUNK_LIMIT || chunkLines + block.lines.length > CHUNK_LINES)
    ) {
      flush();
    }
    if (chunk.length > 0) chunk.push("");
    chunk.push(...block.lines);
    chunkChars += text.length + 1;
    chunkLines += block.lines.length + 1;
  }
  flush();
}

/** Fill the editor from a stored description: Markdown, or the old HTML read as Markdown. */
export function $importDescription(value: string): void {
  const root = $getRoot();
  root.clear();
  const markdown = descriptionToMarkdown(value);
  if (markdown.trim()) {
    // Every description goes through the capped reader, however short: a
    // short one is a single chunk, and its costly blocks still read raw.
    $importInChunks(markdown);
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

/** The editor's content as the Markdown a description stores ("" when empty). */
export function $exportDescription(): string {
  const markdown = $convertToMarkdownString(DESCRIPTION_TRANSFORMERS).trimEnd();
  return markdown.trim() ? guardMarkdownStart(markdown) : "";
}
