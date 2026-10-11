// Where the Focus engine saves tracked time, from any page (TV-P0, tasks-v3
// AC1.6). The sink used to belong to the Tasks page, so time tracked while you
// were on Notes waited until you next opened Tasks. It now lives in the app
// shell (`useFocusTimeSaver`) and writes straight through
// `tasks_op_track_time`: the server keeps the total and answers "gone" when
// the task can't take the time any more, so the sink needs no task list. A
// mounted Tasks page hears each saved total (FOCUS_TIME_SAVED_EVENT) and shows
// it. TV-F6 replaces this with the one app-wide time engine.

import type { TaskTimeResult, TrackTimeInput } from "../tasks/model";
import type { FocusFlushSink } from "./engine";

/** A saved focus stretch's new total, for any list showing that task. */
export const FOCUS_TIME_SAVED_EVENT = "moduo:focus:time-saved";

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

/** Tell any mounted task list a task's new total. */
export function announceFocusTimeSaved(saved: FocusTimeSaved): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FocusTimeSaved>(FOCUS_TIME_SAVED_EVENT, { detail: saved }));
}
