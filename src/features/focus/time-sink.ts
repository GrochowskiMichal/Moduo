// Where the one time engine saves tracked time, from any page (TV-P0, AC1.6;
// TV-F6, spec §6.10). The app shell registers it once (`useFocusTimeSaver`);
// it writes straight through `tasks_op_track_time`: the server keeps the
// total and answers "gone" when the task can't take the time any more, so the
// sink needs no task list. Each saved total lands in the workspace's shared
// store copy (`store.patchCopy`), so every list, card and panel shows it.
// Focus, the top-bar timer, Calendar's block focus and Home's pomodoro all
// save through here: there is no other sink.

import type { TaskTimeResult, TrackTimeInput } from "../tasks/model";
import type { FocusFlushSink } from "./engine";

/** A saved focus stretch's new total, for any copy showing that task. */
export type FocusTimeSaved = {
  workspaceId: string;
  taskId: string;
  totalSeconds: number;
};

/** An optimistic task id that the server doesn't know yet. */
const isTempId = (id: string) => id.startsWith("tmp-");

export function createFocusTimeSink(deps: {
  workspaceId: string;
  /** May this person edit Tasks here? Read at each save (roles change). */
  canEdit: () => boolean;
  trackTime: (input: TrackTimeInput) => Promise<TaskTimeResult>;
  /** The task can never take these seconds (deleted, not shared any more). */
  onGone: (seconds: number) => void;
  onSaved?: (saved: FocusTimeSaved) => void;
}): FocusFlushSink {
  return (taskId, seconds, context) => {
    if (!Number.isFinite(seconds) || seconds < 1) return true;
    if (context.workspaceId !== deps.workspaceId || isTempId(taskId)) return false;
    // Without edit access the time is kept for later, as before (an edge case:
    // a viewer only gets here with a task queued before a role change).
    if (!deps.canEdit()) return Promise.resolve(false);
    return deps
      .trackTime({
        workspaceId: deps.workspaceId,
        taskId,
        action: "focus",
        seconds: Math.round(seconds),
        endedAt: context.earnedAt > 0 ? new Date(context.earnedAt).toISOString() : null,
        key: context.key,
      })
      .then(
        (result): boolean | "gone" => {
          if (result.status === "gone") {
            deps.onGone(seconds);
            return "gone";
          }
          if (result.totalSeconds !== null) {
            deps.onSaved?.({
              workspaceId: deps.workspaceId,
              taskId,
              totalSeconds: result.totalSeconds,
            });
          }
          return true;
        },
        () => false,
      );
  };
}
