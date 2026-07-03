// Roll-forward (CAL-4, AC9) — the strip's "Move to today". Place every queued
// item into today's remaining gaps, in original order, each getting the next
// fitting slot (the same gap-finder as "Later today"). Items that don't fit
// stay behind. The whole thing is a pure plan: the caller applies the
// placements through the attributed reschedule op, and one Undo replays the
// inverse plan to restore every original time.

import { findNextGap, type BusyInterval } from "./gap-finder";
import type { StripItem } from "./strip";

export type Placement = {
  taskId: string;
  /** Original scheduled instant — where Undo puts it back. */
  fromMs: number;
  /** The gap it was placed into. */
  toMs: number;
  durationMinutes: number;
};

export type RollForwardPlan = {
  placements: Placement[];
  /** Ids that found no gap — they remain where they were (still in the strip). */
  notPlaced: string[];
};

export type RollContext = {
  nowMs: number;
  dayStartMs: number;
  workStartMinute: number;
  workEndMinute: number;
  /** Today's events + task blocks (the gap-finder skips these). */
  busy: BusyInterval[];
  stepMinutes?: number;
};

/**
 * Plan the placements. Each placed item reserves its new slot so the next item
 * in the queue avoids it — first-fit, original order preserved.
 */
export function planRollForward(
  items: StripItem[],
  ctx: RollContext,
): RollForwardPlan {
  const busy: BusyInterval[] = ctx.busy.slice();
  const placements: Placement[] = [];
  const notPlaced: string[] = [];
  for (const item of items) {
    const gap = findNextGap({
      nowMs: ctx.nowMs,
      dayStartMs: ctx.dayStartMs,
      workStartMinute: ctx.workStartMinute,
      workEndMinute: ctx.workEndMinute,
      durationMinutes: item.durationMinutes,
      busy,
      stepMinutes: ctx.stepMinutes,
    });
    if (gap == null) {
      notPlaced.push(item.taskId);
      continue;
    }
    placements.push({
      taskId: item.taskId,
      fromMs: item.scheduledAtMs,
      toMs: gap,
      durationMinutes: item.durationMinutes,
    });
    busy.push({ startMs: gap, endMs: gap + item.durationMinutes * 60_000 });
  }
  return { placements, notPlaced };
}

/** The inverse plan — restore every placed task to its original time (Undo). */
export function undoRollForward(
  placements: Placement[],
): { taskId: string; toMs: number }[] {
  return placements.map((p) => ({ taskId: p.taskId, toMs: p.fromMs }));
}

/** "Moved 3 to today" / "2 moved · 1 didn't fit" — the honest result copy. */
export function rollForwardMessage(plan: RollForwardPlan): string {
  const moved = plan.placements.length;
  const missed = plan.notPlaced.length;
  if (moved === 0) return "No room left today.";
  if (missed === 0) return `Moved ${moved} to today`;
  return `${moved} moved · ${missed} didn't fit`;
}
