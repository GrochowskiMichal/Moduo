import { useEffect, useState, useMemo, useRef } from "react";
import * as Y from "yjs";
import { CodeHighlightNode, CodeNode, registerCodeHighlighting } from "@lexical/code";
import { $createLinkNode, LinkNode } from "@lexical/link";
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
import { CLEAR_DIFF_VERSIONS_COMMAND__EXPERIMENTAL } from "@lexical/yjs";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { SlashCommandPlugin } from "./plugins/SlashCommandPlugin";
import { NotesDividerShortcutPlugin, NotesMarkdownListShortcutPlugin } from "./plugins/MarkdownPlugins";
import { NotesListTabIndentationPlugin } from "./plugins/ListPlugins";
import { NotesToggleInteractionPlugin, NotesToggleEscapePlugin, NotesToggleTabPlugin } from "./plugins/TogglePlugins";
import { NotesCodeBlockEscapePlugin } from "./plugins/CodeBlockPlugins";
import { NotesChildLinkPlugin } from "./plugins/ChildLinkPlugin";
import { ToggleNode } from "./nodes/ToggleNode";

type Props = {
  noteId: string;
  title: string;
  editable?: boolean;
  onTitleChange: (nextTitle: string) => void;
  syncEngine: NotesSyncEngine;
};

function NotesCodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerCodeHighlighting(editor), [editor]);
  return null;
}

// Triggers syncYjsStateToLexicalV2__EXPERIMENTAL after the collab plugin sets up its
// command handler. This loads existing Y.Doc content into the Lexical editor on mount.
function SyncFromYjsPlugin({ doc }: { doc: Y.Doc }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const id = setTimeout(() => {
      editor.dispatchCommand(CLEAR_DIFF_VERSIONS_COMMAND__EXPERIMENTAL, undefined);
    }, 0);
    return () => clearTimeout(id);
  }, [editor, doc]); // doc dep so re-runs when session changes (e.g. tab switch)
  return null;
}

export function LexicalNoteEditor({ noteId, title, editable = true, onTitleChange, syncEngine }: Props) {
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
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode, HorizontalRuleNode, TableNode, TableCellNode, TableRowNode, ToggleNode],
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
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <input
        className="mx-[22px] mb-[6px] mt-[18px] border-0 bg-transparent py-2 text-[30px] font-bold leading-[1.2] text-[#f1f1f1] outline-none"
        value={draftTitle}
        disabled={!editable}
        onChange={(event) => setDraftTitle(event.target.value)}
        placeholder="Untitled"
      />

      <div className="relative h-full min-h-0 overflow-auto">
        {collabReady ? (
          <LexicalCollaboration key={`collab-${noteId}`}>
            <LexicalComposer initialConfig={initialConfig} key={noteId}>
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="notes-editor-content min-h-full px-[22px] pb-[90px] pt-[6px] text-[16px] leading-[1.7] text-[#cfcfcf] outline-none" />
                }
                placeholder={
                  <div className="pointer-events-none absolute left-[22px] top-[6px] text-[16px] leading-[1.7] text-[#7a7a7a]">
                    Type '/' for commands...
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <CheckListPlugin />
              <NotesDividerShortcutPlugin />
              <NotesMarkdownListShortcutPlugin />
              <NotesListTabIndentationPlugin />
              <NotesToggleInteractionPlugin />
              <NotesToggleEscapePlugin />
              <NotesToggleTabPlugin />
              <NotesCodeBlockEscapePlugin />
              <NotesChildLinkPlugin noteId={noteId} />
              <NotesCodeHighlightPlugin />
              <LinkPlugin />
              <TablePlugin />
              <SlashCommandPlugin />
              {collabMode === "v2" && collabSession ? (
                <>
                  <CollaborationPluginV2__EXPERIMENTAL
                    id={noteId}
                    doc={collabSession.doc}
                    provider={collabSession.provider}
                    __shouldBootstrapUnsafe={true}
                  />
                  <SyncFromYjsPlugin doc={collabSession.doc} />
                </>
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
          <div className="grid h-full place-content-center text-[13px] text-[#7a7a7a]">
            Preparing note...
          </div>
        )}
      </div>
    </div>
  );
}
