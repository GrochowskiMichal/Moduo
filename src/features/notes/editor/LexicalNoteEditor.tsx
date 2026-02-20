import { useEffect, useState, useMemo } from "react";
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
import { CollaborationPlugin } from "@lexical/react/LexicalCollaborationPlugin";
import { LexicalCollaboration } from "@lexical/react/LexicalCollaborationContext";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
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

export function LexicalNoteEditor({ noteId, title, editable = true, onTitleChange, syncEngine }: Props) {
  const [draftTitle, setDraftTitle] = useState(title);

  useEffect(() => {
    console.log("[notes-editor] mounted", { noteId, editable });
    return () => {
      console.log("[notes-editor] unmounted", { noteId });
    };
  }, [editable, noteId]);

  useEffect(() => {
    console.log("[notes-editor] note-changed", { noteId, titleLength: title.length });
  }, [noteId, title]);

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
            <NotesCodeHighlightPlugin />
            <LinkPlugin />
            <SlashCommandPlugin />
            <CollaborationPlugin
              id={noteId}
              providerFactory={syncEngine.providerFactory}
              shouldBootstrap={true}
            />
          </LexicalComposer>
        </LexicalCollaboration>
      </div>
    </div>
  );
}
