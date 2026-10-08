// Connective-tissue spine — DF-23 shared entity-rich text editor.
//
// A minimal standalone (non-collab) Lexical editor that brings the Notes
// `@mention` + `/ref` gestures to short prose fields — the task description and
// calendar event notes. It is deliberately NOT a block editor (no headings /
// tables / lists slash-menu): the point is entity LINKING in prose, not
// document authoring. It seeds from the stored string (our HTML → parsed;
// foreign/legacy plain text → verbatim, never parsed as markup) and commits
// `{ html, text }` on blur — html to persist (chips ride along via
// `EntityRefNode.exportDOM`), text as the plain-text projection.
//
// Both `@` and `/` mount the SAME generalized `MentionMenuPlugin` (a `null`
// source makes it insert-only; here we always pass a real source, so each pick
// also writes an `entity_link`). Tokens-only theme (Tailwind utilities).

import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { DRAG_DROP_PASTE } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalNode,
} from "lexical";
import { useEffect, useMemo, useRef } from "react";

import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { EntityRefNode } from "./entity-ref-node";
import { looksLikeRichHtml } from "./entity-rich-html";
import { MentionMenuPlugin } from "./mention-menu-plugin";

/** Tokens-only theme (Tailwind utilities → no bespoke CSS, no raw values). */
const THEME = {
  paragraph: "mb-2 last:mb-0",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
  },
};

/** Empty content persists as "" (not "<p><br></p>") so `looksLikeRichHtml`
 * reads it as plain — a chip-only body is NOT empty (chips carry no text but
 * leave the marker in the html). */
function serialize(editor: Parameters<typeof $generateHtmlFromNodes>[0]): {
  html: string;
  text: string;
} {
  return editor.read(() => {
    const text = $getRoot().getTextContent();
    const html = $generateHtmlFromNodes(editor, null);
    const isEmpty = text.trim() === "" && !html.includes("data-lexical-entity-ref");
    return { html: isEmpty ? "" : html, text };
  });
}

/** Seed the editor once from the stored value. Our HTML is parsed; foreign /
 * legacy plain text is inserted verbatim (line breaks preserved) so a literal
 * "<x>" is never swallowed as an element. */
function SeedPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (looksLikeRichHtml(value)) {
        const dom = new DOMParser().parseFromString(value, "text/html");
        const nodes = $generateNodesFromDOM(editor, dom);
        // Root children must be blocks: append block elements directly, gather
        // stray inline / text / decorator nodes into a paragraph.
        let inline: LexicalNode[] = [];
        const flush = () => {
          if (inline.length === 0) return;
          const p = $createParagraphNode();
          p.append(...inline);
          root.append(p);
          inline = [];
        };
        for (const node of nodes) {
          // A block element opens a new root child; inline elements, decorator
          // chips, and bare text nodes gather into a wrapping paragraph.
          if ($isElementNode(node) && !node.isInline()) {
            flush();
            root.append(node);
          } else {
            inline.push(node);
          }
        }
        flush();
      } else if (value) {
        const p = $createParagraphNode();
        value.split("\n").forEach((line, i) => {
          if (i > 0) p.append($createLineBreakNode());
          if (line) p.append($createTextNode(line));
        });
        root.append(p);
      }
      if (root.getChildrenSize() === 0) root.append($createParagraphNode());
    });
  }, [editor, value]);
  return null;
}

/** Commit `{ html, text }` on blur, only when the content actually changed. */
function CommitOnBlurPlugin({ onCommit }: { onCommit?: (html: string, text: string) => void }) {
  const [editor] = useLexicalComposerContext();
  // Baseline against the SERIALIZED seed (not the raw stored string): a legacy
  // plain-text value re-serializes to `<p>…</p>`, so baselining off the raw
  // value would make a bare focus+blur look "changed" and fire a spurious write
  // (updatedAt bump + phantom activity row). SeedPlugin renders first, so the
  // editor is already seeded when this mount effect runs.
  const last = useRef<string | null>(null);
  // onCommit closes over the entity id but has a fresh identity each render;
  // route through a ref so the command registers once (not per render).
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });
  useEffect(() => {
    last.current = serialize(editor).html;
    return editor.registerCommand(
      BLUR_COMMAND,
      () => {
        const { html, text } = serialize(editor);
        if (html !== last.current) {
          last.current = html;
          onCommitRef.current?.(html, text);
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);
  return null;
}

export type EntityTextEditorProps = {
  /** Stored description — our HTML (with chips) or foreign/legacy plain text. */
  value: string;
  editable: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The surface's own entity (link source). `null` → insert-only (no link). */
  source: EntityRef | null;
  sourceLabel?: string;
  sourceIcon?: string | null;
  currentUserId?: string | null;
  placeholder?: string;
  ariaLabel?: string;
  /** Extra classes for the editable/readable surface (merged: they win over the defaults). */
  className?: string;
  /** Extra classes for the placeholder (match a changed text size). */
  placeholderClassName?: string;
  onCommit?: (html: string, text: string) => void;
  /** Files pasted or dropped into the text (AT-2): handed to the caller, which
   * attaches them. Never inserted as image nodes (attachments-only). Without
   * it, Lexical drops them as before. */
  onFiles?: (files: File[]) => void;
};

/** Pasted/dropped files go to `onFiles` (the attachments service), not into
 * the text. Lexical's rich-text paste and drop dispatch DRAG_DROP_PASTE. */
function FilesPlugin({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [editor] = useLexicalComposerContext();
  const ref = useRef(onFiles);
  ref.current = onFiles;
  useEffect(
    () =>
      editor.registerCommand(
        DRAG_DROP_PASTE,
        (files) => {
          if (files.length > 0) ref.current(files);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );
  return null;
}

export function EntityTextEditor({
  value,
  editable,
  runtime,
  workspaceId,
  source,
  sourceLabel,
  sourceIcon,
  currentUserId,
  placeholder,
  ariaLabel,
  className,
  placeholderClassName,
  onCommit,
  onFiles,
}: EntityTextEditorProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: "entity-text",
      editable,
      onError: (error: Error) => {
        console.error("EntityTextEditor error:", error);
      },
      nodes: [EntityRefNode],
      theme: THEME,
    }),
    [editable],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={ariaLabel ?? "Description"}
              className={cn(
                "min-h-16 rounded-md text-sm leading-relaxed text-foreground outline-none",
                editable ? "focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default",
                className,
              )}
            />
          }
          placeholder={
            placeholder ? (
              <div
                className={cn(
                  "pointer-events-none absolute left-0 top-0 text-sm text-muted-foreground",
                  placeholderClassName,
                )}
              >
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <SeedPlugin value={value} />
      {editable ? <CommitOnBlurPlugin onCommit={onCommit} /> : null}
      {editable && onFiles ? <FilesPlugin onFiles={onFiles} /> : null}
      {editable ? (
        <>
          <MentionMenuPlugin
            triggerChar="@"
            trigger="mention"
            runtime={runtime}
            workspaceId={workspaceId}
            source={source}
            sourceLabel={sourceLabel}
            sourceIcon={sourceIcon}
            currentUserId={currentUserId}
          />
          <MentionMenuPlugin
            triggerChar="/"
            trigger="ref"
            runtime={runtime}
            workspaceId={workspaceId}
            source={source}
            sourceLabel={sourceLabel}
            sourceIcon={sourceIcon}
            currentUserId={currentUserId}
          />
        </>
      ) : null}
    </LexicalComposer>
  );
}
