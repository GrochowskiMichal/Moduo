// Typed task handles link themselves (RF-1; TV-D8's handles): finish typing
// `MOD-142` (a space or punctuation after it) in prose and, when it names a
// task you can see, it becomes a task reference. Only the workspace's own key
// counts, so `UTF-8` stays text; a handle you can't see stays text too (no
// "Private item" for something you only typed). Text loaded from storage is
// never converted (only what you type), and ⌘Z puts the words back.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $isTextNode, type NodeKey } from "lexical";
import { useEffect, useRef } from "react";

import { findHandles } from "../grammar";
import { useReferenceStore } from "./context";
import { $createReferenceNode } from "./reference-node";

/** Updates that load stored text: never auto-linked. */
export const SEED_TAG = "moduo-seed";
/** The autolink's own update (it must not re-trigger itself). */
const AUTOLINK_TAG = "moduo-handle-autolink";

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
      const found: Array<{ key: NodeKey; handle: string }> = [];
      editorState.read(() => {
        for (const key of dirtyLeaves) {
          const node = $getNodeByKey(key);
          if (!$isTextNode(node) || !node.isSimpleText()) continue;
          const text = node.getTextContent();
          for (const m of findHandles(text, taskKeys)) {
            // Finished only: something follows it (you may still be typing digits).
            if (m.end < text.length) found.push({ key, handle: m.handle });
          }
        }
      });
      for (const { key, handle } of found) {
        void store.resolveHandle(handle).then((taskId) => {
          if (!taskId) return;
          let linked = false;
          editor.update(
            () => {
              const node = $getNodeByKey(key);
              if (!$isTextNode(node) || !node.isAttached()) return;
              const text = node.getTextContent();
              const match = findHandles(text, taskKeys).find(
                (m) => m.handle === handle && m.end < text.length,
              );
              if (!match) return;
              const parts = node.splitText(match.start, match.end);
              const target = match.start === 0 ? parts[0] : parts[1];
              if (!target) return;
              target.replace(
                $createReferenceNode({ entityType: "task", entityId: taskId, display: "chip" }),
              );
              linked = true;
            },
            { tag: AUTOLINK_TAG, onUpdate: () => linked && onLinkedRef.current?.(taskId) },
          );
        });
      }
    });
  }, [editor, store, keysKey]);

  return null;
}
