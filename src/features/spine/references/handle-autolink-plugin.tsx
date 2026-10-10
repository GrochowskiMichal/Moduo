// Typed task handles link themselves (RF-1; TV-D8's handles): finish typing
// `MOD-142` (a space or punctuation right after it) in prose and, when it
// names a task you can see, it becomes a task reference. Only the handle you
// just finished counts: the one ending right before the caret's last
// character. So text loaded from storage or typed elsewhere in the paragraph
// is never converted, and after ⌘Z the words stay words (the next keystroke is
// no longer right after them). Only the workspace's own key counts, so `UTF-8`
// stays text; a handle you can't see stays text too (no "Private item" for
// something you only typed).

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type NodeKey,
} from "lexical";
import { useEffect, useRef } from "react";

import { findHandles } from "../grammar";
import { useReferenceStore } from "./context";
import { $createReferenceNode } from "./reference-node";

/** Updates that load stored text: never auto-linked. */
export const SEED_TAG = "moduo-seed";
/** The autolink's own update (it must not re-trigger itself). */
const AUTOLINK_TAG = "moduo-handle-autolink";

/** The handle just finished at `caret` in `text` (one boundary character typed after it), or null. */
export function handleFinishedAt(
  text: string,
  caret: number,
  taskKeys: readonly string[],
): { handle: string; start: number; end: number } | null {
  if (caret < 1 || /[A-Za-z0-9-]/.test(text[caret - 1] ?? "")) return null;
  const match = findHandles(text.slice(0, caret), taskKeys).find((m) => m.end === caret - 1);
  return match ? { handle: match.handle, start: match.start, end: match.end } : null;
}

export function HandleAutolinkPlugin({
  taskKeys,
  onLinked,
}: {
  taskKeys: readonly string[];
  /** A handle became a reference (the host writes its `mentions` link, like `@`). */
  onLinked?: (taskId: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const store = useReferenceStore();
  const keysKey = taskKeys.join(",");
  const onLinkedRef = useRef(onLinked);
  useEffect(() => {
    onLinkedRef.current = onLinked;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: keysKey is the identity of taskKeys
  useEffect(() => {
    if (!store || taskKeys.length === 0) return;
    return editor.registerUpdateListener(({ dirtyLeaves, tags, editorState }) => {
      if (tags.has(SEED_TAG) || tags.has(AUTOLINK_TAG) || tags.has("historic")) return;
      if (dirtyLeaves.size === 0 || !editor.isEditable()) return;
      let found: { key: NodeKey; handle: string; start: number } | null = null;
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const node = selection.anchor.getNode();
        if (!$isTextNode(node) || !node.isSimpleText() || !dirtyLeaves.has(node.getKey())) return;
        const hit = handleFinishedAt(node.getTextContent(), selection.anchor.offset, taskKeys);
        if (hit) found = { key: node.getKey(), handle: hit.handle, start: hit.start };
      });
      if (!found) return;
      const { key, handle, start } = found as { key: NodeKey; handle: string; start: number };
      void store.resolveHandle(handle).then((taskId) => {
        if (!taskId) return;
        let linked = false;
        editor.update(
          () => {
            const node = $getNodeByKey(key);
            if (!$isTextNode(node) || !node.isAttached()) return;
            // Still there, as typed (the text may have moved on meanwhile).
            if (node.getTextContent().slice(start, start + handle.length) !== handle) return;
            const parts = node.splitText(start, start + handle.length);
            const target = start === 0 ? parts[0] : parts[1];
            if (!target) return;
            target.replace(
              $createReferenceNode({ entityType: "task", entityId: taskId, display: "chip" }),
            );
            linked = true;
          },
          { tag: AUTOLINK_TAG, onUpdate: () => linked && onLinkedRef.current?.(taskId) },
        );
      });
    });
  }, [editor, store, keysKey]);

  return null;
}
