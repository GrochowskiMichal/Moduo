/**
 * Task lines ride along in the refreshed shell (NO-5, unchanged behaviour):
 * the Tasks module loads so lines render live rows, `/task` searches real
 * tasks, and the transient Task panel edits without leaving /notes. Lifted
 * from the classic page. Reads the Tasks context: `NotesShell` mounts the
 * `<TasksProvider>` (A4).
 */

import { useEffect, useRef, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useTaskCommands } from "../../tasks/tasks-context";
import { useNotesTaskBridge } from "../hooks/use-notes-task-bridge";

export function useShellTasks(input: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  noteId: string | null;
  noteLabel: string;
}) {
  const { runtime, workspaceId, noteId, noteLabel } = input;
  const { load: reloadTasks, deleteTask } = useTaskCommands();

  // The Task panel variant: a task line's meta opens it; switching notes closes it.
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null);
  useEffect(() => {
    setTaskDetailId(null);
  }, [noteId]);

  // "Reflects on refresh/refocus": re-pull the tasks bundle when the window
  // regains focus, at most every 5 s.
  const lastFocusReload = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusReload.current < 5000) return;
      lastFocusReload.current = now;
      void reloadTasks();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadTasks]);

  const taskBridge = useNotesTaskBridge({
    runtime,
    workspaceId,
    noteId,
    noteLabel,
    onOpenTaskDetail: setTaskDetailId,
  });

  return { deleteTask, taskBridge, taskDetailId, setTaskDetailId };
}
