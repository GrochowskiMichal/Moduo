/**
 * CommentMarksPlugin (NR-8) — the editor half of comments anchored to text.
 *
 * - "Comment" (selection toolbar) wraps the selection in a MarkNode carrying
 *   a fresh thread id and opens the Comments panel's composer for it.
 * - Every update reports the thread ids in the doc, in order, to the anchor
 *   store, so the panel can sort threads and tell which became Detached.
 * - Only marks whose thread is open are highlighted (`data-comment`); a mark
 *   whose thread was resolved elsewhere, or never got its first comment,
 *   reads as plain text.
 * - Clicking a highlight focuses its thread in the panel.
 */

import { $getMarkIDs, $isMarkNode } from "@lexical/mark";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  createCommand,
  type LexicalCommand,
  type LexicalNode,
} from "lexical";
import { useEffect } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { anchorStore } from "../../comments/anchor-store";
import {
  $anchorIdsInOrder,
  $anchorSelection,
  $firstMarkKey,
  $unanchor,
} from "../../comments/anchors";
import { useNotesEditorBridge } from "../notes-editor-bridge";

export const ADD_COMMENT_COMMAND: LexicalCommand<void> = createCommand("NOTES_ADD_COMMENT");

type Editor = ReturnType<typeof useLexicalComposerContext>[0];

/** Marks' DOM state from the store: open, focused, or plain. */
function paintMarks(editor: Editor, noteId: string) {
  const { openThreads, focused, pending } = anchorStore.get(noteId);
  // Unknown yet (no thread list): plain, so a stray mark never lights up.
  const isOpen = (id: string) => id === pending || openThreads?.has(id) === true;
  editor.getEditorState().read(() => {
    const walk = (node: LexicalNode) => {
      if ($isMarkNode(node)) {
        const el = editor.getElementByKey(node.getKey());
        const ids = node.getIDs();
        const state = ids.some((id) => id === focused && isOpen(id))
          ? "focused"
          : ids.some(isOpen)
            ? "open"
            : "plain";
        if (el && el.dataset.comment !== state) el.dataset.comment = state;
      }
      if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
    };
    walk($getRoot());
  });
}

/**
 * "Comment" on the selection: anchor a fresh thread to it and open the
 * composer. Exported for the headless test of the real command path.
 */
export function registerAddComment(
  editor: Editor,
  noteId: string,
  editable: boolean,
  openComments: () => void,
): () => void {
  return editor.registerCommand(
    ADD_COMMENT_COMMAND,
    () => {
      // A command handler already runs inside an update: change the doc
      // here, never through a nested editor.update (it would be queued).
      if (!editable) return false;
      const sel = $getSelection();
      const id = crypto.randomUUID();
      if (!$isRangeSelection(sel) || !$anchorSelection(sel, id)) return false;
      // One unposted thread at a time: the previous draft's mark goes.
      const previous = anchorStore.get(noteId).pending;
      if (previous) $unanchor(previous);
      anchorStore.setPending(noteId, id);
      anchorStore.focus(noteId, id);
      openComments();
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
}

export function CommentMarksPlugin({
  noteId,
  editable,
  runtime,
  workspaceId,
}: {
  noteId: string;
  editable: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
}) {
  const [editor] = useLexicalComposerContext();
  const bridge = useNotesEditorBridge();

  useEffect(() => {
    const publish = () => {
      const order = editor.getEditorState().read(() => $anchorIdsInOrder());
      anchorStore.setDocOrder(noteId, order);
      paintMarks(editor, noteId);
    };
    publish();
    const offUpdate = editor.registerUpdateListener(publish);
    const offStore = anchorStore.subscribe(() => paintMarks(editor, noteId));

    // Which threads are open, without waiting for the panel: only their marks
    // highlight. The panel refreshes this whenever it reads the thread.
    let alive = true;
    if (runtime && workspaceId) {
      runtime.spine
        .listComments({ workspaceId, entityType: "note", entityId: noteId })
        .then((rows) => {
          if (!alive || anchorStore.get(noteId).openThreads) return;
          const open = new Set<string>();
          for (const c of rows) if (c.anchorId && !c.resolvedAt) open.add(c.anchorId);
          for (const c of rows) if (c.anchorId && c.resolvedAt) open.delete(c.anchorId);
          anchorStore.setOpenThreads(noteId, open);
        })
        .catch(() => {});
    }

    const offActions = anchorStore.register(noteId, {
      editable,
      unanchor: (anchorId) => {
        if (!editable) return;
        editor.update(() => $unanchor(anchorId), { discrete: true });
      },
      scrollTo: (anchorId) => {
        const key = editor.getEditorState().read(() => $firstMarkKey(anchorId));
        const el = key ? editor.getElementByKey(key) : null;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      textOf: (anchorId) =>
        editor.getEditorState().read(() => {
          const key = $firstMarkKey(anchorId);
          const node = key ? $getNodeByKey(key) : null;
          return node?.getTextContent() ?? "";
        }),
    });

    const offAdd = registerAddComment(editor, noteId, editable, () => bridge?.openComments?.());

    // A click on a highlight opens its thread (never steals the caret).
    const offClick = editor.registerCommand(
      CLICK_COMMAND,
      () => {
        const sel = editor.getEditorState().read(() => {
          const s = $getSelection();
          if (!$isRangeSelection(s) || !s.isCollapsed()) return null;
          const node = s.anchor.getNode();
          return $isTextNode(node) ? $getMarkIDs(node, s.anchor.offset) : null;
        });
        if (!sel?.length) return false;
        const { openThreads } = anchorStore.get(noteId);
        const id = sel.find((x) => openThreads?.has(x));
        if (!id) return false;
        anchorStore.focus(noteId, id);
        bridge?.openComments?.();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      alive = false;
      offUpdate();
      offStore();
      offActions();
      offAdd();
      offClick();
      anchorStore.setDocOrder(noteId, null);
    };
  }, [editor, noteId, editable, bridge, runtime, workspaceId]);

  return null;
}
