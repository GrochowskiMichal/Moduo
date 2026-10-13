// A date chip in prose (call 33a): `/today`, `/tomorrow`, `/next week` and
// `/date` insert one. It reads "Today" or "Tomorrow" while that's true and the
// plain date afterwards ("Oct 17"); hovering shows the full date. Stored as
// the day only (`YYYY-MM-DD`), so it never shifts with time zones.

import { CalendarDays } from "lucide-react";

import { chipClasses } from "../../../../components/ui/chip";
import { dayOffset, formatDate, formatWeekdayDate } from "../../../../lib/time-format";
import { cn } from "../../../../lib/utils";

/** The words a date chip reads today: "Today", "Tomorrow", else the date. */
export function dateChipLabel(day: string, now: Date = new Date()): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  const offset = dayOffset(date, now);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return formatDate(date, now);
}

/** The full date for the hover: "Sat, Oct 17, 2026" / "Sat, 17 Oct 2026"
 *  (Time & region's date order, TV-D14). */
export function dateChipTitle(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return formatWeekdayDate(date, undefined, { year: true });
}

export function DateChip({ day, className }: { day: string; className?: string }) {
  return (
    <span
      data-slot="date-chip"
      title={dateChipTitle(day)}
      className={cn(chipClasses({ size: "xs" }), "mx-px align-baseline tabular-nums", className)}
    >
      <CalendarDays aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
      <time dateTime={day}>{dateChipLabel(day)}</time>
    </span>
  );
}
