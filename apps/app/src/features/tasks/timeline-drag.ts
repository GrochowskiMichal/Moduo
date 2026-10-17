// Working on the Timeline's canvas (Tasks v3 TV-TL2, spec §6, REPLAN 70): what
// a drag, a click on an empty row, an edge scroll and a keyboard move turn
// into. Pure: no React, no IO. Days are the axis's day numbers
// (timeline-scale.ts); writes are the bulk engine's (`BulkWrite`, TV-U12), so
// every move of tasks, one or several, saves as one store write with one Undo.
//
// What moves what (70):
//   - a point moves only its task's due date (a hollow one: its next work
//     session, at the same time of day);
//   - a diamond moves its section's end date;
//   - a band moves its section's dates, and its ends resize;
//   - a project's bar moves as a whole, and its ends resize;
//   - nothing moves between rows, so dragging never reassigns or refiles.

import { dueOnToLocalInstant, localDayOf } from "../../lib/task-rows";
import { type BulkWrite, dayWordOf, dueDayOf as dueKeyOf, shiftDayKey, tasksWord } from "./bulk";
import type { RecurrenceRule, Task } from "./model";
import { changePatternRule } from "./recurrence-engine";
import type { DaySpan } from "./timeline-rows";
import { DAY_WIDTH, keyOfDay, TIMELINE_ZOOMS, type TimelineZoom } from "./timeline-scale";

/** Which part of a span a drag holds. */
export type SpanEdge = "move" | "start" | "end";

/** What a pointer grabbed on the canvas. */
export type TimelineGrab =
  /** Task points: the one grabbed, and the selection it moves with. */
  | { kind: "point"; taskId: string; taskIds: readonly string[] }
  /** A section with only an end date. */
  | { kind: "diamond"; sectionId: string; day: number }
  /** A section's range, on its own row. */
  | { kind: "band"; sectionId: string; span: DaySpan; edge: SpanEdge }
  /** A project's bar (`solid`: both dates were set; else it was worked out,
   *  and a drag sets both, making it solid). */
  | { kind: "bar"; projectId: string; span: DaySpan; edge: SpanEdge; solid: boolean }
  /** Drawing on a row that has no date yet: a task's point, a section's end or range, a project's bar. */
  | { kind: "draw"; target: DrawTarget; from: number };

/** A row an empty spot can be dated on (click-to-create). */
export type DrawTarget =
  | { kind: "task"; taskId: string }
  | { kind: "section"; sectionId: string }
  | { kind: "project"; projectId: string };

/** Pointer travel before a press turns into a drag (a click stays a click). */
export const DRAG_THRESHOLD_PX = 4;

/** A span after a drag of `delta` days on one of its parts; never inside out. */
export function moveSpan(span: DaySpan, edge: SpanEdge, delta: number): DaySpan {
  if (edge === "move") return { start: span.start + delta, end: span.end + delta };
  if (edge === "start") return { start: Math.min(span.start + delta, span.end), end: span.end };
  return { start: span.start, end: Math.max(span.end + delta, span.start) };
}

/** The span between two days, whichever way the pointer went. */
export function drawnSpan(a: number, b: number): DaySpan {
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * How long a project's bar is when a click places one (research §4: Jira
 * gives 7, 14 or 30 days by zoom; a year's view, a quarter).
 */
export const NEW_BAR_DAYS: Record<TimelineZoom, number> = {
  week: 7,
  month: 14,
  quarter: 30,
  year: 90,
};

/** A new bar from the clicked day, as long as the zoom suggests. */
export function newBarSpan(day: number, zoom: TimelineZoom): DaySpan {
  return { start: day, end: day + NEW_BAR_DAYS[zoom] - 1 };
}

/** A project's or section's dates as the server keeps them ("2026-10-13"). */
export function spanKeys(span: DaySpan): { start: string; end: string } {
  return { start: keyOfDay(span.start), end: keyOfDay(span.end) };
}

/**
 * How far the view scrolls on a frame while a drag is near an edge: nothing in
 * the middle, faster the closer the pointer gets (and past the edge).
 * `box` is the part of the scroller the canvas shows (right of the name
 * column, under the time header).
 */
export function autoScrollStep(
  pointer: { x: number; y: number },
  box: { left: number; right: number; top: number; bottom: number },
  zone = 48,
  max = 24,
): { dx: number; dy: number } {
  const speed = (gap: number) => {
    if (gap >= zone) return 0;
    const t = Math.min(1, (zone - gap) / zone);
    return Math.max(1, Math.round(t * t * max));
  };
  let dx = 0;
  let dy = 0;
  if (pointer.x - box.left < zone) dx = -speed(pointer.x - box.left);
  else if (box.right - pointer.x < zone) dx = speed(box.right - pointer.x);
  if (pointer.y - box.top < zone) dy = -speed(pointer.y - box.top);
  else if (box.bottom - pointer.y < zone) dy = speed(box.bottom - pointer.y);
  return { dx, dy };
}

/**
 * The zoom at which `span` fits the canvas with a little room (⇧T, fit the
 * selection): the current one when it already fits (fitting never zooms in),
 * else the first one out that does; Year when nothing does.
 */
export function fitZoom(span: DaySpan, trackWidth: number, current: TimelineZoom): TimelineZoom {
  const days = span.end - span.start + 1;
  for (const zoom of TIMELINE_ZOOMS.slice(TIMELINE_ZOOMS.indexOf(current))) {
    if ((days + 2) * DAY_WIDTH[zoom] <= trackWidth * 0.9) return zoom;
  }
  return "year";
}

// ── Moving tasks ─────────────────────────────────────────────────────────────

/** What a repeat does when its date moves (TV-D12's two ways, `RepeatMoveDialog`). */
export type RepeatChoice = "one" | "pattern";

export type TaskMovePlan = {
  writes: BulkWrite[];
  /** The toast's words once `n` of them changed. */
  label: (n: number) => string;
};

/** A local instant moved by whole days, its time of day kept (a session). */
export function shiftInstant(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Does moving this task's date touch a repeat's rule (and so ask first)? */
export function asksAboutRepeat(task: Task): boolean {
  return !!task.recurrence && dueKeyOf(task) !== null;
}

function repeatWrite(
  task: Task,
  day: string,
  rule: RecurrenceRule,
  choice: RepeatChoice,
  zone: string,
): BulkWrite {
  if (choice === "pattern") {
    const [y, m, d] = day.split("-").map(Number);
    const at = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
    return {
      taskId: task.id,
      recurrence: changePatternRule(rule, at, zone),
      dueDate: dueOnToLocalInstant(day),
    };
  }
  return { taskId: task.id, occurrenceOn: day };
}

/**
 * Move tasks' dates by `shift` days (a drag, ⌥←/→): a due date moves; a task
 * with only work sessions moves its session (its time kept); a repeat moves
 * just this occurrence, or its pattern. Tasks with no date stay.
 */
export function planShift(
  tasks: readonly Task[],
  shift: number,
  choice: RepeatChoice,
  zone: string,
  now: Date,
): TaskMovePlan {
  const writes: BulkWrite[] = [];
  const days = new Set<string>();
  if (shift !== 0) {
    for (const task of tasks) {
      const due = dueKeyOf(task);
      if (due) {
        const day = shiftDayKey(due, shift);
        days.add(day);
        writes.push(
          task.recurrence
            ? repeatWrite(task, day, task.recurrence, choice, zone)
            : { taskId: task.id, dueDate: dueOnToLocalInstant(day) },
        );
      } else if (task.scheduledAt) {
        const scheduledAt = shiftInstant(task.scheduledAt, shift);
        days.add(localDayOf(scheduledAt) ?? "");
        writes.push({ taskId: task.id, scheduledAt });
      }
    }
  }
  return {
    writes,
    label: (n) => {
      // One day for all of them: name it; else say how far.
      const [day] = days;
      if (days.size === 1 && day) {
        return n === 1
          ? `Moved to ${dayWordOf(day, now)}`
          : `Moved ${tasksWord(n)} to ${dayWordOf(day, now)}`;
      }
      const size = Math.abs(shift);
      const by = size === 1 ? "a day" : size === 7 ? "a week" : `${size} days`;
      return `Moved ${tasksWord(n)} ${by} ${shift < 0 ? "earlier" : "later"}`;
    },
  };
}

/**
 * Put a task on a day (a click on its row, a drop from No date, the picker):
 * its due date; a repeat's occurrence, or its pattern.
 */
export function planDay(
  task: Task,
  day: string,
  choice: RepeatChoice,
  zone: string,
  now: Date,
): TaskMovePlan {
  const label = () => `Due ${dayWordOf(day, now)}`;
  if (dueKeyOf(task) === day) return { writes: [], label };
  const write =
    task.recurrence && dueKeyOf(task)
      ? repeatWrite(task, day, task.recurrence, choice, zone)
      : { taskId: task.id, dueDate: dueOnToLocalInstant(day) };
  return { writes: [write], label };
}
