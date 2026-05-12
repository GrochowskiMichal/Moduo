import { useEffect, useState, useMemo, useRef } from "react";
import { CodeHighlightNode, CodeNode, registerCodeHighlighting } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { CollaborationPlugin, CollaborationPluginV2__EXPERIMENTAL } from "@lexical/react/LexicalCollaborationPlugin";
import { LexicalCollaboration } from "@lexical/react/LexicalCollaborationContext";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { TableNode, TableCellNode, TableRowNode } from "@lexical/table";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { $isListItemNode } from "@lexical/list";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { SlashCommandPlugin } from "./plugins/SlashCommandPlugin";
import { EmbedNode } from "./nodes/EmbedNode";

type Props = {
  noteId: string;
  title: string;
  editable?: boolean;
  onTitleChange: (nextTitle: string) => void;
  syncEngine: NotesSyncEngine;
  workspaceId?: string;
};

function NotesCodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerCodeHighlighting(editor), [editor]);
  return null;
}

function NotesListTabIndentationPlugin() {
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

          return {
            inListItem: true,
            canIndent: hasPreviousSibling,
          };
        });
        if (!listContext.inListItem) return false;

        event.preventDefault();

        if (!event.shiftKey && !listContext.canIndent) {
          return true;
        }

        editor.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
}

export function LexicalNoteEditor({ noteId, title, editable = true, onTitleChange, syncEngine, workspaceId }: Props) {
  const [draftTitle, setDraftTitle] = useState(title);
  const collabSession = useMemo(() => syncEngine.getOrCreateSession(noteId), [noteId, syncEngine]);
  const [collabReady, setCollabReady] = useState(() => collabSession.persistence.synced);
  const collabMode = useMemo(() => {
    if (collabSession.doc.share.has("root-v2")) return "v2";
    if (collabSession.doc.store.clients.size === 0) return "v2";
    return "v1";
  }, [collabSession]);
  useEffect(() => {
    let active = true;
    setCollabReady(collabSession.persistence.synced);

    if (!collabSession.persistence.synced) {
      collabSession.persistence.whenSynced.then(() => {
        if (active) {
          setCollabReady(true);
        }
      }).catch(err => {
        console.error(`[LexicalNoteEditor] session.whenSynced ERROR: noteId=${noteId}, error=${err}`);
      });
    }

    return () => {
      active = false;
    };
  }, [collabSession, noteId]);

  // Keep a ref to the most-recent in-flight flush promise so we can kick it off
  // from the synchronous effect cleanup (React cleanups cannot be async) without
  // losing the Promise. NotesSyncEngine.destroy() awaits all pending flushes
  // before tearing down docs, so this just ensures the flush is *started*.
  const flushingRef = useRef<Promise<void> | null>(null);

  useEffect(() => () => {
    flushingRef.current = syncEngine.flushNote(noteId);
  }, [noteId, syncEngine]);

  useEffect(() => {
    setDraftTitle(title);
  }, [noteId, title]);

  useEffect(() => {
    if (draftTitle === title) return;
    const timer = setTimeout(() => {
      onTitleChange(draftTitle);
    }, 350);
    return () => clearTimeout(timer);
  }, [draftTitle, onTitleChange, title]);

  useEffect(() => {
    if (collabReady && collabMode === "v2") {
      setTimeout(() => syncEngine.pokeNoteDoc(noteId), 0);
    }
  }, [collabReady, collabMode, noteId, syncEngine]);

  const initialConfig = useMemo(() => ({
    namespace: `moduo-note-${noteId}`,
    editable,
    onError: (error: Error) => {
      console.error("Lexical editor error:", error);
    },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode, HorizontalRuleNode, TableNode, TableCellNode, TableRowNode, EmbedNode],
    theme: {
      paragraph: "notes-p",
      heading: {
        h1: "notes-h1",
        h2: "notes-h2",
        h3: "notes-h3",
      },
      quote: "notes-quote",
      list: {
        ul: "notes-list-ul",
        ol: "notes-list-ol",
        listitem: "notes-list-item",
        checklist: "notes-checklist",
        listitemChecked: "notes-list-item-checked",
        listitemUnchecked: "notes-list-item-unchecked",
      },
      text: {
        code: "notes-inline-code",
      },
      code: "notes-code-block",
      link: "notes-link",
      table: "notes-table",
      tableRow: "notes-table-row",
      tableCell: "notes-table-cell",
      tableCellHeader: "notes-table-cell-header",
    },
  }), [noteId, editable]);

  return (
    <div className="flex w-full flex-col gap-3">
      <input
        className="w-full border-0 bg-transparent py-2 font-display text-3xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0"
        value={draftTitle}
        disabled={!editable}
        onChange={(event) => setDraftTitle(event.target.value)}
        placeholder="Untitled"
      />

      <div className="relative w-full">
        {collabReady ? (
          <LexicalCollaboration key={`collab-${noteId}`}>
            <LexicalComposer initialConfig={initialConfig} key={noteId}>
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="min-h-[50vh] font-sans text-base leading-relaxed text-foreground outline-none" />
                }
                placeholder={
                  <div className="pointer-events-none absolute left-0 top-0 font-sans text-base leading-relaxed text-muted-foreground">
                    Type '/' for commands…
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <CheckListPlugin />
              <NotesListTabIndentationPlugin />
              <NotesCodeHighlightPlugin />
              <LinkPlugin />
              <TablePlugin />
              <SlashCommandPlugin workspaceId={workspaceId} />
              {collabMode === "v2" && collabSession ? (
                <CollaborationPluginV2__EXPERIMENTAL
                  id={noteId}
                  doc={collabSession.doc}
                  provider={collabSession.provider}
                  __shouldBootstrapUnsafe={true}
                />
              ) : (
                <CollaborationPlugin
                  id={noteId}
                  providerFactory={syncEngine.providerFactory}
                  shouldBootstrap={true}
                />
              )}
            </LexicalComposer>
          </LexicalCollaboration>
        ) : (
          <div className="grid h-32 place-content-center text-sm text-muted-foreground">
            Preparing note…
          </div>
        )}
      </div>
    </div>
  );
}
