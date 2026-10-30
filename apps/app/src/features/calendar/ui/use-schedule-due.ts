// Schedule (S) from a day header's due list (CALR-2, AC6): the task goes to the
// first free time on its day that fits its estimate (from now, on today),
// inside working hours, past every event and block already there; one Undo.
// An overdue task (a past day's list) goes to today: its own day is over.

import { useCallback } from "react";
import { toast } from "sonner";

import type { Task } from "../../tasks/model";
import type { useTaskCommands } from "../../tasks/tasks-context";
import { placeTask } from "../commands/undo";
import { type CalendarEventModel, type EventChip, eventChipsInRange } from "../events";
import { type BusyInterval, findNextGap } from "../gap-finder";
import {
  DEFAULT_BLOCK_MINUTES,
  localDayKey,
  type RangePrefs,
  startOfLocalDay,
  type TaskBlock,
  taskBlocks,
  type VisibleRange,
  visibleRange,
} from "../lens";
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

/**
 * Events and your blocks on any day, for Schedule: an overdue task goes to
 * today, which may be off screen, so a day outside the view is read then.
 */
export function useBusyOn(q: {
  range: VisibleRange;
  prefs: RangePrefs;
  events: CalendarEventModel[];
  isWritable: (event: CalendarEventModel) => boolean;
  userId: string;
  timed: ReadonlyMap<string, readonly EventChip[]>;
  tasks: Parameters<typeof taskBlocks>[0];
  sessions: NonNullable<Parameters<typeof taskBlocks>[2]>["list"];
  blocksByDay: ReadonlyMap<string, readonly TaskBlock[]>;
}) {
  const { range, prefs, events, isWritable, userId, timed, tasks, sessions, blocksByDay } = q;
  return useCallback(
    (day: Date): BusyInterval[] => {
      const key = localDayKey(day);
      const shown = range.days.some((d) => localDayKey(d) === key);
      const one = shown ? null : visibleRange("day", day, prefs);
      const chips = one
        ? (eventChipsInRange(events, one, isWritable, userId).timed.get(key) ?? [])
        : (timed.get(key) ?? []);
      const own = one
        ? taskBlocks(tasks, one, { list: sessions, me: userId })
        : (blocksByDay.get(key) ?? []);
      return [...chips, ...own].map((x) => ({ startMs: x.startMs, endMs: x.endMs }));
    },
    [range.days, prefs, events, isWritable, userId, timed, tasks, sessions, blocksByDay],
  );
}
