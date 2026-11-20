// Sessions, reminders, Waiting on… (TV-U13, on TV-D10's ops). Each op
// answers with the task's rows of that table (sessions: everyone's;
// reminders: mine), which become the copy; a refused write puts back only
// its own change. A session's person is me or the task's assignee (the
// server refuses anyone else, TV-D10-fix), and moving or resizing keeps it.
//
// Each answers whether the write started (false: it was refused up front
// and said why), so a caller's own toast and Undo show only for a real one.

import { taskCategoryOf, type TaskStatusCategory } from "@contracts/vocabularies";
import { toast } from "sonner";

import type { Task, TaskReminder, TaskSession, TaskWaitingEntry } from "../model";
import type { TaskCommandsContext } from "./context";
import { isTempId, sayOffline, type Shared, STILL_SAVING } from "./shared";

export function createActivityOps(ctx: TaskCommandsContext, shared: Shared) {
  const { store, runtime, workspaceId, userId, data, env, bumpActivity } = ctx;
  const { editBlocked, refused } = shared;

  /**
   * Bring a task's paused reminders back (TV-D12's `tasks_op_reminders_restore`;
   * the offer below and the panel's Reminder list): once the task is To do or
   * In progress, only those still ahead, everyone's when you can edit it. Shown
   * at once; the server's rows settle it (a passed one stays paused, and says so).
   */
  const restoreReminders = (taskId: string) => {
    if (!store || !runtime || !workspaceId) return;
    if (store.isOffline()) {
      sayOffline();
      return;
    }
    const parked = data().reminders.filter(
      (r) => r.taskId === taskId && r.suspendedAt && !r.firedAt,
    );
    if (parked.length === 0) return;
    const parkedIds = new Set(parked.map((r) => r.id));
    const write = store.begin(
      parked.map((r) => ({
        table: "reminders" as const,
        patch: { id: r.id, fields: { suspendedAt: null } },
      })),
    );
    void runtime.tasks
      .restoreReminders({ workspaceId, taskId })
      .then((mine) => {
        write.settle({ reminders: mine });
        const back = mine.filter((r) => parkedIds.has(r.id) && !r.suspendedAt).length;
        if (back === 0) {
          toast(
            parked.length === 1
              ? "Its time has already passed."
              : "Their times have already passed.",
          );
        }
      })
      .catch((e) => refused(write, e, "Couldn’t restore the reminder. Try again."));
  };

  /**
   * "Restore the reminder?" (TV-D12, spec edge cases): moving a task to
   * Backlog or Won't do suspended its reminders; bringing it back to To do or
   * In progress asks, once, whether to restore them (everyone's when you can
   * edit it; only those still ahead). Offline, a status change only queues:
   * no offer to restore until it's sent.
   */
  const offerReminderRestore = (task: Task, to: TaskStatusCategory | undefined) => {
    const d = data();
    if (!runtime || !workspaceId || !env().canEdit || (!!store && d.offline)) return;
    if (to !== "todo" && to !== "in_progress") return;
    const from = taskCategoryOf(task);
    if (from !== "backlog" && from !== "wont_do") return;
    const parked = d.reminders.filter((r) => r.taskId === task.id && r.suspendedAt && !r.firedAt);
    if (parked.length === 0) return;
    toast(parked.length === 1 ? "Restore the reminder?" : `Restore ${parked.length} reminders?`, {
      description: `Moving it to ${from === "backlog" ? "Backlog" : "Won’t do"} paused ${
        parked.length === 1 ? "it" : "them"
      }.`,
      action: { label: "Restore", onClick: () => restoreReminders(task.id) },
    });
  };

  /** Schedule a work session (the panel's Scheduled picker). */
  const addSession = (
    taskId: string,
    input: { startsAt: string; endsAt: string; userId: string | null },
  ): boolean => {
    if (editBlocked() || !store || !runtime || !workspaceId) return false;
    if (isTempId(taskId)) {
      toast.error(STILL_SAVING);
      return false;
    }
    const shown: TaskSession = {
      id: crypto.randomUUID(),
      workspaceId,
      taskId,
      userId: input.userId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      updatedAt: new Date().toISOString(),
    };
    const write = store.begin([{ table: "sessions", insert: shown }]);
    void runtime.tasks
      .addSession({
        workspaceId,
        taskId,
        id: shown.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...(input.userId ? { userId: input.userId } : {}),
      })
      .then((rows) => {
        write.settle({ sessions: rows });
        bumpActivity();
      })
      .catch((e) => refused(write, e, "Couldn’t schedule the session."));
    return true;
  };

  /** Move or resize a session; its person stays. */
  const updateSession = (
    sessionId: string,
    patch: { startsAt?: string; endsAt?: string },
  ): boolean => {
    if (editBlocked() || !store || !runtime || !workspaceId) return false;
    const write = store.begin([{ table: "sessions", patch: { id: sessionId, fields: patch } }]);
    void runtime.tasks
      .updateSession({ workspaceId, sessionId, patch })
      .then((rows) => {
        write.settle({ sessions: rows });
        bumpActivity();
      })
      .catch((e) => refused(write, e, "Couldn’t move the session."));
    return true;
  };

  const removeSession = (sessionId: string): boolean => {
    if (editBlocked() || !store || !runtime || !workspaceId) return false;
    const write = store.begin([{ table: "sessions", remove: sessionId }]);
    void runtime.tasks
      .removeSession({ workspaceId, sessionId })
      .then((rows) => {
        store.forget("sessions", [sessionId]);
        write.settle({ sessions: rows });
        bumpActivity();
      })
      .catch((e) => refused(write, e, "Couldn’t remove the session."));
    return true;
  };

  /** One of my reminders: at a time, or a day / an hour before due. True once
   *  it's on its way (offline or a task still saving says why and answers false). */
  const addReminder = (
    taskId: string,
    kind: TaskReminder["kind"],
    at: string | null = null,
  ): boolean => {
    if (!store || !runtime || !workspaceId || !userId) return false;
    if (store.isOffline()) {
      sayOffline();
      return false;
    }
    if (isTempId(taskId)) {
      toast.error(STILL_SAVING);
      return false;
    }
    const shown: TaskReminder = {
      id: `tmp-${crypto.randomUUID()}`,
      workspaceId,
      taskId,
      userId,
      kind,
      at,
      firedAt: null,
      suspendedAt: null,
      updatedAt: new Date().toISOString(),
    };
    const write = store.begin([{ table: "reminders", insert: shown }]);
    void runtime.tasks
      .addReminder({ workspaceId, taskId, kind, at })
      .then((rows) => write.settle({ reminders: rows }))
      .catch((e) => refused(write, e, "Couldn’t set the reminder."));
    return true;
  };

  const removeReminder = (reminderId: string) => {
    if (!store || !runtime || !workspaceId) return;
    if (store.isOffline()) {
      sayOffline();
      return;
    }
    if (isTempId(reminderId)) return;
    const write = store.begin([{ table: "reminders", remove: reminderId }]);
    void runtime.tasks
      .removeReminder({ workspaceId, reminderId })
      .then((rows) => {
        store.forget("reminders", [reminderId]);
        write.settle({ reminders: rows });
      })
      .catch((e) => refused(write, e, "Couldn’t remove the reminder."));
  };

  /** Waiting on… someone or something (a person, or a typed note). Answers the
   *  new entry's id (Focus's Hand off undoes it by id, TV-F8), or null. */
  const addWaiting = (
    taskId: string,
    entry: { kind: TaskWaitingEntry["kind"]; ref?: string | null; label?: string | null },
  ): string | null => {
    if (editBlocked() || !store || !runtime || !workspaceId) return null;
    if (isTempId(taskId)) {
      toast.error(STILL_SAVING);
      return null;
    }
    const now = new Date().toISOString();
    const shown: TaskWaitingEntry = {
      id: crypto.randomUUID(),
      workspaceId,
      taskId,
      kind: entry.kind,
      ref: entry.ref ?? null,
      label: entry.label ?? null,
      since: now,
      createdBy: userId,
      updatedAt: now,
    };
    const write = store.begin([{ table: "waiting", insert: shown }]);
    void runtime.tasks
      .addWaiting({
        workspaceId,
        taskId,
        id: shown.id,
        kind: entry.kind,
        ref: entry.ref ?? null,
        label: entry.label ?? null,
      })
      .then((rows) => {
        write.settle({ waiting: rows });
        bumpActivity();
      })
      .catch((e) => refused(write, e, "Couldn’t add it to Waiting on."));
    return shown.id;
  };

  const removeWaiting = (entryId: string) => {
    if (editBlocked() || !store || !runtime || !workspaceId) return;
    const write = store.begin([{ table: "waiting", remove: entryId }]);
    void runtime.tasks
      .removeWaiting({ workspaceId, entryId })
      .then((rows) => {
        store.forget("waiting", [entryId]);
        write.settle({ waiting: rows });
        bumpActivity();
      })
      .catch((e) => refused(write, e, "Couldn’t remove it from Waiting on."));
  };

  return {
    restoreReminders,
    offerReminderRestore,
    addSession,
    updateSession,
    removeSession,
    addReminder,
    removeReminder,
    addWaiting,
    removeWaiting,
  };
}
