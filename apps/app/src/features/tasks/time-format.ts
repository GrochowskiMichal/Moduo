// How a task's time reads in the detail panel's Time row (tasks-v2 §5, §9):
// "1h 20m of ~4h", a hairline bar, and "you 50m" for your share. Estimates are
// whole minutes (`durationMinutes`); tracked time is seconds. Pure. The
// grammar itself is src/lib/time-format.ts (decision 41).

import { formatDuration, formatDurationSeconds } from "../../lib/time-format";

/** "0m" · "45m" · "1h" · "1h 20m", from seconds (rounded to the minute). */
export function formatTracked(seconds: number): string {
  return formatDurationSeconds(Math.max(0, seconds));
}

/** "45m" · "4h" · "1h 30m", from whole minutes (the one grammar). */
export function formatMinutes(minutes: number): string {
  return formatDuration(minutes);
}

/**
 * Minutes from what someone typed: "90", "45m", "1h", "1.5h", "1h 30m",
 * "1:30". Null for anything else, an empty field included.
 */
export function parseMinutes(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/^~/, "");
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const clock = /^(\d+):([0-5]\d)$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const units = /^(?:(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(
    s,
  );
  if (!units || (units[1] === undefined && units[2] === undefined)) return null;
  const hours = units[1] ? Number(units[1].replace(",", ".")) : 0;
  const mins = units[2] ? Number(units[2]) : 0;
  return Math.round(hours * 60 + mins);
}

export type TimeRow = {
  /** The tracked total, "1h 20m". */
  tracked: string;
  /** "of ~4h", or null without an estimate. */
  estimate: string | null;
  /** How full the hairline bar is (0–1), or null without an estimate. */
  progress: number | null;
  /** "you 50m" when your share is part of the total, else null. */
  mine: string | null;
};

/**
 * The Time row's parts. Your share shows only when it's a real share: some of
 * the time is yours and some is a teammate's. When it's all yours, "you 1h 20m"
 * would only repeat the total.
 */
export function timeRow(
  totalSeconds: number,
  estimateMinutes: number | null,
  mySeconds: number | null,
): TimeRow {
  const total = Math.max(0, totalSeconds);
  const estimate = estimateMinutes && estimateMinutes > 0 ? estimateMinutes : null;
  const mineRounded = mySeconds != null ? Math.round(mySeconds / 60) : 0;
  const totalRounded = Math.round(total / 60);
  return {
    tracked: formatTracked(total),
    estimate: estimate ? `of ~${formatMinutes(estimate)}` : null,
    progress: estimate ? Math.min(1, total / (estimate * 60)) : null,
    mine:
      mySeconds != null && mineRounded > 0 && mineRounded < totalRounded
        ? `you ${formatTracked(mySeconds)}`
        : null,
  };
}
