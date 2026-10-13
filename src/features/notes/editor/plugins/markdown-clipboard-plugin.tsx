/**
 * Markdown at the clipboard door (Wave-3 NO-4, AC11).
 *
 * PASTE: plain text that carries markdown BLOCK syntax converts to real
 * blocks when it lands in an empty note (the AI-authored-doc / migration
 * flow). Mid-document pastes stay Lexical-default — @lexical/markdown can
 * only import into a container, and mangling a caret-anchored insert would
 * be worse than plain text (NO-8's import wizard covers files).
 *
 * COPY: text/plain becomes clean markdown of the selection, through the same
 * `NOTES_TRANSFORMERS` every other door uses (NR-3: one dialect; chips →
 * [label](moduo://type/id), page-rows → standalone note links, tables → GFM),
 * while text/html + the internal Lexical flavor are preserved, so paste-back
 * into Moduo stays rich and paste-elsewhere gets md.
 */

import { $getHtmlContent, $getLexicalContent } from "@lexical/clipboard";
import { $convertFromMarkdownString, $convertSelectionToMarkdownString } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  type LexicalNode,
  PASTE_COMMAND,
  type RangeSelection,
} from "lexical";
import { useEffect } from "react";
import { looksLikeMarkdown, NOTES_TRANSFORMERS } from "../markdown";

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
  const norm = (s: string) => s.replace(/\s+/g, "");
  return norm(selection.getTextContent()) !== norm(a.getTextContent());
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
        // Internal or rich pastes keep Lexical's own handling.
        if (data.types.includes("application/x-lexical-editor")) return false;
        if (data.types.includes("text/html")) return false;
        const text = data.getData("text/plain");
        if (!text || !looksLikeMarkdown(text)) return false;

        const docIsEmpty = editor
          .getEditorState()
          .read(() => $getRoot().getTextContent().trim() === "");
        if (!docIsEmpty) return false;

        event.preventDefault();
        editor.update(() => {
          $convertFromMarkdownString(text, NOTES_TRANSFORMERS);
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
          if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
          // A few words inside ONE block copy as plain text (Lexical's own
          // copy): markdown there would drag the block's markers along
          // ("## planning", "- [ ] milk", a whole table for two letters).
          if ($isPartialWithinOneBlock(selection)) return;
          const md = $convertSelectionToMarkdownString(NOTES_TRANSFORMERS, selection).trim();
          if (md === "") return;
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
