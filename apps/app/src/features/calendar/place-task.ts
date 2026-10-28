// Placing a task from Plan (CALR-5, AC20): S lifts the selected task to the
// next free slot that fits its estimate, the keys adjust it, ↵ or a click in a
// free slot places it. Pure, so the hook that draws and binds it stays thin.
// Nothing else on the grid moves: busy time is read, never changed.

import { focusMinutes } from "./focus-item";
import type { BusyInterval } from "./gap-finder";
import { DEFAULT_BLOCK_MINUTES, startOfLocalDay } from "./lens";

/** A lifted task: where it would land, and for how long. */
export type Placement = {
  taskId: string;
  startMs: number;
  durationMinutes: number;
  /** CALR-14: F turns the lift into focus time holding the task. */
  kind?: "task" | "focus";
};

export type PlacementNudge = "earlier" | "later" | "prev-day" | "next-day";

const MIN = 60_000;
const NUDGE_MINUTES = 15;

/** The estimate, or the default block when it has none. */
export function placementMinutes(task: { durationMinutes: number | null | undefined }): number {
  const d = task.durationMinutes;
  return d && d > 0 ? d : DEFAULT_BLOCK_MINUTES;
}

/** F while lifted: task block ⇄ focus time holding it, where it sits. */
export function togglePlacementKind(
  p: Placement,
  task: { durationMinutes: number | null | undefined },
): Placement {
  return p.kind === "focus"
    ? { ...p, kind: "task", durationMinutes: placementMinutes(task) }
    : { ...p, kind: "focus", durationMinutes: focusMinutes(task) };
}

function nextMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** ↑↓ 15 minutes inside the day; ←→ a day at the same wall-clock time. */
export function nudgePlacement(p: Placement, how: PlacementNudge): Placement {
  if (how === "prev-day" || how === "next-day") {
    const d = new Date(p.startMs);
    d.setDate(d.getDate() + (how === "next-day" ? 1 : -1));
    return { ...p, startMs: d.getTime() };
  }
  const dayStart = startOfLocalDay(new Date(p.startMs)).getTime();
  const latest = nextMidnight(p.startMs) - p.durationMinutes * MIN;
  const moved = p.startMs + (how === "later" ? NUDGE_MINUTES : -NUDGE_MINUTES) * MIN;
  return { ...p, startMs: Math.max(dayStart, Math.min(moved, Math.max(latest, dayStart))) };
}

/** A click at `pointerMs` in a free slot: the start, snapped to 15 minutes, kept inside the slot. */
export function slotAtPointer(
  slot: BusyInterval,
  pointerMs: number,
  durationMinutes: number,
): number {
  const step = NUDGE_MINUTES * MIN;
  const dayStart = startOfLocalDay(new Date(slot.startMs)).getTime();
  const snapped = dayStart + Math.floor((pointerMs - dayStart) / step) * step;
  const latest = slot.endMs - durationMinutes * MIN;
  return Math.max(slot.startMs, Math.min(snapped, latest));
}

/**
 * Where S starts looking: now, or the first day of the week shown when that is
 * later; a task due before the week shown (but not before today) starts on its
 * due day instead. Never in the past.
 */
export function liftSearchFrom(input: {
  nowMs: number;
  visibleDays: readonly Date[];
  dueDate: string | null;
}): number {
  const first = input.visibleDays[0];
  const visibleStart = first ? startOfLocalDay(first).getTime() : input.nowMs;
  const from = Math.max(input.nowMs, visibleStart);
  if (!input.dueDate) return from;
  const due = new Date(input.dueDate);
  if (Number.isNaN(due.getTime())) return from;
  const dueDay = startOfLocalDay(due).getTime();
  const today = startOfLocalDay(new Date(input.nowMs)).getTime();
  if (dueDay >= today && dueDay < visibleStart) return Math.max(input.nowMs, dueDay);
  return from;
}

/** The grid's busy time for placing `taskId`: timed events and other tasks' blocks. */
export function placementBusy(
  eventsByDay: ReadonlyMap<string, readonly BusyInterval[]>,
  blocksByDay: ReadonlyMap<string, readonly (BusyInterval & { taskId: string })[]>,
  taskId: string,
): BusyInterval[] {
  const busy: BusyInterval[] = [];
  for (const list of eventsByDay.values()) {
    for (const e of list) busy.push({ startMs: e.startMs, endMs: e.endMs });
  }
  for (const list of blocksByDay.values()) {
    for (const b of list) {
      if (b.taskId !== taskId) busy.push({ startMs: b.startMs, endMs: b.endMs });
    }
  }
  return busy;
}
