// The typed handle chip in the composer (CH66; CV-10): finish typing `MOD-142`
// and, when it names a task you can see, it becomes a live task chip (RF-1's
// HandleAutolinkPlugin; the stored form is the URI). Esc right after, or ⌘Z,
// puts the typed text back.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, COMMAND_PRIORITY_HIGH, KEY_ESCAPE_COMMAND, UNDO_COMMAND } from "lexical";
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
  // The text right after the last chip went in; Esc undoes it only then.
  const linkedText = useRef<string | null>(null);

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const now = editor.getEditorState().read(() => $getRoot().getTextContent());
          if (!escapeUndoesChip(linkedText.current, now)) return false;
          linkedText.current = null;
          event?.preventDefault();
          event?.stopPropagation();
          editor.dispatchCommand(UNDO_COMMAND, undefined);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  return (
    <HandleAutolinkPlugin
      taskKeys={taskKeys}
      onLinked={() => {
        linkedText.current = editor.getEditorState().read(() => $getRoot().getTextContent());
      }}
    />
  );
}
