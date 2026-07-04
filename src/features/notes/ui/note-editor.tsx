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

import { useEffect, useMemo, useRef, useState } from "react";
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
import { SlashMenuPlugin } from "../editor/plugins/slash-menu-plugin";
import { MarkdownClipboardPlugin } from "../editor/plugins/markdown-clipboard-plugin";
import { TaskLinePlugin } from "../editor/plugins/task-line-plugin";
import { EmbedNode } from "../editor/nodes/EmbedNode";
import { TaskLineNode } from "../editor/nodes/task-line-node";
import { $createPageRowNode, PageRowNode } from "../editor/nodes/page-row-node";
import {
  INSERT_PAGE_ROW_EVENT,
  NotesEditorBridgeContext,
  type InsertPageRowDetail,
  type NotesEditorBridge,
} from "../editor/notes-editor-bridge";
import { EntityRefNode } from "@/features/spine/editor/entity-ref-node";
import { MentionMenuPlugin } from "@/features/spine/editor/mention-menu-plugin";
import { useAuth } from "@/providers/auth-provider";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { deriveBody } from "../sync/doc-text";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { NOTES_TRANSFORMERS } from "../editor/markdown";
import { peekNoteSeed, takeNoteSeed } from "../import-seed";
import { displayTitle, firstLineTitle, TITLE_DEBOUNCE_MS } from "../title";

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
  /** Live module data + actions for page-rows and /page (NO-4). */
  bridge: NotesEditorBridge;
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
  // The callback rides a ref: an inline prop would re-run the effect on every
  // page re-render (sync-status flips…), tearing down the pending debounce
  // timer before it can ever fire (caught in NO-3 live-verify).
  const callbackRef = useRef(onTitleDerived);
  callbackRef.current = onTitleDerived;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        callbackRef.current(firstLineTitle(deriveBody(doc).text));
      }, TITLE_DEBOUNCE_MS);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [doc]);
  return null;
}

/** The sidebar's "+ child" mirrors into the OPEN parent as a page-row — via
 * the canonical Lexical path, never raw Yjs XML (spec risk #10 posture). */
function InsertPageRowPlugin({
  noteId,
  bridge,
}: {
  noteId: string;
  bridge: NotesEditorBridge;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const onInsert = (event: Event) => {
      const detail = (event as CustomEvent<InsertPageRowDetail>).detail;
      if (!detail || detail.parentId !== noteId || !detail.childId) return;
      const label = displayTitle(bridge.getNoteMeta(detail.childId)?.title ?? "");
      editor.update(() => {
        const root = $getRoot();
        const row = $createPageRowNode(detail.childId, label);
        const last = root.getLastChild();
        // Reuse a trailing empty paragraph — repeated child-creates must not
        // pile up `row, ∅, row, ∅…` junk.
        if (last && last.getType() === "paragraph" && last.getTextContent().trim() === "") {
          last.insertBefore(row);
        } else {
          root.append(row);
          root.append($createParagraphNode());
        }
      });
    };
    window.addEventListener(INSERT_PAGE_ROW_EVENT, onInsert);
    return () => window.removeEventListener(INSERT_PAGE_ROW_EVENT, onInsert);
  }, [editor, noteId, bridge]);
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
        // Teach the task-line gesture without minting a demo task into the
        // real Tasks Inbox — the seed stays inert (NO-5 decision).
        const p3 = $createParagraphNode();
        p3.append(
          $createTextNode(
            "Checkboxes below stay humble checkboxes. When a line is real work, type /task (or hover a checkbox and press ⌘⇧T) — the line becomes a live task, synced with Tasks both ways.",
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
        root.append(h1, p1, p2, p3, list);
      });
    }, 120);
    return () => clearTimeout(id);
  }, [editor, enabled]);
  return null;
}

/** Materialize an imported note's body (NO-8): the batched import writes
 * body_md but not the CRDT doc; on first open this session, convert the pending
 * markdown into the empty doc via the same transformers the paste path uses. */
function SeedFromMarkdownPlugin({ noteId, enabled }: { noteId: string; enabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!enabled) return;
    // Peek (don't consume) — a fast unmount before the deferred apply must not
    // lose the seed; it re-applies on the next open (validator M2). Consume
    // only once it's actually applied, or the doc is already materialized.
    const md = peekNoteSeed(noteId);
    if (!md) return;
    const id = setTimeout(() => {
      editor.update(() => {
        const root = $getRoot();
        if (root.getTextContent().trim() !== "") {
          takeNoteSeed(noteId); // already materialized — drop the stale seed
          return;
        }
        $convertFromMarkdownString(md, NOTES_TRANSFORMERS);
        takeNoteSeed(noteId);
      });
    }, 140);
    return () => clearTimeout(id);
  }, [editor, noteId, enabled]);
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
  bridge,
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
        PageRowNode,
        TaskLineNode,
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
      <NotesEditorBridgeContext.Provider value={bridge}>
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
          <SlashMenuPlugin
            workspaceId={workspaceId}
            runtime={runtime}
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
            // The Notes grammar: @ = workspace people ONLY (AC5); a mention
            // writes the person-targeted activity row → their notification.
            peopleOnly
            onMentionPerson={
              runtime && editable
                ? (memberId) =>
                    runtime.notesV2.mention({
                      workspaceId,
                      noteId,
                      mentionedUserIds: [memberId],
                    })
                : undefined
            }
          />
          <MarkdownClipboardPlugin />
          <TaskLinePlugin editable={editable} noteId={noteId} />
          <InsertPageRowPlugin noteId={noteId} bridge={bridge} />
          <CollaborationPluginV2__EXPERIMENTAL
            id={noteId}
            doc={session.doc}
            provider={session.provider as any}
            __shouldBootstrapUnsafe={true}
          />
          <SyncFromYjsPlugin doc={session.doc} />
          <TitleDerivationPlugin doc={session.doc} onTitleDerived={onTitleDerived} />
          <WelcomeSeedPlugin enabled={seedWelcome && editable} />
          <SeedFromMarkdownPlugin noteId={noteId} enabled={editable} />
        </LexicalComposer>
      </LexicalCollaboration>
      </NotesEditorBridgeContext.Provider>
    </div>
  );
}
