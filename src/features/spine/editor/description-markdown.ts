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
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";

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

/** The description's Markdown, in import order: checkboxes before bullets
 *  (CHECK_LIST isn't in ELEMENT_TRANSFORMERS), references before links. */
export const DESCRIPTION_TRANSFORMERS: Transformer[] = [
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
 * can; a line longer than LINE_LIMIT, and everything past TOTAL_LIMIT, comes
 * in as plain text (it saves back escaped, which only text that size meets).
 */
const CHUNK_LIMIT = 5_000;
const LINE_LIMIT = 5_000;
const TOTAL_LIMIT = 100_000;

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
  for (const line of markdown.split("\n")) {
    used += line.length + 1;
    if (used > TOTAL_LIMIT || line.length > LINE_LIMIT) {
      flush();
      if (line) root.append($createParagraphNode().append($createTextNode(line)));
      continue;
    }
    // A blank line past half the chunk is a clean place to cut; past the
    // whole chunk, cut anyway (a paragraph that long becomes two).
    if ((line === "" && chunkSize > CHUNK_LIMIT / 2) || chunkSize + line.length > CHUNK_LIMIT)
      flush();
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
    if (markdown.length <= CHUNK_LIMIT)
      $convertFromMarkdownString(markdown, DESCRIPTION_TRANSFORMERS);
    else $importInChunks(markdown);
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

/** The editor's content as the Markdown a description stores ("" when empty). */
export function $exportDescription(): string {
  const markdown = $convertToMarkdownString(DESCRIPTION_TRANSFORMERS).trimEnd();
  return markdown.trim() ? guardMarkdownStart(markdown) : "";
}
