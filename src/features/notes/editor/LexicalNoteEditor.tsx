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
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
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

function NotesListTabIndentationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (!event) return false;
        const inListItem = editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          let node = selection.anchor.getNode();
          while (node && !$isListItemNode(node)) {
            const parent = node.getParent();
            if (!parent) break;
            node = parent;
          }
          return $isListItemNode(node);
        });
        if (!inListItem) return false;

        event.preventDefault();
        editor.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
}

export function LexicalNoteEditor({ noteId, title, editable = true, onTitleChange, syncEngine }: Props) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [bootstrapInfo, setBootstrapInfo] = useState<{ noteId: string, ready: boolean }>({
    noteId,
    ready: false,
  });
  const collabReady = bootstrapInfo.noteId === noteId && bootstrapInfo.ready;
  const collabSession = useMemo(
    () => (collabReady ? syncEngine.getOrCreateSession(noteId) : null),
    [collabReady, noteId, syncEngine]
  );
  const collabMode = useMemo(() => {
    if (!collabSession) return "v1";
    if (collabSession.doc.share.has("root-v2")) return "v2";
    if (collabSession.doc.store.clients.size === 0) return "v2";
    return "v1";
  }, [collabSession]);
  useEffect(() => {
    let active = true;
    setBootstrapInfo({ noteId, ready: false });

    const session = syncEngine.getOrCreateSession(noteId);
    session.persistence.whenSynced.then(() => {
      if (active) {
        setBootstrapInfo({ noteId, ready: true });
      }
    }).catch(err => {
      console.error(`[LexicalNoteEditor] session.whenSynced ERROR: noteId=${noteId}, error=${err}`);
    });

    return () => {
      active = false;
    };
  }, [noteId, syncEngine]);

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
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode, HorizontalRuleNode],
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

      <div className="relative h-full min-h-0 overflow-auto bg-[#111111]">
        {collabReady ? (
          <LexicalCollaboration key={`collab-${noteId}`}>
            <LexicalComposer initialConfig={initialConfig} key={noteId}>
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="min-h-full px-[22px] pb-[90px] pt-[6px] text-[16px] leading-[1.7] text-[#cfcfcf] outline-none" />
                }
                placeholder={
                  <div className="pointer-events-none absolute left-[22px] top-3 text-[#7a7a7a]">
                    Type '/' for commands...
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <CheckListPlugin />
              <TabIndentationPlugin maxIndent={8} />
              <NotesListTabIndentationPlugin />
              <NotesCodeHighlightPlugin />
              <LinkPlugin />
              <SlashCommandPlugin />
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
          <div className="grid h-full place-content-center text-[13px] text-[#7a7a7a]">
            Preparing note...
          </div>
        )}
      </div>
    </div>
  );
}
