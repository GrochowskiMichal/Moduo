// The Timeline's words (TV-TL1, REPLAN 68a): one word per kind of date —
// tasks are *due*, sections *end* (or run from–to), projects have a *target*
// — and a hover always spells the date out. Dates read through the app's one
// grammar (time-format.ts, Time & region's day/month order).

import { formatDate, formatWeekdayDate } from "../../lib/time-format";
import { getResolvedTimeRegion } from "../../lib/time-region";
import type { TimelinePoint } from "./timeline-rows";
import { dateOfDay } from "./timeline-scale";

/** "Oct 13–24", "Oct 30 – Nov 4", "13–24 Oct" (the person's date order). */
export function spanWords(start: number, end: number, now: Date = new Date()): string {
  const a = dateOfDay(start);
  const b = dateOfDay(end);
  if (start === end) return formatDate(a, now);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return getResolvedTimeRegion().dateOrder === "day_month"
      ? `${a.getDate()}–${formatDate(b, now)}`
      : `${formatDate(a, now)}–${b.getDate()}`;
  }
  // One year, said once, at the end: "Jan 11 – Feb 14, 2027".
  const first = a.getFullYear() === b.getFullYear() ? formatDate(a, a) : formatDate(a, now);
  return `${first} – ${formatDate(b, now)}`;
}

/** A section's dates after its name: "Oct 13–24", or "by Nov 7" for an end date only. */
export function sectionDateWords(
  band: { start: number; end: number } | null,
  milestone: number | null,
  now: Date = new Date(),
): string | null {
  if (band) return spanWords(band.start, band.end, now);
  if (milestone !== null) return `by ${formatDate(dateOfDay(milestone), now)}`;
  return null;
}

/** What hovering a section's diamond says: "Build ends Nov 7". */
export function milestoneWords(name: string, day: number, now: Date = new Date()): string {
  return `${name || "Untitled section"} ends ${formatDate(dateOfDay(day), now)}`;
}

/** What hovering a task's point says: "Due Wed, Oct 14 · late", "Next session Thu, Oct 15". */
export function pointWords(point: TimelinePoint, now: Date = new Date()): string {
  const day = formatWeekdayDate(dateOfDay(point.day), now);
  const what = point.kind === "due" ? `Due ${day}` : `Next session ${day}`;
  const tail = point.closed ? " · done" : point.late ? " · late" : "";
  return `${what}${tail}${point.repeat ? " · repeats" : ""}`;
}

/** What hovering a project's bar says: "Oct 1 – Nov 7 · 5 of 12 done". */
export function barWords(
  bar: { start: number; end: number; solid: boolean },
  progress: { done: number; total: number },
  now: Date = new Date(),
): string {
  const parts = [spanWords(bar.start, bar.end, now)];
  if (!bar.solid) parts.push("worked out from its work");
  if (progress.total > 0) parts.push(`${progress.done} of ${progress.total} done`);
  return parts.join(" · ");
}
