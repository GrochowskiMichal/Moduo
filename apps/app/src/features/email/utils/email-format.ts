import { formatFullDate, formatTime } from "../../../lib/time-format";

export function formatEmailDate(raw: string) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const day = String(parsed.getDate());
  const month = parsed.toLocaleString("en-US", { month: "short" }).replace(".", "");
  const currentYear = new Date().getFullYear();
  if (parsed.getFullYear() === currentYear) {
    return `${day}${month}`;
  }
  const year2 = String(parsed.getFullYear()).slice(-2);
  return `${day}${month}${year2}`;
}

/** "Oct 13, 2026, 3:04 PM": the date order and the clock follow Settings →
 *  Time & region (TV-D14; it was always 24-hour, day first). */
export function formatEmailDetailDate(raw: string) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${formatFullDate(parsed)}, ${formatTime(parsed)}`;
}
