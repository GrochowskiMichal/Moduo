/**
 * Markdown at the clipboard door (Wave-3 NO-4, AC11).
 *
 * PASTE: plain text that carries markdown BLOCK syntax converts to real
 * blocks when it lands in an empty note (the AI-authored-doc / migration
 * flow). Mid-document pastes stay Lexical-default — @lexical/markdown can
 * only import into a container, and mangling a caret-anchored insert would
 * be worse than plain text (NO-8's import wizard covers files).
 *
 * COPY: text/plain becomes clean markdown of the selected blocks (chips →
 * [label](moduo://type/id), page-rows → standalone note links) while
 * text/html + the internal Lexical flavor are preserved, so paste-back into
 * Moduo stays rich and paste-elsewhere gets md.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import { $getHtmlContent, $getLexicalContent } from "@lexical/clipboard";
import { $convertFromMarkdownString } from "@lexical/markdown";
import {
  $nodeToMdJson,
  $selectionTopBlocks,
  blocksToMarkdown,
  looksLikeMarkdown,
  NOTES_TRANSFORMERS,
} from "../markdown";

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
          const nodes = selection.getNodes();
          const blocks = $selectionTopBlocks(nodes);
          if (blocks.length === 0) return;
          // A partial INLINE range must not over-share the whole block as
          // text/plain — fall through to Lexical's default copy unless the
          // selection carries a moduo node (whose md form is the point).
          const hasModuoNode = nodes.some((n) => {
            const t = n.getType();
            return t === "entity-ref" || t === "page-row" || t === "embed";
          });
          const norm = (s: string) => s.replace(/\s+/g, "");
          const coversWholeBlocks =
            norm(selection.getTextContent()) ===
            norm(blocks.map((b) => b.getTextContent()).join(""));
          if (!hasModuoNode && !coversWholeBlocks) return;
          const md = blocksToMarkdown(blocks.map($nodeToMdJson));
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
