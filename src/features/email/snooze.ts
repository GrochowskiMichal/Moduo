// Snooze scheduling (EM-6, AC6). Pure wall-clock helpers: the preset menu
// ("Later today / Tomorrow / This weekend / Next week") resolves each choice to a
// concrete local instant, and small label/selection helpers the picker + rail use.
// No I/O — the cloud state (email_op_snooze) + the IMAP move (email_snooze_thread)
// are driven by the hook; this module only computes WHEN.

/** A resolved snooze choice: a stable id, a human label, and the target instant. */
export type SnoozePreset = {
  id: "later_today" | "tomorrow" | "this_weekend" | "next_week";
  label: string;
  /** Local instant the thread returns to the inbox. */
  at: Date;
};

/** The default morning hour a "tomorrow / weekend / next week" snooze lands on. */
export const SNOOZE_MORNING_HOUR = 9;
/** How far "Later today" pushes a thread. */
export const SNOOZE_LATER_TODAY_HOURS = 3;

function atLocalHour(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Days until the upcoming Saturday (0 = today is already Saturday). */
function daysUntilSaturday(base: Date): number {
  // getDay(): 0 = Sun … 6 = Sat.
  return (6 - base.getDay() + 7) % 7;
}

/** Days until the upcoming Monday (0 = today is already Monday). */
function daysUntilMonday(base: Date): number {
  return (1 - base.getDay() + 7) % 7;
}

/**
 * The preset menu, resolved against `now`. Every choice lands strictly in the
 * future: "Later today" is now + N hours; "This weekend" / "Next week" skip to the
 * *next* Saturday / Monday morning when today already is one (so snoozing on a
 * Saturday goes to next Saturday, never a past instant).
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const laterToday = new Date(now.getTime() + SNOOZE_LATER_TODAY_HOURS * 3600_000);

  const satOffset = daysUntilSaturday(now) === 0 ? 7 : daysUntilSaturday(now);
  const monOffset = daysUntilMonday(now) === 0 ? 7 : daysUntilMonday(now);

  return [
    { id: "later_today", label: "Later today", at: laterToday },
    { id: "tomorrow", label: "Tomorrow", at: atLocalHour(now, 1, SNOOZE_MORNING_HOUR) },
    {
      id: "this_weekend",
      label: "This weekend",
      at: atLocalHour(now, satOffset, SNOOZE_MORNING_HOUR),
    },
    { id: "next_week", label: "Next week", at: atLocalHour(now, monOffset, SNOOZE_MORNING_HOUR) },
  ];
}

/** Clamp a custom datetime to strictly-future; returns null when it isn't. */
export function normalizeSnoozeAt(at: Date, now: Date): Date | null {
  if (!Number.isFinite(at.getTime())) return null;
  if (at.getTime() <= now.getTime()) return null;
  return at;
}

/**
 * A short "returns <when>" label. Same-day → time only; within a week → weekday +
 * time; else a compact date + time. Wall-clock, locale-formatted.
 */
export function formatSnoozeUntil(atIso: string, now: Date): string {
  const at = new Date(atIso);
  if (!Number.isFinite(at.getTime())) return "";
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return time;
  const days = Math.round((atLocalMidnight(at) - atLocalMidnight(now)) / 86_400_000);
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) {
    return `${at.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  }
  return `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

function atLocalMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
