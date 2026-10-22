// When a task happens: reschedule (relative or absolute), unschedule, and a
// repeat's occurrences (skip one, move just this one, its history).

import { toast } from "sonner";

import { dueOnToLocalInstant } from "../../../lib/task-rows";
import { formatScheduled } from "../helpers";
import type { RecurrenceRule, Task, TaskCycle } from "../model";
import { engineZone, skipOccurrencePatch } from "../recurrence-engine";
import type { TaskCommandsContext } from "./context";
import { isTempId, sayOffline, type Shared } from "./shared";

export function createScheduleOps(ctx: TaskCommandsContext, shared: Shared) {
  const { store, runtime, workspaceId, data } = ctx;
  const { applyOp } = shared;

  /**
   * Push a scheduled task's time `days` into the future, preserving its clock
   * time. Clears the drift (drift = scheduled time in the past). No-op if the
   * task has no scheduled time.
   */
  const rescheduleScheduledAt = (id: string, days: number, now: Date = new Date()) => {
    const existing = data().bundle.tasks.find((t) => t.id === id);
    if (!existing?.scheduledAt) return;
    const orig = new Date(existing.scheduledAt);
    const next = new Date(now);
    next.setDate(next.getDate() + days);
    next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    const scheduledAt = next.toISOString();
    applyOp(id, { scheduledAt }, () =>
      runtime!.tasks.opReschedule({ workspaceId: workspaceId!, taskId: id, scheduledAt, days }),
    );
  };

  /** Drift-triage Ignore: clear the stale scheduled time, keep the task. */
  const unscheduleTask = (id: string) => {
    applyOp(id, { scheduledAt: null }, () =>
      runtime!.tasks.opUnschedule({ workspaceId: workspaceId!, taskId: id }),
    );
  };

  /**
   * Move an already-scheduled task to an ABSOLUTE clock time via the attributed
   * reschedule op (writes `tasks.reschedule` activity) — the Calendar loop's
   * roll-forward path (Later today / Move to today). Distinct from
   * {@link rescheduleScheduledAt}, which is days-relative. The server op no-ops
   * if the task has nothing scheduled to move (a triage race).
   */
  const scheduleTaskAt = (id: string, scheduledAt: string) => {
    applyOp(id, { scheduledAt }, () =>
      runtime!.tasks.opReschedule({
        workspaceId: workspaceId!,
        taskId: id,
        scheduledAt,
      }),
    );
  };

  /**
   * Skip-occurrence (spec §5d): jump a recurring task to its next occurrence
   * without done-credit. Does NOT touch rescheduleCount — a skipped occurrence
   * is a decision, not a slip. Distinct from Execute's Skip (leave the queue).
   */
  const skipOccurrence = (id: string) => {
    const existing = data().bundle.tasks.find((t) => t.id === id);
    if (!existing) return;
    const patch = skipOccurrencePatch(existing, new Date(), engineZone());
    if (!patch?.scheduledAt || !patch.recurrence) return;
    const scheduledAt = patch.scheduledAt;
    const recurrence = patch.recurrence as RecurrenceRule;
    if (store?.isOffline()) {
      sayOffline();
      return;
    }
    applyOp(id, patch, () =>
      runtime!.tasks.opSkipOccurrence({
        workspaceId: workspaceId!,
        taskId: id,
        scheduledAt,
        recurrence,
        releaseCommit: "committedFor" in patch,
      }),
    );
    toast(`Skipped — next: ${formatScheduled(scheduledAt)}`);
  };

  /**
   * "Move just this one" on a repeat (TV-D12's op; TV-U15's Upcoming drag and
   * day keys): this cycle's due date or its work session's start moves, the
   * other date by the same days, and the rule stays (the next cycle is back on
   * the pattern). Shown at once; the server's row settles it.
   */
  const moveOccurrence = (id: string, to: { dueOn: string } | { startsAt: string }) => {
    const optimistic: Partial<Task> =
      "dueOn" in to
        ? { dueOn: to.dueOn, dueDate: dueOnToLocalInstant(to.dueOn) }
        : { scheduledAt: to.startsAt };
    applyOp(id, optimistic, () =>
      runtime!.tasks.opMoveOccurrence({ workspaceId: workspaceId!, taskId: id, ...to }),
    );
  };

  /**
   * A repeat's cycles, newest first (TV-D12's `tasks_op_history`): each done
   * or skipped one, who closed it and your own time in it (only yours). Read
   * on demand; empty without a connection.
   */
  const taskHistory = async (taskId: string): Promise<TaskCycle[]> => {
    if (!runtime || !workspaceId || isTempId(taskId)) return [];
    return runtime.tasks.taskHistory({ workspaceId, taskId });
  };

  return {
    rescheduleScheduledAt,
    unscheduleTask,
    scheduleTaskAt,
    skipOccurrence,
    moveOccurrence,
    taskHistory,
  };
}
