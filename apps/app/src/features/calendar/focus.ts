// Focus on a Calendar block (CAL-5, AC10). The block's ▶ is "Focus on this"
// on the one time engine (TV-F6, features/focus/timer.ts): the same clock as
// Focus and the top-bar timer, read by `FocusReadout`, saved from any page.
// This file keeps the one Calendar rule: which blocks offer it.

/** Start-focus offered on current-ish blocks: elapsed or starting within this. */
export const FOCUS_LEAD_MINUTES = 60;

/**
 * Whether "Start focus" is offered on a block: only for current-ish work —
 * already elapsed/started, or starting within the next hour. Never for done
 * blocks or far-future ones (focusing a block hours ahead is a mis-click).
 */
export function canFocusBlock(block: { startMs: number; done: boolean }, nowMs: number): boolean {
  if (block.done) return false;
  return block.startMs <= nowMs + FOCUS_LEAD_MINUTES * 60_000;
}
