// Contacts — birthday / recurring-date countdown (block FX-4, AC7). A quiet,
// derived caption ("in 3 weeks") on a date row, shown only when the date's next
// yearly occurrence is within 60 days. PURE: no I/O, no React — unit-tested in
// dates.test.ts. The stored value is a plain YYYY-MM-DD; only month+day matter
// (the year is the birth year, not the next occurrence).

const DAY_MS = 86_400_000;

/** How far ahead a countdown is shown (days). Beyond this the caption is null. */
export const COUNTDOWN_HORIZON_DAYS = 60;

/**
 * A short "in N days/weeks" caption for the next yearly occurrence of `value`
 * (a YYYY-MM-DD date), relative to `now` in local time. Returns null when the
 * value is unparseable or the next occurrence is more than 60 days out. Handles
 * the year wrap (a date already past this year counts to next year's).
 */
export function birthdayCountdown(value: string, now: Date): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Compare at local midnight so "today" is calendar-accurate (no time-of-day drift).
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Clamp to the month's last day so a Feb-29 birthday shows Feb 28 in a non-leap
  // year (not roll over to Mar 1, which JS Date would do for day 29).
  const occurrence = (year: number) => {
    const lastDay = new Date(year, month, 0).getDate();
    return new Date(year, month - 1, Math.min(day, lastDay));
  };
  let next = occurrence(now.getFullYear());
  if (next.getTime() < today.getTime()) next = occurrence(now.getFullYear() + 1);

  const days = Math.round((next.getTime() - today.getTime()) / DAY_MS);
  if (days < 0 || days > COUNTDOWN_HORIZON_DAYS) return null;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  return `in ${weeks} weeks`;
}
