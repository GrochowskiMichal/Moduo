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

import { registerCodeHighlighting } from "@lexical/code-prism";
import { $createListItemNode, $createListNode, $isListItemNode } from "@lexical/list";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalCollaboration } from "@lexical/react/LexicalCollaborationContext";
import { CollaborationPluginV2__EXPERIMENTAL } from "@lexical/react/LexicalCollaborationPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { $createHeadingNode } from "@lexical/rich-text";
import { CLEAR_DIFF_VERSIONS_COMMAND__EXPERIMENTAL } from "@lexical/yjs";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";

import { $createEntityRefNode } from "@/features/spine/editor/entity-ref-node";
import { MentionMenuPlugin } from "@/features/spine/editor/mention-menu-plugin";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import { $noteText, NOTES_DOC_ROOT } from "../editor/doc-markdown";
import { NOTES_TRANSFORMERS } from "../editor/markdown";
import {
  INSERT_ENTITY_CHIP_EVENT,
  INSERT_PAGE_ROW_EVENT,
  type InsertEntityChipDetail,
  type InsertPageRowDetail,
  type NotesEditorBridge,
  NotesEditorBridgeContext,
} from "../editor/notes-editor-bridge";
import { BlockHandlePlugin } from "../editor/plugins/block-handle-plugin";
import { CommentMarksPlugin } from "../editor/plugins/comment-marks-plugin";
import { FormatToolbarPlugin } from "../editor/plugins/format-toolbar-plugin";
import { LinkDialogPlugin } from "../editor/plugins/link-dialog-plugin";
import { MarkdownClipboardPlugin } from "../editor/plugins/markdown-clipboard-plugin";
import { NoteLinkPlugin } from "../editor/plugins/note-link-plugin";
import { SlashMenuPlugin } from "../editor/plugins/slash-menu-plugin";
import { TaskLinePlugin } from "../editor/plugins/task-line-plugin";
import { NOTE_EDITOR_NODES } from "../editor/schema/nodes";
import { $createPageRowNode } from "../editor/schema/page-row-node";
import { installNoteNodeViews } from "../editor/views";
import { isAgentOrigin } from "../sync/agent-origin";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { displayTitle, firstLineTitle, TITLE_DEBOUNCE_MS } from "../title";

// The schema nodes draw through the view registry (NR-3); fill it once.
installNoteNodeViews();

type Props = {
  engine: NotesSyncEngineV2;
  workspaceId: string;
  noteId: string;
  editable?: boolean;
  titleForLabel: string;
  /** Debounced first-line title (AC1) — the page maps it to notes.rename. */
  onTitleDerived: (title: string) => void;
  /** Live module data + actions for page-rows and /page (NO-4). */
  bridge: NotesEditorBridge;
  /** Put the caret in the note on open (a fresh capture, NR-2). */
  autoFocus?: boolean;
  /** The note's Full width (NR-3): the column drops the reading measure. */
  fullWidth?: boolean;
  /** Drawn under the title line (the meta line). */
  belowTitle?: ReactNode;
  /** Drawn after the document (the Linked-from footer). */
  footer?: ReactNode;
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

/** Debounced first-line-title derivation on this editor's own edits. A pull,
 * a teammate's live edit or an agent write already carries its title on the
 * server: deriving it here too sent one rename per open editor, and an empty
 * doc that hadn't loaded yet retitled a note "Untitled". */
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
  const [editor] = useLexicalComposerContext();
  const callbackRef = useRef(onTitleDerived);
  callbackRef.current = onTitleDerived;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || isAgentOrigin(origin)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // The live editor already holds the doc's state (the binding applies
        // remote edits too): read its text, no clone, no markdown conversion.
        callbackRef.current(firstLineTitle(editor.getEditorState().read($noteText)));
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

/**
 * Draws `children` right under the document's first block (the title line).
 * Lexical owns every node inside the contenteditable and reclaims foreign DOM
 * there (the NO-5 trap), so this is an overlay NEXT TO it: the first block
 * reserves the room (`data-meta-line` in global.css) and the overlay is placed
 * at its bottom edge, re-measured on every editor update and every resize
 * (a title that wraps to a second line pushes the line down with it).
 */
function BelowTitleSlot({ children }: { children: ReactNode }) {
  const [editor] = useLexicalComposerContext();
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const first = editor.getRootElement()?.firstElementChild as HTMLElement | null;
        setTop(first ? first.offsetTop + first.offsetHeight : null);
      });
    };
    const observer = new ResizeObserver(measure);
    const unregisterRoot = editor.registerRootListener((root, prev) => {
      if (prev) observer.unobserve(prev);
      if (root) observer.observe(root);
      measure();
    });
    const unregisterUpdate = editor.registerUpdateListener(measure);
    return () => {
      cancelAnimationFrame(frame);
      unregisterRoot();
      unregisterUpdate();
      observer.disconnect();
    };
  }, [editor]);
  if (top === null) return null;
  return (
    <div className="absolute inset-x-0 px-6 pt-1" style={{ top }}>
      {children}
    </div>
  );
}

/** The sidebar's "+ child" mirrors into the OPEN parent as a page-row — via
 * the canonical Lexical path, never raw Yjs XML (spec risk #10 posture). */
function InsertPageRowPlugin({ noteId, bridge }: { noteId: string; bridge: NotesEditorBridge }) {
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

/** Drag-into-editor (NO-7b): the page fires this when an entity is dropped onto
 * the open editor. Insert a reference chip at the drop point — a chip only, no
 * `entity_links` write (that's the drag-onto-row/hub gesture). The DOM caret at
 * the release coordinates maps to a Lexical selection via `applyDOMRange`; a
 * miss (dropped on padding/outside content) falls back to appending at the end. */
function InsertEntityChipPlugin({ noteId, editable }: { noteId: string; editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!editable) return;
    const onInsert = (event: Event) => {
      const d = (event as CustomEvent<InsertEntityChipDetail>).detail;
      if (!d || d.noteId !== noteId || !d.entityId) return;
      const input = {
        entityType: d.entityType,
        entityId: d.entityId,
        label: d.label,
        icon: d.icon,
      };
      editor.update(() => {
        // Best-effort placement at the drop caret.
        let dropSel: ReturnType<typeof $createRangeSelection> | null = null;
        if (
          d.clientX != null &&
          d.clientY != null &&
          typeof document.caretRangeFromPoint === "function"
        ) {
          const domRange = document.caretRangeFromPoint(d.clientX, d.clientY);
          if (domRange) {
            try {
              const sel = $createRangeSelection();
              sel.applyDOMRange(domRange);
              dropSel = sel;
            } catch {
              dropSel = null;
            }
          }
        }
        if (dropSel) {
          $setSelection(dropSel);
          dropSel.insertNodes([$createEntityRefNode(input), $createTextNode(" ")]);
          return;
        }
        // Fallback: append at the end, reusing a trailing empty paragraph.
        const root = $getRoot();
        const chip = $createEntityRefNode(input);
        const space = $createTextNode(" ");
        const last = root.getLastChild();
        if (last && $isParagraphNode(last) && last.getTextContent().trim() === "") {
          last.append(chip, space);
        } else {
          const p = $createParagraphNode();
          p.append(chip, space);
          root.append(p);
        }
      });
    };
    window.addEventListener(INSERT_ENTITY_CHIP_EVENT, onInsert);
    return () => window.removeEventListener(INSERT_ENTITY_CHIP_EVENT, onInsert);
  }, [editor, noteId, editable]);
  return null;
}

export function NoteEditor({
  engine,
  workspaceId,
  noteId,
  editable = true,
  titleForLabel,
  onTitleDerived,
  bridge,
  autoFocus = false,
  fullWidth = false,
  belowTitle,
  footer,
}: Props) {
  const { userId, runtime } = useAuth();
  // The writing surface (NR-4): block handles, `[[`, ⌘K links. A view-only
  // note gets none of them.
  const writing = editable;
  const session = useMemo(() => engine.getOrCreateSession(noteId), [engine, noteId]);
  // Mount as soon as the local copy has loaded (NR-3 honest provider): the
  // cached doc paints and edits at once while the pull runs underneath. An
  // EMPTY cache waits for the pull instead: mounting the binding on an empty
  // doc makes Lexical append a paragraph that syncs into Yjs and pushes, so a
  // note opened on a new device would gain a stray empty block.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    void session.cacheReady.then(() => {
      if (active && session.doc.getXmlElement(NOTES_DOC_ROOT).length > 0) setReady(true);
    });
    void session.booted.then(() => {
      if (!active) return;
      setReady(true);
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
      // Shared with the headless materializer (NOTE-FIX-1) — an imported note's
      // doc is built against this exact set, so the two must never drift.
      nodes: [...NOTE_EDITOR_NODES],
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
        // Full text-format map (DF-13): tags alone can't express combinations
        // (bold+italic renders ONE outer tag) and strikethrough/underline have
        // no tag at all — without these classes those formats apply invisibly.
        text: {
          code: "notes-inline-code",
          bold: "notes-text-bold",
          italic: "notes-text-italic",
          strikethrough: "notes-text-strikethrough",
          underline: "notes-text-underline",
          underlineStrikethrough: "notes-text-underline-strikethrough",
        },
        code: "notes-code-block",
        link: "notes-link",
        table: "notes-table",
        tableRow: "notes-table-row",
        tableCell: "notes-table-cell",
        tableCellHeader: "notes-table-cell-header",
        mark: "notes-comment-mark",
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

  // The pane is the scroller, full width, so the wheel works over the margins
  // and the scrollbar sits at the pane's edge; the reading column is centred
  // inside it. Overlays (block handle, meta line, drop line) position against
  // the column, the task-line overlay against the pane.
  return (
    <div
      data-meta-line={belowTitle ? "" : undefined}
      className="pane-scroll notes-editor-v2 relative h-full min-h-0 overflow-auto"
    >
      <div
        className={cn(
          "relative mx-auto flex min-h-full w-full flex-col",
          fullWidth ? "max-w-none" : "max-w-(--width-prose-max)",
        )}
      >
        <NotesEditorBridgeContext.Provider value={bridge}>
          <LexicalCollaboration key={`collab-${noteId}`}>
            <LexicalComposer initialConfig={initialConfig} key={noteId}>
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="w-full flex-1 px-6 pt-10 pb-12 text-base leading-relaxed text-foreground outline-none" />
                }
                placeholder={
                  <div className="pointer-events-none absolute inset-x-0 top-10 px-6 font-display text-3xl font-semibold text-muted-foreground/60">
                    Untitled
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
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
                noteLinks={writing}
              />
              {writing ? (
                <>
                  <NoteLinkPlugin
                    workspaceId={workspaceId}
                    runtime={runtime}
                    noteId={noteId}
                    sourceLabel={titleForLabel || "Untitled"}
                  />
                  <LinkDialogPlugin
                    workspaceId={workspaceId}
                    runtime={runtime}
                    noteId={noteId}
                    sourceLabel={titleForLabel || "Untitled"}
                  />
                  <BlockHandlePlugin doc={session.doc} />
                </>
              ) : null}
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
              {/* Live markdown-as-you-type (DF-13): the same transformer set the
              paste/import path uses, so `**bold**`, `# heading`, `- [ ]` etc.
              format while typing. ⌘B/⌘I ride Lexical's built-in rich-text
              bindings; the floating toolbar makes them discoverable. */}
              <MarkdownShortcutPlugin transformers={NOTES_TRANSFORMERS} />
              <CommentMarksPlugin
                noteId={noteId}
                editable={editable}
                runtime={runtime}
                workspaceId={workspaceId ?? null}
              />
              <FormatToolbarPlugin
                editable={editable}
                link={writing}
                comment={writing && Boolean(bridge.openComments)}
              />
              <TaskLinePlugin editable={editable} noteId={noteId} />
              <InsertPageRowPlugin noteId={noteId} bridge={bridge} />
              <InsertEntityChipPlugin noteId={noteId} editable={editable} />
              <CollaborationPluginV2__EXPERIMENTAL
                id={noteId}
                doc={session.doc}
                provider={session.provider as any}
                __shouldBootstrapUnsafe={true}
              />
              <SyncFromYjsPlugin doc={session.doc} />
              <TitleDerivationPlugin doc={session.doc} onTitleDerived={onTitleDerived} />
              {autoFocus && editable ? <AutoFocusPlugin /> : null}
              {belowTitle ? <BelowTitleSlot>{belowTitle}</BelowTitleSlot> : null}
            </LexicalComposer>
          </LexicalCollaboration>
        </NotesEditorBridgeContext.Provider>
        {footer ? <div className="w-full px-6 pb-12">{footer}</div> : null}
      </div>
    </div>
  );
}
