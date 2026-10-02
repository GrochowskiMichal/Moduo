// Focus-timer helpers (CAL-5, AC10). The block itself is the timer surface: a
// live stopwatch whose real seconds accrue to the task's tracked total via the
// existing accumulation path (use-block-focus.ts owns the effectful single-
// session machinery). This file is the pure part — clock formatting, the
// "Xm logged" summary, and the "is this block focus-able yet" predicate.

/** Start-focus offered on current-ish blocks: elapsed or starting within this. */
export const FOCUS_LEAD_MINUTES = 60;

/** "MM:SS" (or "H:MM:SS" past an hour) — the block's live elapsed readout. */
export function formatFocusClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    return `${h}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** The stop toast: "47m logged to write offer" (never guilt, just a fact). */
export function loggedMessage(totalSeconds: number, title: string): string {
  const name = title.trim() || "this task";
  const secs = Math.max(0, totalSeconds);
  if (secs < 60) return `Less than a minute logged to ${name}`;
  return `${Math.round(secs / 60)}m logged to ${name}`;
}

/**
 * Whether "Start focus" is offered on a block: only for current-ish work —
 * already elapsed/started, or starting within the next hour. Never for done
 * blocks or far-future ones (focusing a block hours ahead is a mis-click).
 */
export function canFocusBlock(block: { startMs: number; done: boolean }, nowMs: number): boolean {
  if (block.done) return false;
  return block.startMs <= nowMs + FOCUS_LEAD_MINUTES * 60_000;
}
