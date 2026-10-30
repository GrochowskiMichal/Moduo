// Schedule (S) from a day header's due list (CALR-2, AC6): the task goes to the
// first free time on its day that fits its estimate (from now, on today),
// inside working hours, past every event and block already there; one Undo.
// An overdue task (a past day's list) goes to today: its own day is over.

import { useCallback } from "react";
import { toast } from "sonner";

import type { Task } from "../../tasks/model";
import type { useTaskCommands } from "../../tasks/tasks-context";
import { placeTask } from "../commands/undo";
import { type BusyInterval, findNextGap } from "../gap-finder";
import { DEFAULT_BLOCK_MINUTES, startOfLocalDay } from "../lens";
import type { CalendarPrefs } from "../prefs";
import { formatDayLabel, formatTimeOfDay } from "./time-format";

type Input = {
  tasks: readonly Pick<Task, "id" | "durationMinutes">[];
  prefs: Pick<CalendarPrefs, "workStartMinute" | "workEndMinute">;
  commands: Pick<ReturnType<typeof useTaskCommands>, "patchTask">;
  /** Events and blocks on a day, which may be off screen. */
  busyOn: (day: Date) => readonly BusyInterval[];
};

type SlotQuery = Pick<Input, "prefs" | "busyOn"> & {
  day: Date;
  nowMs: number;
  durationMinutes: number;
};

/** The day searched (a past day becomes today) and its first fitting gap. */
export function findDueSlot(q: SlotQuery): { dayStartMs: number; gapMs: number | null } {
  const today = startOfLocalDay(new Date(q.nowMs));
  const due = startOfLocalDay(q.day);
  const dayStart = due.getTime() < today.getTime() ? today : due;
  const gapMs = findNextGap({
    nowMs: Math.max(q.nowMs, dayStart.getTime()),
    dayStartMs: dayStart.getTime(),
    workStartMinute: q.prefs.workStartMinute,
    workEndMinute: q.prefs.workEndMinute,
    durationMinutes: q.durationMinutes,
    busy: [...q.busyOn(dayStart)],
  });
  return { dayStartMs: dayStart.getTime(), gapMs };
}

export function useScheduleDue({ tasks, prefs, commands, busyOn }: Input) {
  return useCallback(
    (taskId: string, day: Date) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const durationMinutes =
        task.durationMinutes && task.durationMinutes > 0
          ? task.durationMinutes
          : DEFAULT_BLOCK_MINUTES;
      const { dayStartMs, gapMs: gap } = findDueSlot({
        day,
        nowMs: Date.now(),
        prefs,
        durationMinutes,
        busyOn,
      });
      if (gap == null) {
        toast(`No free time left on ${formatDayLabel(dayStartMs)} fits it.`);
        return;
      }
      // The same write as dropping the task on the grid (AC6 of CAL-2); one Undo (CALR-4).
      placeTask(
        commands,
        task,
        { scheduledAt: new Date(gap).toISOString(), durationMinutes },
        `Scheduled ${formatDayLabel(gap)} at ${formatTimeOfDay(gap)}`,
      );
    },
    [tasks, prefs, commands, busyOn],
  );
}
