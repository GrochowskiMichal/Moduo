// Schedule (S) from a day header's due list (CALR-2, AC6): the task goes to the
// first free time on its day that fits its estimate (from now, on today),
// inside working hours, past every event and block already there; one Undo.

import { useCallback } from "react";
import { toast } from "sonner";

import type { Task } from "../../tasks/model";
import type { useTaskCommands } from "../../tasks/tasks-context";
import { placeTask } from "../commands/undo";
import type { EventChip } from "../events";
import { type BusyInterval, findNextGap } from "../gap-finder";
import { DEFAULT_BLOCK_MINUTES, localDayKey, startOfLocalDay, type TaskBlock } from "../lens";
import type { CalendarPrefs } from "../prefs";
import { formatDayLabel, formatTimeOfDay } from "./time-format";

type Input = {
  tasks: readonly Pick<Task, "id" | "durationMinutes">[];
  prefs: Pick<CalendarPrefs, "workStartMinute" | "workEndMinute">;
  commands: Pick<ReturnType<typeof useTaskCommands>, "patchTask">;
  eventsByDay: ReadonlyMap<string, readonly EventChip[]>;
  blocksByDay: ReadonlyMap<string, readonly TaskBlock[]>;
};

export function useScheduleDue({ tasks, prefs, commands, eventsByDay, blocksByDay }: Input) {
  return useCallback(
    (taskId: string, day: Date) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const dayStart = startOfLocalDay(day);
      const key = localDayKey(dayStart);
      const busy: BusyInterval[] = [
        ...(eventsByDay.get(key) ?? []).map((c) => ({ startMs: c.startMs, endMs: c.endMs })),
        ...(blocksByDay.get(key) ?? []).map((b) => ({ startMs: b.startMs, endMs: b.endMs })),
      ];
      const durationMinutes =
        task.durationMinutes && task.durationMinutes > 0
          ? task.durationMinutes
          : DEFAULT_BLOCK_MINUTES;
      const gap = findNextGap({
        nowMs: Math.max(Date.now(), dayStart.getTime()),
        dayStartMs: dayStart.getTime(),
        workStartMinute: prefs.workStartMinute,
        workEndMinute: prefs.workEndMinute,
        durationMinutes,
        busy,
      });
      if (gap == null) {
        toast(`No free time left on ${formatDayLabel(dayStart.getTime())} fits it.`);
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
    [tasks, prefs, commands, eventsByDay, blocksByDay],
  );
}
