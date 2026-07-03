// Triage semantics (CAL-4, AC8) — the pure rules behind the elapsed block's
// four actions. Done and Later-today are covered elsewhere (Done = the shipped
// set_status via the checkbox; Later-today = the gap-finder). This file pins
// the two that carry the most nuance:
//
//  • Took longer — the block's PLANNED span folds into the task's tracked time
//    (`+90m logged`), the task stays OPEN, and NO remainder object is created.
//    The lens model has no separate block row to split, so "took longer" is
//    purely additive time — never a status change, never a new task.
//  • Remove — clears the schedule and nothing else; the task survives untouched.

import { DEFAULT_BLOCK_MINUTES } from "./lens";

/** The block's planned span, as the delta seconds to accrue for "Took longer". */
export function tookLongerDeltaSeconds(
  block: { durationMinutes?: number | null },
): number {
  const minutes =
    block.durationMinutes && block.durationMinutes > 0
      ? block.durationMinutes
      : DEFAULT_BLOCK_MINUTES;
  return Math.max(0, Math.round(minutes)) * 60;
}

/** The task's new tracked total after "Took longer" (open, no remainder). */
export function tookLongerTotalSeconds(
  currentSeconds: number,
  block: { durationMinutes?: number | null },
): number {
  return Math.max(0, Math.round(currentSeconds)) + tookLongerDeltaSeconds(block);
}

/** "Remove" clears the schedule and nothing else. */
export function removePatch(): { scheduledAt: null } {
  return { scheduledAt: null };
}
