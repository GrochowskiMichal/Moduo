// Time formatters for the grid chrome. They read the app's one date grammar
// (`lib/time-format.ts`), so the clock and the date order follow Settings →
// Time & region (TV-D14). Hour labels are memoized over their 24-value domain
// per clock, since the grid asks for them every render.

import { formatHour, formatTime, formatWeekdayDate } from "../../../lib/time-format";
import { getResolvedTimeRegion } from "../../../lib/time-region";

const hourLabelCache = new Map<string, string>();

/** "9 AM" / "09" — the hour-gutter label. */
export function formatHourLabel(hour: number): string {
  const key = `${getResolvedTimeRegion().hour12}|${hour}`;
  const cached = hourLabelCache.get(key);
  if (cached !== undefined) return cached;
  const label = formatHour(hour);
  hourLabelCache.set(key, label);
  return label;
}

/** "9:00 AM" — chip time readouts, from a real instant. */
export function formatTimeOfDay(ms: number): string {
  return formatTime(ms);
}

/** "Thu, Jul 2" — the chip popovers' day line. */
export function formatDayLabel(ms: number): string {
  return formatWeekdayDate(ms);
}
