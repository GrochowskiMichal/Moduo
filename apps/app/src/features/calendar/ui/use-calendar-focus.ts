// Focus on a block (CAL-5) runs on the one time engine (TV-F6): ▶ is "Focus on
// this" (call 66), the same clock as Focus and the top-bar timer, saved through
// the app shell from any page.

import { useCallback, useMemo } from "react";

import { useFocusPrefs } from "../../../lib/focus-prefs";
import { focusOn, useFocusTaskState } from "../../focus/timer";
import type { Task } from "../../tasks/model";
import type { useTaskCommands } from "../../tasks/tasks-context";
import type { TaskBlock } from "../lens";

type Input = {
  blocks: TaskBlock[];
  nowTick: number;
  tasks: Task[];
  buckets: readonly { id: string; name: string }[];
  workspaceId: string;
  commands: ReturnType<typeof useTaskCommands>;
};

export function useCalendarFocus({
  blocks,
  nowTick,
  tasks,
  buckets,
  workspaceId,
  commands,
}: Input) {
  const focus = useFocusTaskState();
  // The block the session's clock shows on: the focused task's block that
  // holds now, else its nearest one (a task can have several blocks).
  const focusBlockId = useMemo(() => {
    if (!focus.taskId) return null;
    const mine = blocks.filter((b) => b.taskId === focus.taskId);
    if (mine.length === 0) return null;
    const inside = mine.find((b) => b.startMs <= nowTick && nowTick < b.endMs);
    const nearest = mine.reduce((a, b) =>
      Math.abs(b.startMs - nowTick) < Math.abs(a.startMs - nowTick) ? b : a,
    );
    return (inside ?? nearest).blockId;
  }, [blocks, focus.taskId, nowTick]);
  const { prefs: focusPrefs } = useFocusPrefs();
  const focusTaskRef = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return null;
      return {
        id: task.id,
        title: task.title || "Untitled",
        bucketName: buckets.find((b) => b.id === task.bucketId)?.name ?? null,
        workspaceId,
      };
    },
    [tasks, buckets, workspaceId],
  );
  const onStartFocus = useCallback(
    (taskId: string) => {
      const ref = focusTaskRef(taskId);
      if (!ref) return;
      // On top of Up next, then the clock (a session on moves to it).
      commands.addToQueue(taskId, "top");
      focusOn(ref, { timer: focusPrefs.timer, resolveTask: focusTaskRef });
    },
    [commands, focusTaskRef, focusPrefs.timer],
  );

  return { focus, focusBlockId, focusTaskRef, onStartFocus };
}
