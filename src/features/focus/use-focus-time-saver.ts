// The app shell's save sink for the one time engine (TV-P0 AC1.6, TV-F6):
// mounted once in AppChrome, so tracked time saves from any page. Each saved
// total lands in the workspace's shared store copy. See time-sink.ts.

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { findWorkspaceStore } from "../../lib/sync/store";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { formatAwaySpan } from "./away-copy";
import { registerFocusFlushSink } from "./engine";
import { createFocusTimeSink } from "./time-sink";

export function useFocusTimeSaver(): void {
  const { runtime } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const tasksAccess = modulePermissions.tasks;
  const canEditRef = useRef(false);
  useEffect(() => {
    canEditRef.current = tasksAccess === "edit" || tasksAccess === "admin";
  }, [tasksAccess]);

  useEffect(() => {
    if (!runtime || !selectedWorkspaceId) return;
    const rt = runtime;
    return registerFocusFlushSink(
      selectedWorkspaceId,
      createFocusTimeSink({
        workspaceId: selectedWorkspaceId,
        canEdit: () => canEditRef.current,
        trackTime: (input) => rt.tasks.trackTime(input),
        onGone: (seconds) =>
          toast(`${formatAwaySpan(seconds)} of focus time couldn't be saved`, {
            description:
              "The task it was tracked on was deleted or isn't shared with you any more.",
          }),
        // The server's total (it counts teammates' time too) replaces the
        // copy's; the server's next row for the task replaces it again.
        onSaved: (saved) =>
          findWorkspaceStore(rt, saved.workspaceId)?.patchCopy("tasks", saved.taskId, {
            timeSpentSeconds: saved.totalSeconds,
          }),
      }),
    );
  }, [runtime, selectedWorkspaceId]);
}
