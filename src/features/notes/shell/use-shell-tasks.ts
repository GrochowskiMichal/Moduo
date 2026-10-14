/**
 * Task lines ride along in the refreshed shell (NO-5, unchanged behaviour):
 * the Tasks module loads so lines render live rows, `/task` searches real
 * tasks, and the transient Task panel edits without leaving /notes. Lifted
 * from the classic page.
 */

import { useEffect, useRef, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useTasksModule } from "../../tasks/hooks/use-tasks-module";
import { useNotesTaskBridge } from "../hooks/use-notes-task-bridge";

export function useShellTasks(input: {
  runtime: ModuoRuntime | null;
  userId: string | null;
  workspaceId: string | null;
  tasksPermission: Parameters<typeof useTasksModule>[1]["modulePermission"];
  noteId: string | null;
  noteLabel: string;
}) {
  const { runtime, userId, workspaceId, tasksPermission, noteId, noteLabel } = input;
  const tasksApi = useTasksModule(runtime, {
    userId,
    workspaceId,
    modulePermission: tasksPermission,
  });

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
      void tasksApi.reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [tasksApi.reload]);

  const taskBridge = useNotesTaskBridge({
    runtime,
    workspaceId,
    noteId,
    noteLabel,
    tasksApi,
    onOpenTaskDetail: setTaskDetailId,
  });

  return { tasksApi, taskBridge, taskDetailId, setTaskDetailId };
}
