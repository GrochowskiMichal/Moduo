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
import {
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $getNodeByKey,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import {
  $isListItemNode,
  $isListNode,
  $insertList,
} from "@lexical/list";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { SlashCommandPlugin } from "./plugins/SlashCommandPlugin";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $createToggleNode, $isToggleNode, ToggleNode } from "./nodes/ToggleNode";
import {
  NOTES_INSERT_CHILD_LINK_EVENT,
  clearQueuedNotesChildLink,
  consumeNotesChildLinks,
  type NotesInsertChildLinkEventDetail,
} from "../ui/layout-events";

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

function NotesDividerShortcutPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const shouldConvert = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return false;
          node = parent;
        }

        if (node.getType() !== "paragraph") return false;
        const parent = node.getParent();
        return parent?.getType() === "root" && node.getTextContent().trim() === "---";
      });

      if (!shouldConvert) return;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return;
          node = parent;
        }

        if (node.getType() !== "paragraph") return;
        const parent = node.getParent();
        if (parent?.getType() !== "root") return;
        if (node.getTextContent().trim() !== "---") return;

        const divider = $createHorizontalRuleNode();
        const nextParagraph = $createParagraphNode();
        node.insertBefore(divider);
        divider.insertAfter(nextParagraph);
        node.remove();
        nextParagraph.select();
      });
    });
  }, [editor]);

  return null;
}

type MarkdownShortcut =
  | { type: "list"; listType: "number" | "bullet" | "check"; deleteCount: number; start?: number }
  | { type: "heading"; tag: "h1" | "h2" | "h3"; deleteCount: number }
  | { type: "quote"; deleteCount: number }
  | { type: "code"; deleteCount: number }
  | { type: "toggle"; deleteCount: number };

function resolveMarkdownShortcut(text: string): MarkdownShortcut | null {
  const numberListMatch = text.match(/^(\d+)\. $/);
  if (numberListMatch) {
    return { type: "list", listType: "number", deleteCount: text.length, start: Number(numberListMatch[1]) || 1 };
  }
  if (text === "- " || text === "* ") return { type: "list", listType: "bullet", deleteCount: 2 };
  if (text === "[] " || text === "[ ] " || text === "- [ ] ") {
    return { type: "list", listType: "check", deleteCount: text.length };
  }
  if (text === "# ") return { type: "heading", tag: "h1", deleteCount: 2 };
  if (text === "## ") return { type: "heading", tag: "h2", deleteCount: 3 };
  if (text === "### ") return { type: "heading", tag: "h3", deleteCount: 4 };
  if (text === "> ") return { type: "toggle", deleteCount: 2 };
  if (text === "\" ") return { type: "quote", deleteCount: 2 };
  if (text === "``` ") return { type: "code", deleteCount: 4 };
  return null;
}

function NotesMarkdownListShortcutPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const shouldConvert = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return false;
          node = parent;
        }

        if (node.getType() !== "paragraph") return false;
        const parent = node.getParent();
        if (parent?.getType() !== "root") return false;

        return resolveMarkdownShortcut(node.getTextContent());
      });

      if (!shouldConvert) return;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        let node = selection.anchor.getNode();
        while (node && node.getType() !== "paragraph") {
          const parent = node.getParent();
          if (!parent) return;
          node = parent;
        }

        if (node.getType() !== "paragraph") return;
        const parent = node.getParent();
        if (parent?.getType() !== "root") return;

        const shortcut = resolveMarkdownShortcut(node.getTextContent());
        if (!shortcut) return;
        if (!$isElementNode(node)) return;

        const textNode = node.getFirstChild();
        if (!$isTextNode(textNode)) return;

        textNode.spliceText(0, shortcut.deleteCount, "", false);
        selection.setTextNodeRange(textNode, 0, textNode, 0);

        if (shortcut.type === "list") {
          $insertList(shortcut.listType);

          if (shortcut.listType === "number") {
            const start = shortcut.start ?? 1;
            const anchorNode = selection.anchor.getNode();
            const listItem = $isListItemNode(anchorNode)
              ? anchorNode
              : anchorNode.getParent();
            if (!$isListItemNode(listItem)) return;
            const listNode = listItem.getParent();
            if (!$isListNode(listNode)) return;
            listNode.setStart(start);
            listItem.setValue(start);
          }
          return;
        }

        if (shortcut.type === "heading") {
          $setBlocksType(selection, () => $createHeadingNode(shortcut.tag));
          return;
        }
        if (shortcut.type === "quote") {
          $setBlocksType(selection, () => $createQuoteNode());
          return;
        }
        if (shortcut.type === "code") {
          $setBlocksType(selection, () => $createCodeNode());
          return;
        }
        if (shortcut.type === "toggle") {
          const toggle = $createToggleNode(true);
          toggle.append($createTextNode(""));
          node.replace(toggle);
          toggle.selectEnd();
        }
      });
    });
  }, [editor]);

  return null;
}

function NotesToggleInteractionPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest<HTMLElement>("[data-toggle-button]");
      const wrapper = button?.closest<HTMLElement>("[data-toggle-key]");
      const key = wrapper?.dataset.toggleKey;
      if (!key) return;

      event.preventDefault();
      editor.update(() => {
        const node = $getNodeByKey(key);
        if ($isToggleNode(node)) node.toggleOpen();
      });
    };

    root.addEventListener("pointerdown", onPointerDown);
    return () => root.removeEventListener("pointerdown", onPointerDown);
  }, [editor]);

  return null;
}

function NotesCodeBlockEscapePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const shouldExit = editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          let node = selection.anchor.getNode();
          while (node && !$isCodeNode(node)) {
            const parent = node.getParent();
            if (!parent) return false;
            node = parent;
          }
          if (!$isCodeNode(node)) return false;
          return selection.anchor.offset === node.getTextContentSize();
        });

        if (!shouldExit) return false;
        event?.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          let node = selection.anchor.getNode();
          while (node && !$isCodeNode(node)) {
            const parent = node.getParent();
            if (!parent) return;
            node = parent;
          }
          if (!$isCodeNode(node)) return;
          const paragraph = $createParagraphNode();
          node.insertAfter(paragraph);
          paragraph.select();
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const root = editor.getRootElement();
    if (!root) return unregisterEnter;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".notes-code-block")) return;

      const codeBlocks = [...root.querySelectorAll<HTMLElement>(".notes-code-block")];
      const clickedTarget = codeBlocks.reduce<{ block: HTMLElement; placement: "before" | "after" } | null>((match, block) => {
        if (match) return match;
        const rect = block.getBoundingClientRect();
        const withinX = event.clientX >= rect.left && event.clientX <= rect.right;
        if (!withinX) return null;
        if (event.clientY >= rect.top - 36 && event.clientY < rect.top) return { block, placement: "before" };
        if (event.clientY > rect.bottom && event.clientY <= rect.bottom + 36) return { block, placement: "after" };
        return null;
      }, null);
      if (!clickedTarget) return;

      event.preventDefault();
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(clickedTarget.block);
        if (!$isCodeNode(node)) return;
        if (clickedTarget.placement === "before") {
          const prev = node.getPreviousSibling();
          if (prev?.getType() === "paragraph" && prev.getTextContent() === "") {
            prev.selectStart();
            return;
          }
          const paragraph = $createParagraphNode();
          node.insertBefore(paragraph);
          paragraph.select();
          return;
        }
        const next = node.getNextSibling();
        if (next?.getType() === "paragraph" && next.getTextContent() === "") {
          next.selectStart();
          return;
        }
        const paragraph = $createParagraphNode();
        node.insertAfter(paragraph);
        paragraph.select();
      });
    };

    root.addEventListener("pointerdown", onPointerDown);
    return () => {
      unregisterEnter();
      root.removeEventListener("pointerdown", onPointerDown);
    };
  }, [editor]);

  return null;
}

function NotesChildLinkPlugin({ noteId }: { noteId: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const insertChildLink = (detail: NotesInsertChildLinkEventDetail) => {
      editor.focus();
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createLinkNode(`moduo://notes/${detail.childId}`);
        link.append($createTextNode(detail.childTitle || "Untitled"));
        paragraph.append(link);
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertNodes([paragraph]);
        } else {
          $getRoot().append(paragraph);
        }
        paragraph.selectEnd();
      });
      clearQueuedNotesChildLink(detail.parentId, detail.childId);
    };

    for (const pending of consumeNotesChildLinks(noteId)) {
      insertChildLink(pending);
    }

    const onInsertChildLink = (event: Event) => {
      const detail = (event as CustomEvent<NotesInsertChildLinkEventDetail>).detail;
      if (!detail || detail.parentId !== noteId) return;
      insertChildLink(detail);
    };

    window.addEventListener(NOTES_INSERT_CHILD_LINK_EVENT, onInsertChildLink);
    return () => window.removeEventListener(NOTES_INSERT_CHILD_LINK_EVENT, onInsertChildLink);
  }, [editor, noteId]);

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
