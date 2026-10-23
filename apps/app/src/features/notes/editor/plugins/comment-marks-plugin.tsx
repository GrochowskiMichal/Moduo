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
 * - Each line with an open thread gets a small speech bubble with its count
 *   in the right margin (Google Docs-style), so you see at a glance where the
 *   conversations are; clicking it opens the thread.
 */

import { $getMarkIDs, $isMarkNode, MarkNode } from "@lexical/mark";
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
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";

import { anchorStore, useNoteAnchors } from "../../comments/anchor-store";
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
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  useEffect(() => {
    // A note with no comment marks (most) skips the two whole-document walks
    // that every keystroke would otherwise pay for.
    let marks = 0;
    const offMarks = editor.registerMutationListener(
      MarkNode,
      (mutations) => {
        for (const kind of mutations.values()) {
          if (kind === "created") marks += 1;
          else if (kind === "destroyed") marks = Math.max(0, marks - 1);
        }
      },
      { skipInitialization: false },
    );
    let published = false;
    const publish = () => {
      if (marks === 0 && published && anchorStore.get(noteId).docOrder?.length === 0) return;
      published = true;
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
          const counts = new Map<string, number>();
          for (const c of rows) {
            if (c.anchorId && open.has(c.anchorId)) {
              counts.set(c.anchorId, (counts.get(c.anchorId) ?? 0) + 1);
            }
          }
          anchorStore.setOpenThreads(noteId, open);
          anchorStore.setCounts(noteId, counts);
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

    const offAdd = registerAddComment(editor, noteId, editable, () =>
      bridgeRef.current?.openComments?.(),
    );

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
        bridgeRef.current?.openComments?.();
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
      offMarks();
      anchorStore.setDocOrder(noteId, null);
      // The next mount reads the threads again (a peer may have started one).
      anchorStore.setOpenThreads(noteId, null);
    };
    // `bridge` rides a ref: its identity changes with every notes-list change,
    // which re-ran all of this (marks flickered plain, comments re-fetched).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId, editable, runtime, workspaceId]);

  return (
    <CommentGutter
      noteId={noteId}
      onOpen={(id) => {
        anchorStore.focus(noteId, id);
        bridgeRef.current?.openComments?.();
      }}
    />
  );
}

type Bubble = { top: number; anchorId: string; count: number };

/** The margin bubbles: one per line that holds open threads. */
function CommentGutter({ noteId, onOpen }: { noteId: string; onOpen: (anchorId: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const anchors = useNoteAnchors(noteId);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  const measure = useCallback(() => {
    const root = editor.getRootElement();
    const column = root?.parentElement;
    const { openThreads, docOrder, counts } = anchorStore.get(noteId);
    if (!root || !column || !openThreads || !docOrder) {
      setBubbles([]);
      return;
    }
    const base = column.getBoundingClientRect().top;
    const next: Bubble[] = [];
    for (const id of docOrder) {
      if (!openThreads.has(id)) continue;
      const key = editor.getEditorState().read(() => $firstMarkKey(id));
      const el = key ? editor.getElementByKey(key) : null;
      if (!el) continue;
      const top = el.getBoundingClientRect().top - base;
      const count = counts?.get(id) ?? 1;
      // Threads on one line share one bubble (the first opens).
      const same = next.find((b) => Math.abs(b.top - top) < 6);
      if (same) same.count += count;
      else next.push({ top, anchorId: id, count });
    }
    setBubbles((prev) =>
      prev.length === next.length &&
      prev.every(
        (b, i) =>
          b.top === next[i]!.top && b.count === next[i]!.count && b.anchorId === next[i]!.anchorId,
      )
        ? prev
        : next,
    );
  }, [editor, noteId]);

  useEffect(() => {
    measure();
    const offUpdate = editor.registerUpdateListener(() => requestAnimationFrame(measure));
    const observer = new ResizeObserver(() => measure());
    const offRoot = editor.registerRootListener((root, prev) => {
      if (prev) observer.unobserve(prev);
      if (root) observer.observe(root);
    });
    return () => {
      offUpdate();
      offRoot();
      observer.disconnect();
    };
  }, [editor, measure]);
  useEffect(() => measure(), [anchors.openThreads, anchors.docOrder, anchors.counts, measure]);

  return (
    <>
      {bubbles.map((b) => (
        <button
          key={b.anchorId}
          type="button"
          aria-label={`${b.count} comment${b.count === 1 ? "" : "s"}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpen(b.anchorId)}
          className={cn(
            "absolute right-0.5 flex h-5 items-center gap-0.5 rounded-sm px-0.5 font-sans text-2xs tabular-nums transition-colors duration-(--motion-fade) ease-(--ease-out)",
            anchors.focused === b.anchorId
              ? "bg-state-active text-foreground"
              : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
          style={{ top: b.top }}
        >
          <MessageSquare aria-hidden className="size-3" />
          {b.count}
        </button>
      ))}
    </>
  );
}
