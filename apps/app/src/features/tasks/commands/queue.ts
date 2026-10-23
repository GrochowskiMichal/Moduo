// My personal queue (TV-D4, "Up next"): add, take out, move, arrange, capture
// straight into it, and "Focus on this". Each person has their own Queue, not
// tied to a date (tasks-v2 §2); others' rows are claims ("In Mike's queue").

import { isClosedTask } from "@contracts/vocabularies";
import { toast } from "sonner";

import { readLocalFocusPrefs } from "../../../lib/focus-prefs";
import type { FocusTaskRef } from "../../focus/engine";
import { focusOn } from "../../focus/timer";
import { betweenPositions, endPosition, makeTask } from "../helpers";
import type { QueuePlacement, Task, TaskQueueEntry } from "../model";
import {
  alsoInLabel,
  applyQueueMoves,
  endOfQueue,
  movedPosition,
  queueMove,
  queueMoves,
} from "../queue";
import type { NewTaskInput, TaskCommandsContext } from "./context";
import { isTempId, NO_EDIT, NOT_CREATED, patchOf, type Shared, STILL_SAVING } from "./shared";

export function createQueueOps(ctx: TaskCommandsContext, shared: Shared) {
  const { store, runtime, workspaceId, userId, data, env } = ctx;
  const { archivedBlocked, backlogToTodo, optimisticEntry, runQueueOp, sendNewTask, sendQueueOp } =
    shared;

  /**
   * Add a task to my queue: the end, or the top (Calendar's "Start focus").
   * Queuing a task someone else has queued too is fine, with a quiet note.
   * `onSaved` runs once the server has it queued (the rail drop's Undo).
   */
  const addToQueue = (id: string, at: QueuePlacement = "end", onSaved?: () => void) => {
    const d = data();
    const { canEdit, memberName } = env();
    const task = d.liveTasks.find((t) => t.id === id);
    if (!task) {
      archivedBlocked(id);
      return;
    }
    if (isTempId(id)) {
      toast.error(STILL_SAVING);
      return;
    }
    if (task.status === "done" || task.status === "archived") {
      toast.error(
        task.status === "done" ? "Done tasks can't be queued." : "Archived tasks can't be queued.",
      );
      return;
    }
    if (d.queuedTaskIds.has(id) && at === "end") return;
    // Queuing a backlog task moves it to To do (the server does it in the
    // same transaction); show it at once, until the quiet read below.
    const toTodo = canEdit && store && !store.isOffline() ? backlogToTodo(task) : null;
    const shownTodo = toTodo ? store?.begin([patchOf(id, toTodo)]) : undefined;
    const started = runQueueOp(
      (mine) => {
        const rest = mine.filter((e) => e.taskId !== id);
        const position =
          at === "top" ? betweenPositions(null, rest[0]?.position ?? null) : endOfQueue(rest);
        return [...rest, optimisticEntry(id, position)];
      },
      (rt, ws) =>
        rt.tasks.opQueueAdd({ workspaceId: ws, taskId: id, at }).catch((e) => {
          shownTodo?.fail();
          throw e;
        }),
      // The queue op answers with the queue, not the task: a quiet read then
      // settles the task's status (the server moves it only when you can
      // edit the task, which this list can't tell).
      shownTodo
        ? () => {
            onSaved?.();
            void store?.syncNow().finally(() => shownTodo.settle());
          }
        : onSaved,
    );
    if (!started) shownTodo?.fail();
    const others = d.queueClaims.get(id) ?? [];
    if (started && others.length > 0) toast(alsoInLabel(others.map(memberName)));
  };

  const removeFromQueue = (id: string) => {
    // The line-up as it is now: a drop's Undo calls this long after its render.
    if (!data().myQueueEntries.some((e) => e.taskId === id)) return;
    if (isTempId(id)) {
      toast.error(STILL_SAVING);
      return;
    }
    runQueueOp(
      (mine) => mine.filter((e) => e.taskId !== id),
      (rt, ws) => rt.tasks.opQueueRemove({ workspaceId: ws, taskId: id }),
    );
  };

  /** In or out of my queue: the row/card toggle, `q`, the menus, the panel. */
  const toggleQueue = (id: string) => {
    if (data().queuedTaskIds.has(id)) removeFromQueue(id);
    else addToQueue(id);
  };

  /** What the one clock binds for a task here (title, project, workspace). */
  const focusRefOf = (taskId: string): FocusTaskRef | null => {
    const d = data();
    const task = d.allTasks.find((t) => t.id === taskId);
    if (!task || !workspaceId) return null;
    const project =
      task.bucketId === d.inbox?.id
        ? "Inbox"
        : (d.liveBuckets.find((b) => b.id === task.bucketId)?.name ?? null);
    return { id: task.id, title: task.title || "Untitled", bucketName: project, workspaceId };
  };

  /**
   * "Focus on this" (⇧F, the row and panel menus, call 31): the task goes on
   * top of my Up next and gets the one clock now. A session on moves to it with
   * its rhythm; none starts one with my default Timer (Calendar's ▶ recipe,
   * TV-F6). False when it can't: a viewer, a finished task, one still saving.
   */
  const focusOnTask = (id: string): boolean => {
    if (!env().canEdit) {
      toast.error(NO_EDIT);
      return false;
    }
    if (isTempId(id)) {
      toast.error(STILL_SAVING);
      return false;
    }
    const task = data().liveTasks.find((t) => t.id === id);
    const ref = focusRefOf(id);
    if (!task || !ref || isClosedTask(task)) return false;
    addToQueue(id, "top");
    focusOn(ref, { timer: readLocalFocusPrefs().timer, resolveTask: focusRefOf });
    return true;
  };

  /** Skip in Focus: the task goes to the end of my queue. Not a reschedule. */
  const moveQueuedToEnd = (id: string) => {
    if (!data().queuedTaskIds.has(id)) return;
    if (isTempId(id)) {
      toast.error(STILL_SAVING);
      return;
    }
    runQueueOp(
      (mine) => {
        const rest = mine.filter((e) => e.taskId !== id);
        const moved = mine.find((e) => e.taskId === id);
        return moved ? [...rest, { ...moved, position: endOfQueue(rest) }] : mine;
      },
      (rt, ws) => rt.tasks.opQueueMoveToEnd({ workspaceId: ws, taskId: id }),
    );
  };

  /**
   * A drag in the Queue: `orderedIds` is the list as it now looks. One task
   * moved; it goes right after the queued task it now follows (or to the top).
   * `onSaved` runs once the server has the new order (the drop's Undo).
   */
  const reorderQueue = (orderedIds: string[], onSaved?: () => void) => {
    if (!env().canEdit) return;
    // The line-up as it is now: a drop's Undo calls this long after its render.
    const move = queueMove(
      data().myQueueEntries.map((e) => e.taskId),
      orderedIds,
    );
    if (!move) return;
    if (isTempId(move.taskId) || (move.afterTaskId && isTempId(move.afterTaskId))) {
      toast.error(STILL_SAVING);
      return;
    }
    runQueueOp(
      (mine) =>
        mine.map((e) =>
          e.taskId === move.taskId
            ? { ...e, position: movedPosition(mine, move.taskId, move.afterTaskId) }
            : e,
        ),
      (rt, ws) =>
        rt.tasks.opQueueReorder({
          workspaceId: ws,
          taskId: move.taskId,
          afterTaskId: move.afterTaskId,
        }),
      onSaved,
    );
  };

  /**
   * Put my whole line-up in `orderedIds`' order (Focus's "Arrange by project"
   * and its Undo, TV-F8): shown at once, then sent as single moves, one after
   * another, behind any queue op already on its way. When a later move is
   * refused (the network went, a task left the line-up meanwhile), the moves
   * already saved stand and the line-up shows the server's order: `onSaved`
   * still runs, with `partial`, so the caller's Undo can walk it back. A first
   * move that fails changes nothing (the usual error). False when nothing moves.
   */
  const arrangeQueue = (
    orderedIds: readonly string[],
    onSaved?: (partial: boolean) => void,
  ): boolean => {
    if (!env().canEdit) return false;
    const moves = queueMoves(
      data().myQueueEntries.map((e) => e.taskId),
      orderedIds,
    );
    if (moves.length === 0) return false;
    if (moves.some((m) => isTempId(m.taskId) || (m.afterTaskId && isTempId(m.afterTaskId)))) {
      toast.error(STILL_SAVING);
      return false;
    }
    let partial = false;
    return runQueueOp(
      (mine) => applyQueueMoves(mine, moves),
      async (rt, ws) => {
        let answer: TaskQueueEntry[] | null = null;
        for (const m of moves) {
          try {
            answer = await rt.tasks.opQueueReorder({
              workspaceId: ws,
              taskId: m.taskId,
              afterTaskId: m.afterTaskId,
            });
          } catch (e) {
            // Nothing saved yet: the usual refusal. Else the server's order
            // after the moves that went through becomes the line-up.
            if (!answer) throw e;
            partial = true;
            break;
          }
        }
        return answer ?? [];
      },
      () => onSaved?.(partial),
    );
  };

  /**
   * Create a task and line it up at the end of my queue, in one gesture: shown
   * queued at once; once the server has the task, it's added to the end of my
   * queue (behind earlier queue ops). New in Focus or the Queue lands in Up next
   * this way (TV-P0, AC1.9). An assignee left unchosen is me. Resolves to the
   * saved task, or null, like `createTask` (so a capture can tag it). Offline
   * it waits on the device and is queued once it's sent.
   */
  const createQueuedTask = (fields: NewTaskInput): Promise<Task | null> => {
    if (!fields.title.trim()) return Promise.resolve(null);
    const canEdit = env().canEdit;
    if (!runtime || !workspaceId || !canEdit || !userId || !store) {
      if (!canEdit) toast.error(NO_EDIT);
      return Promise.resolve(null);
    }
    const rt = runtime;
    const ws = workspaceId;
    const me = userId;
    const position = endPosition(data().liveTasks.filter((t) => t.bucketId === fields.bucketId));
    const optimistic = makeTask({ ...fields, workspaceId: ws, position });
    optimistic.creatorId = me;
    if (optimistic.assigneeId === "") optimistic.assigneeId = me;
    const tempId = `tmp-${crypto.randomUUID()}`;
    optimistic.id = tempId;
    if (store.isOffline()) return sendNewTask(optimistic, { queue: true });
    const created = sendNewTask(optimistic, { queue: true }).then((saved) => {
      // The placeholder follows the task to its server id.
      if (saved) store.relinkLineup(tempId, saved.id);
      return saved;
    });
    // Shown queued at once; queuing it waits behind earlier queue ops and
    // for the task to exist. Not created (or waiting offline, queued once
    // it's sent): the placeholder goes.
    sendQueueOp(
      (mine) => [...mine, optimisticEntry(tempId, endOfQueue(mine))],
      async () => {
        const saved = await created;
        if (!saved) throw NOT_CREATED;
        return rt.tasks.opQueueAdd({ workspaceId: ws, taskId: saved.id });
      },
    );
    return created;
  };

  /**
   * Capture a new task straight into my queue (Focus's empty-queue affordance,
   * DF-11): in the Inbox, assigned to me, queued at the end.
   */
  const captureToQueue = (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const inbox = data().inbox;
    if (!inbox) {
      if (!env().canEdit) toast.error(NO_EDIT);
      return;
    }
    void createQueuedTask({ bucketId: inbox.id, title: trimmed, assigneeId: userId });
  };

  /**
   * Put a task back in my queue where it was before a drop closed it (TV-U4's
   * gap: Done, then Undo): after the queued task it followed then, or the
   * nearest earlier one still queued, or at the top.
   */
  const restoreQueuePlace = (taskId: string, lineupBefore: string[]) => {
    const mineNow = data().myQueueEntries;
    if (mineNow.some((e) => e.taskId === taskId)) return;
    const queuedNow = new Set(mineNow.map((e) => e.taskId));
    const at = lineupBefore.indexOf(taskId);
    let afterTaskId: string | null = null;
    for (let i = at - 1; i >= 0; i -= 1) {
      if (queuedNow.has(lineupBefore[i])) {
        afterTaskId = lineupBefore[i];
        break;
      }
    }
    runQueueOp(
      (mine) => {
        const index = afterTaskId ? mine.findIndex((e) => e.taskId === afterTaskId) : -1;
        const prev = index >= 0 ? mine[index].position : null;
        const next = mine[index + 1]?.position ?? null;
        return [...mine, optimisticEntry(taskId, betweenPositions(prev, next))];
      },
      async (rt, ws) => {
        await rt.tasks.opQueueAdd({ workspaceId: ws, taskId, at: "end" });
        return rt.tasks.opQueueReorder({ workspaceId: ws, taskId, afterTaskId });
      },
    );
  };

  return {
    addToQueue,
    removeFromQueue,
    toggleQueue,
    focusRefOf,
    focusOnTask,
    moveQueuedToEnd,
    reorderQueue,
    arrangeQueue,
    createQueuedTask,
    captureToQueue,
    restoreQueuePlace,
  };
}
