// The queue run on the Tasks page (TV-F2, specs/tasks-v2.md §3): it keeps my
// run on the head of my queue, and turns Done / Skip / Remove / Do now /
// Pause / End run into queue ops plus run steps. Mounted by the Tasks page in
// every scope, so completing the Now task from a bucket list moves the run
// too. The run itself (and its clock) lives outside React in focus/run.ts.

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { FocusTaskRef } from "../../focus/engine-core";
import {
  dismissEndedRun,
  endQueueRun,
  isRunInControl,
  moveQueueRun,
  noteQueueRunTitle,
  recordRunDone,
  setQueueRunNotice,
  startQueueRun,
  takeRunControl,
  toggleQueueRunPause,
  useQueueRunState,
} from "../../focus/run";
import { type FocusRunMode, openQueued, runNowTask, runProgress } from "../../focus/run-model";
import { activityActorName } from "../activity";
import type { Task } from "../model";
import type { TasksModuleApi } from "./use-tasks-module";

type RunApi = Pick<
  TasksModuleApi,
  | "loading"
  | "error"
  | "tasks"
  | "queuedTasks"
  | "markDone"
  | "moveQueuedToEnd"
  | "removeFromQueue"
  | "reorderQueue"
  | "loadActivity"
  | "currentUserId"
>;

/** Why a Now task left the run when nobody pressed anything here: `live` is
 *  what the task list holds for it now. */
export function leftRunNotice(
  live: Pick<Task, "id" | "status"> | undefined,
): "gone" | "completed" | null {
  if (!live) return "gone";
  if (live.status === "done") return "completed";
  return null;
}

export function useQueueRun({
  api,
  workspaceId,
  bucketNameById,
}: {
  api: RunApi;
  workspaceId: string;
  bucketNameById: (id: string) => string;
}) {
  const { run, ended, notice } = useQueueRunState();
  const runHere = run !== null && run.workspaceId === workspaceId;
  const inControl = isRunInControl(run);

  const taskRef = useCallback(
    (task: Task): FocusTaskRef => ({
      id: task.id,
      title: task.title || "Untitled",
      bucketName: bucketNameById(task.bucketId),
      workspaceId,
    }),
    [bucketNameById, workspaceId],
  );
  const resolveTask = useCallback(
    (id: string): FocusTaskRef | null => {
      const task = api.tasks.find((t) => t.id === id);
      return task ? taskRef(task) : null;
    },
    [api.tasks, taskRef],
  );

  const head = runNowTask(api.queuedTasks);
  // In control, Now is my queue's head; read through, it's what the run says
  // (my queue here may lag the device that runs it).
  const nowTask: Task | null = useMemo(() => {
    if (!runHere || !run) return null;
    if (inControl) return head;
    return (run.nowTaskId ? api.tasks.find((t) => t.id === run.nowTaskId) : undefined) ?? head;
  }, [runHere, run, inControl, head, api.tasks]);
  // The chip shows Now's title, also when another device runs the clock.
  const nowId = nowTask?.id ?? null;
  const nowTitle = nowTask ? nowTask.title || "Untitled" : null;
  useEffect(() => {
    if (nowId && nowTitle) noteQueueRunTitle(nowId, nowTitle);
  }, [nowId, nowTitle]);
  const upNext = useMemo(
    () => (nowTask ? openQueued(api.queuedTasks).filter((t) => t.id !== nowTask.id) : []),
    [api.queuedTasks, nowTask],
  );
  const doneTasks = useMemo(() => {
    if (!run) return [];
    const byId = new Map(api.tasks.map((t) => [t.id, t]));
    return run.doneTaskIds.flatMap((id) => {
      const t = byId.get(id);
      return t ? [t] : [];
    });
  }, [run, api.tasks]);
  const progress = run ? runProgress(run, api.queuedTasks) : { done: 0, total: 0 };

  // The task this tab just moved the run off (Done, Skip, …): its leaving is
  // no news. Anything else that takes Now away gets a quiet line.
  const expectedLeave = useRef<string | null>(null);
  const prevHead = useRef<Task | null>(null);
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  // Keep the run on the head of my queue (F2-2). Only the device in control
  // moves it; an emptied queue ends the run. Runs when the head's id, title or
  // bucket changes, not on every new `head` object a reload makes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the head's fields, see above.
  useEffect(() => {
    if (!runHere || !inControl || api.loading || api.error) {
      prevHead.current = head;
      return;
    }
    const previous = prevHead.current;
    prevHead.current = head;
    if (previous && previous.id !== head?.id && previous.id !== expectedLeave.current) {
      explainLeave(previous);
    }
    if (previous?.id !== head?.id) expectedLeave.current = null;
    moveQueueRun(workspaceId, head ? taskRef(head) : null, { explicit: false });
  }, [
    runHere,
    inControl,
    api.loading,
    api.error,
    head?.id,
    head?.title,
    head?.bucketId,
    workspaceId,
  ]);

  /** Now left the run without anyone pressing anything here: say why. */
  function explainLeave(task: Task): void {
    const live = apiRef.current.tasks.find((t) => t.id === task.id);
    const why = leftRunNotice(live);
    const title = task.title || "Untitled";
    if (why === "gone") {
      setQueueRunNotice(`“${title}” was deleted or is no longer shared with you.`);
      return;
    }
    if (why !== "completed") return;
    // Who completed it: the trail knows. Done by me elsewhere counts for the run.
    const me = apiRef.current.currentUserId;
    void apiRef.current
      .loadActivity(task.id)
      .then((entries) => {
        const entry = entries.find(
          (e) =>
            e.op === "tasks.completed" || (e.op === "tasks.set_status" && e.payload?.to === "done"),
        );
        if (entry?.actorId && me && entry.actorId === me) {
          recordRunDone(task.id, resolveTask);
          return;
        }
        const who = entry ? activityActorName(entry, me) : null;
        setQueueRunNotice(who ? `${who} completed “${title}”.` : `“${title}” was completed.`);
      })
      .catch(() => setQueueRunNotice(`“${title}” was completed.`));
  }

  const next = useCallback(
    (after: string) =>
      openQueued(api.queuedTasks).find((t) => t.id !== after && !t.id.startsWith("tmp-")) ?? null,
    [api.queuedTasks],
  );

  /** ▶ Start run on the first task of my queue. */
  const start = useCallback(
    (mode: FocusRunMode) => {
      if (!head) return;
      expectedLeave.current = null;
      prevHead.current = head;
      startQueueRun({ workspaceId, mode, task: taskRef(head) });
    },
    [head, workspaceId, taskRef],
  );

  /** Done (⏎): complete Now; the next task becomes Now. */
  const done = useCallback(() => {
    if (!nowTask) return;
    takeRunControl(resolveTask);
    expectedLeave.current = nowTask.id;
    recordRunDone(nowTask.id, resolveTask);
    api.markDone(nowTask.id);
    const after = next(nowTask.id);
    moveQueueRun(workspaceId, after ? taskRef(after) : null, { explicit: true });
  }, [nowTask, resolveTask, api, next, workspaceId, taskRef]);

  /** Skip: Now goes to the end of my queue (never a reschedule). Alone, it stays. */
  const skip = useCallback(() => {
    if (!nowTask) return;
    const after = next(nowTask.id);
    if (!after) return;
    takeRunControl(resolveTask);
    expectedLeave.current = nowTask.id;
    api.moveQueuedToEnd(nowTask.id);
    moveQueueRun(workspaceId, taskRef(after), { explicit: true });
  }, [nowTask, next, resolveTask, api, workspaceId, taskRef]);

  /** Remove from queue (⋯). On Now, the next task becomes Now. */
  const remove = useCallback(
    (id: string) => {
      if (nowTask && id === nowTask.id) {
        takeRunControl(resolveTask);
        expectedLeave.current = id;
        api.removeFromQueue(id);
        const after = next(id);
        moveQueueRun(workspaceId, after ? taskRef(after) : null, { explicit: true });
        return;
      }
      api.removeFromQueue(id);
    },
    [nowTask, resolveTask, api, next, workspaceId, taskRef],
  );

  /** Do now (⋯ on Up next): it becomes Now; the current Now goes back to the
   *  top of Up next. */
  const doNow = useCallback(
    (id: string) => {
      const target = api.queuedTasks.find((t) => t.id === id);
      if (!target || !nowTask || id === nowTask.id) return;
      takeRunControl(resolveTask);
      expectedLeave.current = nowTask.id;
      const order = api.queuedTasks.map((t) => t.id);
      api.reorderQueue([id, ...order.filter((x) => x !== id)]);
      moveQueueRun(workspaceId, taskRef(target), { explicit: true });
    },
    [api, nowTask, resolveTask, workspaceId, taskRef],
  );

  const togglePause = useCallback(() => toggleQueueRunPause(resolveTask), [resolveTask]);
  const end = useCallback(() => endQueueRun(), []);
  const dismissNotice = useCallback(() => setQueueRunNotice(null), []);
  const dismissEnded = useCallback(() => dismissEndedRun(), []);

  return {
    /** My open run (any workspace), the one that just ended, and its note. */
    run,
    ended,
    notice,
    /** The run is in this workspace. */
    runHere,
    /** This device runs the run's clock (else it's shown read through). */
    inControl,
    nowTask: runHere ? nowTask : null,
    upNext: runHere ? upNext : [],
    doneTasks,
    progress,
    /** The first task Start run would begin with. */
    head,
    resolveTask,
    start,
    done,
    skip,
    remove,
    doNow,
    togglePause,
    end,
    dismissNotice,
    dismissEnded,
  };
}

export type QueueRunApi = ReturnType<typeof useQueueRun>;
