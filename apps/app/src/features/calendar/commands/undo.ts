// Calendar's undo (CALR-4, AC21): every edit records one step. Add, delete,
// move, resize and place also show the Undo toast; ⌘Z (`undoLast`) runs the
// newest step, and a step runs at most once, whichever of the two asks first.
// One stack for the open Calendar: the page clears it on a workspace switch
// and when it leaves (⌘Z then can't reach the old steps; a toast's own Undo
// still works until it closes).

import { toast } from "sonner";

import { undoToast } from "../../../lib/undo-toast";
import type { CalendarAttendeeInput, CalendarEventModel, CalendarEventPatch } from "../events";

type Step = {
  label: string;
  run: () => void | Promise<void>;
  toastId: string | number | null | undefined;
  done: boolean;
};

/** The steps ⌘Z can reach; older ones fall off. */
const LIMIT = 30;
const stack: Step[] = [];

const failed = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : "Couldn't undo that.");

function runStep(step: Step): boolean {
  if (step.done) return false;
  step.done = true;
  const i = stack.indexOf(step);
  if (i >= 0) stack.splice(i, 1);
  if (step.toastId != null) toast.dismiss(step.toastId);
  try {
    const result = step.run();
    if (result instanceof Promise) result.catch(failed);
  } catch (err) {
    failed(err);
  }
  return true;
}

/** Record one undo step; `toast` also shows the Undo toast for it. */
export function recordUndo(
  label: string,
  run: () => void | Promise<void>,
  opts: { toast?: boolean; description?: string } = {},
): void {
  const step: Step = { label, run, toastId: null, done: false };
  stack.push(step);
  if (stack.length > LIMIT) stack.shift();
  if (opts.toast) {
    step.toastId = undoToast(label, {
      description: opts.description || undefined,
      onUndo: () => void runStep(step),
    });
  }
}

/** ⌘Z: run the newest step. False when there's nothing to undo. */
export function undoLast(): boolean {
  const step = stack.at(-1);
  return step ? runStep(step) : false;
}

export function clearUndo(): void {
  stack.length = 0;
}

export function undoDepth(): number {
  return stack.length;
}

function attendeesOf(event: CalendarEventModel): CalendarAttendeeInput[] {
  return (event.attendees ?? []).map((a) => ({ email: a.email, name: a.name, status: a.status }));
}

type Back = (before: CalendarEventModel, patch: CalendarEventPatch) => unknown;

/** Per field, what it was before (an unset optional field reads as its default). */
const BACK: Record<keyof CalendarEventPatch, Back> = {
  title: (b) => b.title,
  description: (b) => b.description,
  startsAt: (b) => b.startsAt,
  endsAt: (b) => b.endsAt,
  allDay: (b) => b.allDay,
  rrule: (b) => b.rrule ?? null,
  calendarId: (b) => b.calendarRef ?? null,
  location: (b) => b.location ?? null,
  attendees: (b) => attendeesOf(b),
  conferenceUrl: (b) => b.conferenceUrl ?? null,
  conferenceProvider: (b) => b.conferenceProvider ?? null,
  isPrivate: (b) => b.isPrivate ?? false,
  kind: (b) => b.kind ?? "event",
  focusTaskId: (b) => b.focusTaskId ?? null,
  meet: (_b, p) => (p.meet === "add" ? "remove" : "add"),
};

/** The patch that puts back exactly the fields `patch` touched. */
export function inversePatch(
  before: CalendarEventModel,
  patch: CalendarEventPatch,
): CalendarEventPatch {
  const back: Record<string, unknown> = {};
  for (const field of Object.keys(patch) as (keyof CalendarEventPatch)[]) {
    if (patch[field] !== undefined) back[field] = BACK[field](before, patch);
  }
  return back as CalendarEventPatch;
}

/**
 * One edit's undo step: the old values written back by `write`; a move or a
 * resize also shows the toast (AC21), any other edit is a quiet ⌘Z step.
 */
export function recordEventUndo(
  before: CalendarEventModel,
  patch: CalendarEventPatch,
  write: (back: CalendarEventPatch) => void | Promise<void>,
): void {
  const back = inversePatch(before, patch);
  const moved = timeChangeLabel(before, patch);
  recordUndo(moved ?? "Event changed", () => write(back), {
    toast: moved !== null,
    description: before.title,
  });
}

/** The toast a time change speaks: same shift at both ends is a move, else a resize. */
export function timeChangeLabel(
  before: Pick<CalendarEventModel, "startsAt" | "endsAt">,
  patch: CalendarEventPatch,
): "Event moved" | "Event resized" | null {
  if (patch.startsAt === undefined && patch.endsAt === undefined) return null;
  const startShift =
    patch.startsAt === undefined ? 0 : Date.parse(patch.startsAt) - Date.parse(before.startsAt);
  const endShift =
    patch.endsAt === undefined ? 0 : Date.parse(patch.endsAt) - Date.parse(before.endsAt);
  if (startShift === 0 && endShift === 0) return null;
  return startShift === endShift ? "Event moved" : "Event resized";
}

/** A Moduo event deletes at once (Undo is its safety net); a Google one has no Undo and confirms. */
export function deleteNeedsConfirm(event: Pick<CalendarEventModel, "sourceAccountId">): boolean {
  return event.sourceAccountId !== null;
}

type TaskSchedule = { scheduledAt: string | null; durationMinutes: number | null };

/** Place a task on the grid (a drop, a block moved or resized, Schedule), with one Undo. */
export function placeTask(
  commands: { patchTask: (taskId: string, patch: TaskSchedule) => void },
  task: { id: string; scheduledAt?: string | null; durationMinutes?: number | null },
  next: TaskSchedule,
  label = "Task placed",
  description?: string,
): void {
  const before: TaskSchedule = {
    scheduledAt: task.scheduledAt ?? null,
    durationMinutes: task.durationMinutes ?? null,
  };
  commands.patchTask(task.id, next);
  recordUndo(label, () => commands.patchTask(task.id, before), { toast: true, description });
}
