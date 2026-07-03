/**
 * Notes v2 editor pane (Wave-3 NO-3, AC1) — the rebuilt center pane on the
 * NO-2 sync engine. Tokens-only chrome; the Lexical block theme reuses the
 * token-driven `notes-*` classes in global.css.
 *
 * First line = title: there is no title input. The first block renders
 * display-sized (see `.notes-editor-v2` in global.css) and a debounced doc
 * listener derives the title for the sidebar/registry via onTitleDerived.
 *
 * The slash menu + @mentions ride the LEGACY plugins until NO-4 reworks the
 * grammar (they're editor-agnostic Lexical plugins).
 */

import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { CodeHighlightNode, CodeNode, registerCodeHighlighting } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode, $isListItemNode, ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { CollaborationPluginV2__EXPERIMENTAL } from "@lexical/react/LexicalCollaborationPlugin";
import { LexicalCollaboration } from "@lexical/react/LexicalCollaborationContext";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $createHeadingNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { TableNode, TableCellNode, TableRowNode } from "@lexical/table";
import { CLEAR_DIFF_VERSIONS_COMMAND__EXPERIMENTAL } from "@lexical/yjs";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { SlashCommandPlugin } from "../editor/plugins/SlashCommandPlugin";
import { EmbedNode } from "../editor/nodes/EmbedNode";
import { EntityRefNode } from "@/features/spine/editor/entity-ref-node";
import { MentionMenuPlugin } from "@/features/spine/editor/mention-menu-plugin";
import { useAuth } from "@/providers/auth-provider";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { deriveBody } from "../sync/doc-text";
import { firstLineTitle, TITLE_DEBOUNCE_MS } from "../title";

type Props = {
  engine: NotesSyncEngineV2;
  workspaceId: string;
  noteId: string;
  editable?: boolean;
  titleForLabel: string;
  /** Debounced first-line title (AC1) — the page maps it to notes.rename. */
  onTitleDerived: (title: string) => void;
  /** Seed the self-teaching welcome content once, when this doc is empty. */
  seedWelcome?: boolean;
};

function CodeHighlightingPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerCodeHighlighting(editor), [editor]);
  return null;
}

/** Load existing Y.Doc content into the editor right after the collab
 * binding registers its command handler (same trick as the legacy editor). */
function SyncFromYjsPlugin({ doc }: { doc: Y.Doc }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const id = setTimeout(() => {
      editor.dispatchCommand(CLEAR_DIFF_VERSIONS_COMMAND__EXPERIMENTAL, undefined);
    }, 0);
    return () => clearTimeout(id);
  }, [editor, doc]);
  return null;
}

function ListTabIndentationPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (!event) return false;
        const listContext = editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return { inListItem: false, canIndent: false };
          let node = selection.anchor.getNode();
          while (node && !$isListItemNode(node)) {
            const parent = node.getParent();
            if (!parent) break;
            node = parent;
          }
          if (!$isListItemNode(node)) return { inListItem: false, canIndent: false };
          const hasPreviousSibling = $isListItemNode(node.getPreviousSibling());
          return { inListItem: true, canIndent: hasPreviousSibling };
        });
        if (!listContext.inListItem) return false;
        event.preventDefault();
        if (!event.shiftKey && !listContext.canIndent) return true;
        editor.dispatchCommand(
          event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
          undefined,
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);
  return null;
}

/** Debounced first-line-title derivation straight off the Y.Doc — editor-
 * independent, so remote edits retitle too. */
function TitleDerivationPlugin({
  doc,
  onTitleDerived,
}: {
  doc: Y.Doc;
  onTitleDerived: (title: string) => void;
}) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onTitleDerived(firstLineTitle(deriveBody(doc).text));
      }, TITLE_DEBOUNCE_MS);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [doc, onTitleDerived]);
  return null;
}

/** One-shot self-teaching content for a fresh workspace's welcome note
 * (DESIGN_BRIEF §4). Canonical Lexical nodes → syncs like any typed content.
 * Task lines/chips join the demo as their blocks land (NO-4/NO-5). */
function WelcomeSeedPlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!enabled) return;
    // After the collab bootstrap settles.
    const id = setTimeout(() => {
      editor.update(() => {
        const root = $getRoot();
        if (root.getTextContent().trim() !== "") return;
        root.clear();
        const h1 = $createHeadingNode("h1");
        h1.append($createTextNode("Welcome to Notes"));
        const p1 = $createParagraphNode();
        p1.append(
          $createTextNode(
            "This is your space to write things down — the first line of any note is its title.",
          ),
        );
        const p2 = $createParagraphNode();
        p2.append(
          $createTextNode(
            "Type / for blocks (headings, lists, checkboxes), or @ to mention a teammate. Notes nest: create a child page from the sidebar's + and drag rows to organize.",
          ),
        );
        const list = $createListNode("check");
        const li1 = $createListItemNode(true);
        li1.append($createTextNode("Open Notes"));
        const li2 = $createListItemNode(false);
        li2.append($createTextNode("Write a first thought (⌘⇧N captures from anywhere)"));
        const li3 = $createListItemNode(false);
        li3.append($createTextNode("Delete this note whenever you're done with it"));
        list.append(li1, li2, li3);
        root.append(h1, p1, p2, list);
      });
    }, 120);
    return () => clearTimeout(id);
  }, [editor, enabled]);
  return null;
}

export function NoteEditor({
  engine,
  workspaceId,
  noteId,
  editable = true,
  titleForLabel,
  onTitleDerived,
  seedWelcome = false,
}: Props) {
  const { userId, runtime } = useAuth();
  const session = useMemo(() => engine.getOrCreateSession(noteId), [engine, noteId]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    void session.booted.then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [session]);

  // Leaving the note kicks a flush (the engine also flushes on debounce).
  useEffect(
    () => () => {
      void engine.flushNote(noteId);
    },
    [engine, noteId],
  );

  const initialConfig = useMemo(
    () => ({
      namespace: `moduo-note-${noteId}`,
      editable,
      onError: (error: Error) => {
        console.error("Lexical editor error:", error);
      },
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        CodeNode,
        CodeHighlightNode,
        LinkNode,
        HorizontalRuleNode,
        TableNode,
        TableCellNode,
        TableRowNode,
        EmbedNode,
        EntityRefNode,
      ],
      theme: {
        paragraph: "notes-p",
        heading: { h1: "notes-h1", h2: "notes-h2", h3: "notes-h3" },
        quote: "notes-quote",
        list: {
          ul: "notes-list-ul",
          ol: "notes-list-ol",
          listitem: "notes-list-item",
          checklist: "notes-checklist",
          listitemChecked: "notes-list-item-checked",
          listitemUnchecked: "notes-list-item-unchecked",
        },
        text: { code: "notes-inline-code" },
        code: "notes-code-block",
        link: "notes-link",
        table: "notes-table",
        tableRow: "notes-table-row",
        tableCell: "notes-table-cell",
        tableCellHeader: "notes-table-cell-header",
      },
    }),
    [noteId, editable],
  );

  if (!ready) {
    return (
      <div className="grid h-full place-content-center text-sm text-muted-foreground">
        Preparing note…
      </div>
    );
  }

  return (
    <div className="notes-editor-v2 relative h-full min-h-0 overflow-auto bg-background">
      <LexicalCollaboration key={`collab-${noteId}`}>
        <LexicalComposer initialConfig={initialConfig} key={noteId}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="mx-auto min-h-full w-full max-w-3xl px-6 pb-24 pt-10 text-base leading-relaxed text-foreground outline-none" />
            }
            placeholder={
              <div className="pointer-events-none absolute left-1/2 top-10 w-full max-w-3xl -translate-x-1/2 px-6 font-display text-3xl font-semibold text-muted-foreground/60">
                Untitled
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <CheckListPlugin />
          <ListTabIndentationPlugin />
          <CodeHighlightingPlugin />
          <LinkPlugin />
          <TablePlugin />
          <SlashCommandPlugin
            workspaceId={workspaceId}
            source={{ type: "note", id: noteId }}
            sourceLabel={titleForLabel || "Untitled"}
          />
          <MentionMenuPlugin
            workspaceId={workspaceId ?? null}
            runtime={runtime}
            source={{ type: "note", id: noteId }}
            sourceLabel={titleForLabel || "Untitled"}
            sourceIcon="note"
            currentUserId={userId}
          />
          <CollaborationPluginV2__EXPERIMENTAL
            id={noteId}
            doc={session.doc}
            provider={session.provider as any}
            __shouldBootstrapUnsafe={true}
          />
          <SyncFromYjsPlugin doc={session.doc} />
          <TitleDerivationPlugin doc={session.doc} onTitleDerived={onTitleDerived} />
          <WelcomeSeedPlugin enabled={seedWelcome && editable} />
        </LexicalComposer>
      </LexicalCollaboration>
    </div>
  );
}
