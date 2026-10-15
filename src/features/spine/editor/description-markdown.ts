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
import { $createParagraphNode, $getRoot } from "lexical";

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

/** Fill the editor from a stored description: Markdown, or the old HTML read as Markdown. */
export function $importDescription(value: string): void {
  const root = $getRoot();
  root.clear();
  const markdown = descriptionToMarkdown(value);
  if (markdown.trim()) $convertFromMarkdownString(markdown, DESCRIPTION_TRANSFORMERS);
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

/** The editor's content as the Markdown a description stores ("" when empty). */
export function $exportDescription(): string {
  const markdown = $convertToMarkdownString(DESCRIPTION_TRANSFORMERS).replace(/\s+$/, "");
  return markdown.trim() ? guardMarkdownStart(markdown) : "";
}
