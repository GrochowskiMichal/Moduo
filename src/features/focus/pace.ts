// Your usual pace (Tasks v3 TV-F8, call 10; spec §7, AC8.10): after about ten
// finished tasks that had both an estimate and tracked time, Focus shows how
// long Up next would take at your own ratio of time spent to estimate
// ("≈ 7h 30m at your usual pace"). Personal (only tasks you finished), it
// never changes an estimate, and it can be turned off. Under Timer: Off it
// never shows (63: it needs recorded time). Pure, so the rule is tested alone.

import { formatDuration } from "../../lib/time-format";

/** The pace shows once this many finished tasks carry both an estimate and tracked time. */
export const PACE_MIN_TASKS = 10;

/** The newest finished tasks the ratio reads (old habits fade out). */
export const PACE_WINDOW = 30;

/** A task as the pace reads it. */
export type PaceTask = {
  status: string;
  completedBy?: string | null;
  completedAt?: string | null;
  updatedAt: string;
  timeSpentSeconds: number;
  estimate: number | null;
};

/**
 * My ratio of tracked time to estimate, over the newest finished tasks I
 * finished myself that had an estimate and at least a minute tracked; null
 * until there are ten. Clamped to a sane range, so one wild task can't swing
 * it beyond a fifth or five times.
 */
export function usualPace(tasks: readonly PaceTask[], me: string | null): number | null {
  if (!me) return null;
  const timed = tasks
    .filter(
      (t) =>
        t.status === "done" &&
        t.completedBy === me &&
        !!t.estimate &&
        t.estimate > 0 &&
        t.timeSpentSeconds >= 60,
    )
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .slice(0, PACE_WINDOW);
  if (timed.length < PACE_MIN_TASKS) return null;
  const spent = timed.reduce((sum, t) => sum + t.timeSpentSeconds, 0);
  const planned = timed.reduce((sum, t) => sum + (t.estimate ?? 0) * 60, 0);
  if (planned <= 0) return null;
  return Math.min(5, Math.max(0.2, spent / planned));
}

/**
 * "≈ 7h 30m at your usual pace" for `minutes` of estimates; null when there's
 * no ratio yet, nothing estimated, the setting is off, or the Timer is Off.
 */
export function paceText(input: {
  minutes: number;
  ratio: number | null;
  enabled: boolean;
  timed: boolean;
}): string | null {
  const { minutes, ratio } = input;
  if (!input.enabled || !input.timed || ratio === null || minutes <= 0) return null;
  const at = Math.max(5, Math.round((minutes * ratio) / 5) * 5);
  return `≈ ${formatDuration(at)} at your usual pace`;
}
