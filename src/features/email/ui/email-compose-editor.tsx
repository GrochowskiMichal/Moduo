// The compose rich-text body (EM-7, AC10 — spec assumption 13: Lexical, in-repo,
// bounded toolbar → HTML + derived plain text). A minimal standalone (non-collab)
// Lexical editor: seeds from the draft's initial HTML (signature + quoted original),
// a Bold/Italic/Underline/List/Link toolbar, and exposes getContent() → { html,
// text } through a handle the compose dialog reads on Send. Tokens-only theme
// (Tailwind utilities), so no bespoke CSS. Matches the notes editor's import style.

import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode } from "@lexical/list";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createParagraphNode, $getRoot, $insertNodes, FORMAT_TEXT_COMMAND } from "lexical";
import { Bold, Italic, Link2, List, Underline } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { IconButton } from "../../../components/ui/icon-button";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { EntityRefNode } from "../../spine/editor/entity-ref-node";
import { MentionMenuPlugin } from "../../spine/editor/mention-menu-plugin";

/** Read handle the compose dialog uses to pull the body on Send. */
export type ComposeEditorHandle = {
  getContent: () => { html: string; text: string };
};

/** Tokens-only theme (Tailwind utilities → no bespoke CSS, no raw values). */
const THEME = {
  paragraph: "mb-2 last:mb-0",
  quote: "border-l-2 border-border pl-3 text-muted-foreground",
  list: {
    ul: "list-disc pl-5",
    ol: "list-decimal pl-5",
    listitem: "mb-0.5",
  },
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
  },
  link: "text-primary underline",
};

function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const insertLink = () => {
    const url = window.prompt("Link URL");
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  };
  return (
    <div className="flex items-center gap-0.5 border-y border-border py-1">
      <IconButton
        icon={Bold}
        label="Bold"
        size="sm"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      />
      <IconButton
        icon={Italic}
        label="Italic"
        size="sm"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      />
      <IconButton
        icon={Underline}
        label="Underline"
        size="sm"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}
      />
      <IconButton
        icon={List}
        label="Bulleted list"
        size="sm"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      />
      <IconButton icon={Link2} label="Insert link" size="sm" onClick={insertLink} />
    </div>
  );
}

/** Seed the editor once from the draft's initial HTML (signature + quoted body). */
function SeedHtmlPlugin({ html }: { html: string }) {
  const [editor] = useLexicalComposerContext();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const anchor = $createParagraphNode();
      root.append(anchor);
      anchor.select();
      const dom = new DOMParser().parseFromString(html || "", "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      if (nodes.length) $insertNodes(nodes);
      // Cursor at the top (above the quoted original) so replies type first.
      $getRoot().selectStart();
    });
  }, [editor, html]);
  return null;
}

/** Publish the read handle to the parent's ref. */
function ExportPlugin({
  handleRef,
}: {
  handleRef: React.MutableRefObject<ComposeEditorHandle | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    handleRef.current = {
      getContent: () =>
        editor.read(() => ({
          html: $generateHtmlFromNodes(editor, null),
          text: $getRoot().getTextContent(),
        })),
    };
    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef]);
  return null;
}

type Props = {
  initialHtml: string;
  handleRef: React.MutableRefObject<ComposeEditorHandle | null>;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
};

export function EmailComposeEditor({ initialHtml, handleRef, runtime, workspaceId }: Props) {
  const initialConfig = useMemo(
    () => ({
      namespace: "email-compose",
      onError: (error: Error) => {
        console.error("Compose editor error:", error);
      },
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        AutoLinkNode,
        EntityRefNode,
      ],
      theme: THEME,
    }),
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ToolbarPlugin />
      <div className="relative min-h-48 rounded-md bg-muted/40">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Message body"
              className="min-h-48 rounded-md px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
              Write your message…
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <AutoFocusPlugin />
      <SeedHtmlPlugin html={initialHtml} />
      <ExportPlugin handleRef={handleRef} />
      {/* DF-23: `@mention` / `/ref` an internal entity in the body. A compose
          draft has no persistable source entity, so `source={null}` → the chip
          is inserted and deep-links, but no `entity_link` is written; on Send
          the chip flattens to its label (email-compose.tsx `stripEntityRefAttrs`). */}
      <MentionMenuPlugin
        triggerChar="@"
        trigger="mention"
        runtime={runtime}
        workspaceId={workspaceId}
        source={null}
      />
      <MentionMenuPlugin
        triggerChar="/"
        trigger="ref"
        runtime={runtime}
        workspaceId={workspaceId}
        source={null}
      />
    </LexicalComposer>
  );
}
