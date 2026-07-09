// DB-7 — pure habit logic (streaks, checks, ordering). No React/runtime, so it's
// unit-testable; the widget + runtime handle IO. Checks are local-date strings
// ('YYYY-MM-DD') so "today" is calendar-local, never UTC-shifted.

import type { HabitRow } from "@/lib/runtime.types";

/** A small preset of habit emojis so new habits get distinct glyphs without an
 * emoji picker (DB-8 adds real emoji editing). */
export const HABIT_EMOJIS = ["🎯", "🏃", "📚", "🧘", "💧", "🌱", "💪", "✍️"] as const;

export function nextHabitEmoji(count: number): string {
  return HABIT_EMOJIS[count % HABIT_EMOJIS.length];
}

/** Shift a 'YYYY-MM-DD' key by `delta` days (local, DST-safe — date-only math). */
export function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function isChecked(checks: readonly string[], dateKey: string): boolean {
  return checks.includes(dateKey);
}

/** Toggle a date in a checks array; returns a new de-duped, sorted array. */
export function toggleCheck(checks: readonly string[], dateKey: string): string[] {
  const set = new Set(checks);
  if (set.has(dateKey)) set.delete(dateKey);
  else set.add(dateKey);
  return [...set].sort();
}

/**
 * Consecutive-day streak counting back from `today`. If today is checked the run
 * includes it; if not, the run counts back from yesterday (an as-yet-unchecked
 * today doesn't zero an active streak). Returns 0 when neither is checked.
 */
export function computeStreak(checks: readonly string[], today: string): number {
  const set = new Set(checks);
  let cursor = today;
  if (!set.has(cursor)) {
    cursor = addDays(today, -1);
    if (!set.has(cursor)) return 0;
  }
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** The last `n` date keys ending at `today`, oldest→newest (for a mini week grid). */
export function recentDays(today: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

/** Sort habits by their fractional `position`, then creation as a tiebreak. */
export function sortHabits(habits: readonly HabitRow[]): HabitRow[] {
  return [...habits].sort(
    (a, b) => a.position.localeCompare(b.position) || a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * The end `position` for a new habit appended after the current set — always
 * `a<maxSuffix+1>`, so it's collision-free even after removals (a count-based
 * key would reuse a freed suffix). Legacy/empty positions count as -1.
 */
export function nextPosition(habits: readonly HabitRow[]): string {
  let maxN = -1;
  for (const habit of habits) {
    const match = /^a(\d+)$/.exec(habit.position);
    if (match) maxN = Math.max(maxN, Number(match[1]));
  }
  return `a${String(maxN + 1).padStart(4, "0")}`;
}
