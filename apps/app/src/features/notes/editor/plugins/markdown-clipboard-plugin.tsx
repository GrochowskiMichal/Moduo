/**
 * Markdown at the clipboard door (Wave-3 NO-4, AC11).
 *
 * PASTE: plain text that carries markdown BLOCK syntax converts to real
 * blocks (the AI-authored-doc / migration flow). An empty note takes it
 * whole; anywhere else it is converted off-screen (@lexical/markdown only
 * imports into a container) and inserted at the caret like a rich paste.
 * A list whose numbers don't count up by one (`3.` then `7.`) stays text,
 * since a list would renumber it. Other plain text with line breaks keeps
 * them as breaks inside a paragraph, and each blank line is an empty
 * paragraph, so a pasted key file or env block copies back out as it was.
 *
 * COPY: text/plain becomes clean markdown of the selection, through the same
 * `NOTES_TRANSFORMERS` every other door uses (NR-3: one dialect; chips →
 * [label](moduo://type/id), page-rows → standalone note links, tables → GFM),
 * while text/html + the internal Lexical flavor are preserved, so paste-back
 * into Moduo stays rich and paste-elsewhere gets md. The characters of the
 * text itself copy as typed: Lexical's `\_`-style escapes are undone, or a
 * key like `sbp_x` kept in a note pastes elsewhere as `sbp\_x`. A copy of
 * plain paragraphs only is lines (one line break between paragraphs, as
 * typed); one holding headings, lists or other blocks is a markdown
 * document, blocks a blank line apart.
 */

import {
  $generateNodesFromSerializedNodes,
  $getHtmlContent,
  $getLexicalContent,
  $insertGeneratedNodes,
} from "@lexical/clipboard";
import { $isCodeNode } from "@lexical/code";
import {
  $convertFromMarkdownString,
  $convertSelectionToMarkdownString,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  type LexicalNode,
  PASTE_COMMAND,
  type RangeSelection,
  type SerializedLexicalNode,
} from "lexical";
import { useEffect } from "react";
import { toast } from "sonner";

import { createNotesHeadlessEditor } from "../doc-markdown";
import { $notesMarkdown, looksLikeMarkdown, NOTES_TRANSFORMERS } from "../markdown";

function $isInCodeBlock(node: LexicalNode): boolean {
  for (let n: LexicalNode | null = node; n; n = n.getParent()) if ($isCodeNode(n)) return true;
  return false;
}

/** Markdown → the serialized blocks it imports as, built in a headless editor. */
function markdownBlocks(text: string): SerializedLexicalNode[] {
  const { editor } = createNotesHeadlessEditor("moduo-note-paste");
  editor.update(() => $convertFromMarkdownString(text, NOTES_TRANSFORMERS), { discrete: true });
  return editor.getEditorState().toJSON().root.children;
}

/** Lexical's ordered-list line (`1. `), outside code fences. */
function orderedNumbers(markdown: string): string[] {
  let fenced = false;
  const numbers: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const match = fenced ? null : line.match(/^\s*(\d+)\.\s/);
    if (match) numbers.push(match[1]!);
  }
  return numbers;
}

/** Pasted markdown with its list numbers kept: a list numbers from its first
 * item on, so `3.` then `7.` (or `1.` `1.` `1.`) would come back 3, 4.
 * Those markers are escaped instead, and the lines stay text as typed. */
export function keepListNumbers(text: string): string {
  const { editor } = createNotesHeadlessEditor("moduo-note-paste-check");
  editor.update(() => $convertFromMarkdownString(text, NOTES_TRANSFORMERS), { discrete: true });
  const imported = editor.getEditorState().read(() => $notesMarkdown());
  if (orderedNumbers(text).join() === orderedNumbers(imported).join()) return text;
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      return fenced ? line : line.replace(/^(\s*\d+)\.(?=\s)/, "$1\\.");
    })
    .join("\n");
}

/** The top-level block a node sits in (root's direct child). */
function $topBlock(node: LexicalNode): LexicalNode | null {
  let top: LexicalNode | null = node;
  while (top && top.getParent() && !$isRootNode(top.getParent())) top = top.getParent();
  return top && !$isRootNode(top) ? top : null;
}

/** Both ends in the same top-level block, and less than all of its text. */
export function $isPartialWithinOneBlock(selection: RangeSelection): boolean {
  const a = $topBlock(selection.anchor.getNode());
  const b = $topBlock(selection.focus.getNode());
  if (!a || !b || !a.is(b)) return false;
  // A chip's markdown form (`[label](moduo://…)`) is the point of copying it.
  if (selection.getNodes().some((n) => n.getType() === "entity-ref")) return false;
  const norm = (s: string) => s.replace(/\s+/g, "");
  return norm(selection.getTextContent()) !== norm(a.getTextContent());
}

/** Export-only: a text run as typed, inside its format markers. Lexical
 * escapes `* _ ` ~` in exported text (and `\` too, unless it keeps newlines)
 * and writes edge spaces of a formatted run as `&#32;`; each of those chars
 * gets exactly one backslash right before it, so undoing them is exact. Code
 * runs are never escaped, so they keep the default path (their backslashes
 * are real). */
function literalTextExport(keepsNewLines: boolean): TextMatchTransformer {
  const escape = keepsNewLines ? /\\([*_`~])/g : /\\([*_`~\\])/g;
  return {
    dependencies: [],
    type: "text-match",
    regExp: /(?!)/,
    export: (node, _exportChildren, exportFormat) => {
      if (!$isTextNode(node) || node.hasFormat("code")) return null;
      const text = node.getTextContent();
      const out = exportFormat(node, text).replace(escape, "$1");
      if (text.includes("&#")) return out;
      return out.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
    },
  };
}

/** A document copy: blocks a blank line apart (markdown's own separation). */
const COPY_BLOCKS: Transformer[] = [literalTextExport(false), ...NOTES_TRANSFORMERS];
/** A copy of paragraphs only: one line break between them, as typed. */
const COPY_LINES: Transformer[] = [literalTextExport(true), ...NOTES_TRANSFORMERS];

/** The clipboard's text/plain for a copy, or null when Lexical's own plain
 * text should go (a few words inside one block). */
export function $copyPlainText(selection: RangeSelection): string | null {
  if (selection.isCollapsed() || $isPartialWithinOneBlock(selection)) return null;
  const lines = selection.getNodes().every((node) => $isParagraphNode($topBlock(node)));
  const md = lines
    ? $convertSelectionToMarkdownString(COPY_LINES, selection, true)
    : $convertSelectionToMarkdownString(COPY_BLOCKS, selection);
  return md.trim() === "" ? null : md.replace(/^\n+|\n+$/g, "");
}

/** Plain text with line breaks pasted into a paragraph: lines stay breaks
 * inside one paragraph and each blank line is an empty paragraph, so it
 * copies back out line for line (Lexical's own paste makes every line a
 * paragraph). Returns false when this isn't such a paste, for Lexical. */
export function $insertPlainTextLines(selection: RangeSelection, text: string): boolean {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) return false;
  const block = $findMatchingParent(
    selection.anchor.getNode(),
    (n) => $isElementNode(n) && !n.isInline(),
  );
  if (!$isParagraphNode(block)) return false;
  // "a\nb\n\nc" → ["a\nb", "", "c"]: runs of lines, and one "" per blank line.
  const paragraphs: string[] = [];
  let run: string[] = [];
  for (const line of normalized.split("\n")) {
    if (line !== "") {
      run.push(line);
      continue;
    }
    if (run.length > 0) paragraphs.push(run.join("\n"));
    paragraphs.push("");
    run = [];
  }
  if (run.length > 0) paragraphs.push(run.join("\n"));
  paragraphs.forEach((paragraph, i) => {
    const current = $getSelection();
    if (!$isRangeSelection(current)) return;
    if (i > 0) current.insertParagraph();
    const next = $getSelection();
    if ($isRangeSelection(next) && paragraph !== "") next.insertRawText(paragraph);
  });
  return true;
}

export function MarkdownClipboardPlugin() {
  const [editor] = useLexicalComposerContext();

  // ── paste ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
        const data = event.clipboardData;
        // Images in notes aren't built yet (NR-9): say so, rather than drop
        // the picture and leave an empty line where it was pasted.
        if (Array.from(data.files).some((f) => f.type.startsWith("image/"))) {
          event.preventDefault();
          toast("Notes can’t hold images yet. Pasting an image is coming soon.");
          return true;
        }
        // Internal or rich pastes keep Lexical's own handling.
        if (data.types.includes("application/x-lexical-editor")) return false;
        if (data.types.includes("text/html")) return false;
        const text = data.getData("text/plain");
        if (!text) return false;
        if (!looksLikeMarkdown(text)) {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !$insertPlainTextLines(selection, text))
            return false;
          event.preventDefault();
          return true;
        }
        // Inside a code block, markdown is code: paste it as typed.
        const inCode = editor.getEditorState().read(() => {
          const selection = $getSelection();
          return $isRangeSelection(selection) && $isInCodeBlock(selection.anchor.getNode());
        });
        if (inCode) return false;

        const docIsEmpty = editor
          .getEditorState()
          .read(() => $getRoot().getTextContent().trim() === "");
        event.preventDefault();
        const markdown = keepListNumbers(text);
        if (docIsEmpty) {
          // The handler already runs inside an update.
          $convertFromMarkdownString(markdown, NOTES_TRANSFORMERS);
          return true;
        }
        const blocks = markdownBlocks(markdown);
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          $insertGeneratedNodes(editor, $generateNodesFromSerializedNodes(blocks), selection);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  // ── copy ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      COPY_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
        let handled = false;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          // A few words inside ONE block copy as plain text (Lexical's own
          // copy): markdown there would drag the block's markers along
          // ("## planning", "- [ ] milk", a whole table for two letters).
          const md = $copyPlainText(selection);
          if (md === null) return;
          const html = $getHtmlContent(editor);
          const lexical = $getLexicalContent(editor);
          event.clipboardData!.setData("text/plain", md);
          if (html) event.clipboardData!.setData("text/html", html);
          if (lexical) event.clipboardData!.setData("application/x-lexical-editor", lexical);
          handled = true;
        });
        if (handled) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}
