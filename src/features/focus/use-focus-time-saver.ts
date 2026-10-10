// The app shell's Focus save sink (TV-P0, tasks-v3 AC1.6): mounted once in
// AppChrome, so tracked time saves from any page, not only while /tasks is
// open. See time-sink.ts.

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { formatAwaySpan } from "./away-copy";
import { registerFocusFlushSink } from "./engine";
import { announceFocusTimeSaved, createFocusTimeSink } from "./time-sink";

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
        onSaved: announceFocusTimeSaved,
      }),
    );
  }, [runtime, selectedWorkspaceId]);
}
