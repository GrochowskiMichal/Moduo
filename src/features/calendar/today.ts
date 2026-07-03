// The "Today" shaper (CAL-7, AC14) — the dashboard widget's pure view model.
// Composes today's timed chips (events + task blocks, the lens), the next-up
// emphasis, and the strip count (unfinished-from-earlier) from raw inputs, so
// the widget stays a thin renderer. Quiet by construction — never red.

import {
  addDays,
  localDayKey,
  startOfLocalDay,
  taskBlocks,
  visibleRange,
  type LensTask,
} from "./lens";
import { eventChipsInRange, type CalendarEventModel } from "./events";
import { stripItems } from "./strip";

export type TodayChip = {
  kind: "event" | "task";
  /** Deep-link id — the taskId for blocks, the eventId for events. */
  entityId: string;
  entityType: "task" | "event";
  title: string;
  startMs: number;
  endMs: number;
  /** Task blocks only — a done block renders checked/quiet. */
  done: boolean;
};

export type TodayView = {
  dayStartMs: number;
  /** Real minutes in today (DST-aware) — the mini-timeline's span. */
  totalMinutes: number;
  /** Now-line position in minutes into today. */
  nowMinutes: number;
  /** Today's timed chips, sorted by start. */
  chips: TodayChip[];
  /** The next-up chip — the first not-yet-ended, not-done chip. */
  next: TodayChip | null;
  /** Upcoming chips (ending after now), capped for the widget. */
  remaining: TodayChip[];
  /** Count of open tasks whose scheduled time already passed (the strip). */
  stripCount: number;
};

export function shapeToday(input: {
  tasks: LensTask[];
  events: CalendarEventModel[];
  weekStartsOn: number;
  now: Date;
  maxRemaining?: number;
}): TodayView {
  const nowMs = input.now.getTime();
  const todayStart = startOfLocalDay(input.now);
  const dayStartMs = todayStart.getTime();
  const dayEndMs = addDays(todayStart, 1).getTime();
  const todayKey = localDayKey(todayStart);

  const range = visibleRange("day", todayStart, {
    weekStartsOn: input.weekStartsOn,
    showWeekends: true,
  });
  const blocks = taskBlocks(input.tasks, range).filter((b) => b.dayKey === todayKey);
  const events = eventChipsInRange(input.events, range).timed.get(todayKey) ?? [];

  const chips: TodayChip[] = [
    ...blocks.map((b) => ({
      kind: "task" as const,
      entityId: b.taskId,
      entityType: "task" as const,
      title: b.title,
      startMs: b.startMs,
      endMs: b.endMs,
      done: b.done,
    })),
    ...events.map((c) => ({
      kind: "event" as const,
      entityId: c.eventId,
      entityType: "event" as const,
      title: c.title,
      startMs: c.startMs,
      endMs: c.endMs,
      done: false,
    })),
  ].sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));

  const remaining = chips
    .filter((c) => c.endMs > nowMs && !c.done)
    .slice(0, input.maxRemaining ?? 4);

  return {
    dayStartMs,
    totalMinutes: Math.round((dayEndMs - dayStartMs) / 60_000),
    nowMinutes: Math.min(Math.max((nowMs - dayStartMs) / 60_000, 0), (dayEndMs - dayStartMs) / 60_000),
    chips,
    next: remaining[0] ?? null,
    remaining,
    stripCount: stripItems(input.tasks, nowMs).length,
  };
}
