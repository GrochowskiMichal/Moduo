// The typed handle chip in the composer (CH66; CV-10): finish typing `MOD-142`
// and, when it names a task you can see, it becomes a live task chip (RF-1's
// HandleAutolinkPlugin; the stored form is the URI). Esc right after puts the
// typed text back (⌘Z does too, with the typing around it).

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  KEY_ESCAPE_COMMAND,
  type NodeKey,
} from "lexical";
import { useContext, useEffect, useMemo, useRef } from "react";

import { HandleAutolinkPlugin } from "@/features/spine/references/handle-autolink-plugin";
import { WorkspaceContext } from "@/features/workspaces/workspace-context";

/** Whether Esc should take back the chip just made: nothing changed since. */
export function escapeUndoesChip(linkedText: string | null, currentText: string): boolean {
  return linkedText !== null && linkedText === currentText;
}

export function HandleChipPlugin({ taskKey }: { taskKey?: string | null }) {
  const [editor] = useLexicalComposerContext();
  const fromWorkspace = useContext(WorkspaceContext)?.selectedWorkspace?.taskKey ?? null;
  const key = taskKey === undefined ? fromWorkspace : taskKey;
  const taskKeys = useMemo(() => (key ? [key] : []), [key]);
  // The chip just made, and the text right after it went in.
  const last = useRef<{ text: string; handle: string; nodeKey: NodeKey } | null>(null);

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const made = last.current;
          const now = editor.getEditorState().read(() => $getRoot().getTextContent());
          if (!made || !escapeUndoesChip(made.text, now)) return false;
          last.current = null;
          let undone = false;
          editor.update(() => {
            const node = $getNodeByKey(made.nodeKey);
            if (!node || !node.isAttached()) return;
            const text = $createTextNode(made.handle);
            node.replace(text);
            text.selectEnd();
            undone = true;
          });
          if (!undone) return false;
          event?.preventDefault();
          event?.stopPropagation();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  return (
    <HandleAutolinkPlugin
      taskKeys={taskKeys}
      onLinked={(_taskId, { handle, nodeKey }) => {
        last.current = {
          text: editor.getEditorState().read(() => $getRoot().getTextContent()),
          handle,
          nodeKey,
        };
      }}
    />
  );
}
