// A task's description as Markdown in the editor (dogfood call #15, MOD-98 /
// MOD-120): the transformer set the description editor types, imports and
// saves with. One dialect, written down once in `_shared/description-markdown`
// (the connector reads it too): bold, italic, strikethrough, inline code,
// links, bulleted, numbered and checkbox lists, quotes, and references and
// date chips as `moduo://` links. No headings (`#` is the tag menu) and no
// code blocks: the call didn't ask for them.
//
// Schema imports only, no React (headless tests load it). Value imports stay
// relative.

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
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
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  ParagraphNode,
} from "lexical";

import {
  DESCRIPTION_LINK,
  dateMarkdown,
  descriptionToMarkdown,
  guardMarkdownStart,
  referenceMarkdown,
} from "../../../../supabase/functions/_shared/description-markdown";
import { $createDateNode, $isDateNode, DateNode } from "../references/date-node";
import { isReferenceDisplay } from "../references/types";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./entity-ref-schema";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * A paragraph's line whose words start like a block (`- `, `+ `, `1. `, `> `,
 * `[ ] `) keeps that start escaped, as the exporter already escapes `*`, so
 * the next read gives the paragraph back, not a list, a quote or a checkbox.
 * Each line counts: a line break inside the paragraph starts a line too.
 */
export function escapeBlockStarts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^([ \t]*)([-+])(?=[ \t])/, "$1\\$2")
        .replace(/^([ \t]*)(\d{1,9})\.(?=[ \t])/, "$1$2\\.")
        .replace(/^([ \t]*)>/, "$1\\>")
        .replace(/^([ \t]*)\[([ xX]?)\](?=[ \t])/, "$1\\[$2]"),
    )
    .join("\n");
}

/**
 * A paragraph exports with its block-like line starts escaped
 * (`escapeBlockStarts`). Export only: its pattern matches nothing, so import
 * and typing never use it.
 */
export const DESCRIPTION_PARAGRAPH: ElementTransformer = {
  dependencies: [ParagraphNode],
  export: (node, traverseChildren) =>
    $isParagraphNode(node) ? escapeBlockStarts(traverseChildren(node)) : null,
  regExp: /^(?!)/,
  replace: () => false,
  type: "element",
};

/** The description's Markdown, in import order: checkboxes before bullets
 *  (CHECK_LIST isn't in ELEMENT_TRANSFORMERS), references before links. */
export const DESCRIPTION_TRANSFORMERS: Transformer[] = [
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
  LINK,
];

/**
 * How Markdown is read in pieces. Lexical's importer slows down sharply on one
 * long block: a long line of crafted delimiters (`[`, `` ` ``, `[x](`: seconds
 * at 50 KB) or thousands of lines in one paragraph (4 s at 100 KB), which
 * would freeze the panel for everyone who opens the task. So a description
 * past CHUNK_LIMIT is read a chunk at a time, cut at a blank line where it
 * can; a line longer than LINE_LIMIT or dense with the costly delimiters
 * (more than DELIMITER_LIMIT `[` and backticks: a real paragraph with dozens of
 * links and code spans has under 200) comes in as plain text, and so does
 * everything past TOTAL_LIMIT characters or TOTAL_LINES lines, as one paragraph. Plain text saves back
 * escaped, which only text like that ever meets.
 */
const CHUNK_LIMIT = 5_000;
const CHUNK_LINES = 100;
const TOTAL_LINES = 5_000;
const LINE_LIMIT = 5_000;
const DELIMITER_LIMIT = 300;
const TOTAL_LIMIT = 100_000;

/** How many of the delimiters that make Lexical's importer slow a line holds. */
function costlyDelimiters(line: string): number {
  let n = 0;
  for (const ch of line) if (ch === "[" || ch === "`") n++;
  return n;
}

/** Import a long description a chunk at a time (see CHUNK_LIMIT). */
function $importInChunks(markdown: string): void {
  const root = $getRoot();
  let chunk: string[] = [];
  let chunkSize = 0;
  let used = 0;
  const flush = () => {
    if (chunk.length > 0) {
      root.append(...$generateNodesFromMarkdownString(chunk.join("\n"), DESCRIPTION_TRANSFORMERS));
    }
    chunk = [];
    chunkSize = 0;
  };
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    used += line.length + 1;
    if (used > TOTAL_LIMIT || i >= TOTAL_LINES) {
      // Everything from here is one paragraph of plain text, however many lines.
      flush();
      root.append($createParagraphNode().append($createTextNode(lines.slice(i).join("\n"))));
      return;
    }
    if (line.length > LINE_LIMIT || costlyDelimiters(line) > DELIMITER_LIMIT) {
      flush();
      if (line) root.append($createParagraphNode().append($createTextNode(line)));
      continue;
    }
    // A blank line past half the chunk is a clean place to cut; past the
    // whole chunk (or CHUNK_LINES lines: one paragraph's cost grows with its
    // lines too), cut anyway (a paragraph that long becomes two).
    if (
      (line === "" && (chunkSize > CHUNK_LIMIT / 2 || chunk.length > CHUNK_LINES / 2)) ||
      chunkSize + line.length > CHUNK_LIMIT ||
      chunk.length >= CHUNK_LINES
    ) {
      flush();
    }
    chunk.push(line);
    chunkSize += line.length + 1;
  }
  flush();
}

/** Fill the editor from a stored description: Markdown, or the old HTML read as Markdown. */
export function $importDescription(value: string): void {
  const root = $getRoot();
  root.clear();
  const markdown = descriptionToMarkdown(value);
  if (markdown.trim()) {
    const lines = markdown.split("\n", CHUNK_LINES + 1).length;
    if (markdown.length <= CHUNK_LIMIT && lines <= CHUNK_LINES) {
      $convertFromMarkdownString(markdown, DESCRIPTION_TRANSFORMERS);
    } else {
      $importInChunks(markdown);
    }
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

/** The editor's content as the Markdown a description stores ("" when empty). */
export function $exportDescription(): string {
  const markdown = $convertToMarkdownString(DESCRIPTION_TRANSFORMERS).trimEnd();
  return markdown.trim() ? guardMarkdownStart(markdown) : "";
}
