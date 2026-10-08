// Words for "while you were away" (spec §5): "You were away 42m — Keep · Discard
// · Count as break", plus what happened to the pomodoro meanwhile ("Your 25-min
// focus ended at 14:25").

import type { FocusAwaySummary, FocusPhaseEnd } from "./engine-core";

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "42m" · "1h 5m" — away spans are always over 90 s, so never under a minute. */
export function formatAwaySpan(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function phaseName(end: FocusPhaseEnd): string {
  if (end.phase === "work") return "focus";
  return end.longBreak ? "long break" : "break";
}

/** "Your 25-min focus ended at 2:25 PM." */
export function describePhaseEnd(end: FocusPhaseEnd): string {
  const minutes = Math.max(1, Math.round(end.lengthMs / 60_000));
  return `Your ${minutes}-min ${phaseName(end)} ended at ${TIME_FMT.format(end.at)}.`;
}

export interface AwayPromptCopy {
  /** "You were away 42m." */
  headline: string;
  /** What the pomodoro did meanwhile, or null. */
  detail: string | null;
  /** There's work time to keep; without it Keep and Discard are the same, so
   *  the prompt offers Dismiss instead. */
  hasHeld: boolean;
  /** "Keep", or "Keep 15m" when less than the whole gap would be kept. */
  keepLabel: string;
}

export function awayPromptCopy(away: FocusAwaySummary): AwayPromptCopy {
  const span = formatAwaySpan(away.awaySeconds);
  const first = away.endedPhases[0];
  const hasHeld = away.heldSeconds >= 1;
  const held = formatAwaySpan(away.heldSeconds);
  return {
    headline: `You were away ${span}.`,
    detail: first ? describePhaseEnd(first) : null,
    hasHeld,
    keepLabel: hasHeld && held !== span ? `Keep ${held}` : "Keep",
  };
}
