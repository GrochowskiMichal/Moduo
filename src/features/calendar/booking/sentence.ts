// Pure time helpers for the public booking sentence. Every slot is an ISO
// instant; every grouping is done in the guest's chosen timezone.

export type DayPart = "morning" | "afternoon" | "evening";

const keyFormats = new Map<string, Intl.DateTimeFormat>();
const hourFormats = new Map<string, Intl.DateTimeFormat>();

function cached(
  map: Map<string, Intl.DateTimeFormat>,
  zone: string,
  make: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  let fmt = map.get(zone);
  if (!fmt) {
    fmt = make();
    map.set(zone, fmt);
  }
  return fmt;
}

/** `YYYY-MM-DD` of an instant in a timezone. */
export function zoneKey(date: Date, timeZone: string): string {
  const fmt = cached(
    keyFormats,
    timeZone,
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
  );
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Hour of day (0–24, fractional) of an instant in a timezone. */
export function zoneHour(date: Date, timeZone: string): number {
  const fmt = cached(
    hourFormats,
    timeZone,
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
  );
  let hour = 0;
  let minute = 0;
  for (const part of fmt.formatToParts(date)) {
    if (part.type === "hour") hour = Number(part.value);
    if (part.type === "minute") minute = Number(part.value);
  }
  return hour + minute / 60;
}

export function dayPart(slot: string, timeZone: string): DayPart {
  const hour = zoneHour(new Date(slot), timeZone);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** Slots grouped by day in the guest's zone, days and slots in time order. */
export function groupByDay(slots: string[], timeZone: string): Map<string, string[]> {
  const sorted = [...slots].sort();
  const map = new Map<string, string[]>();
  for (const slot of sorted) {
    const key = zoneKey(new Date(slot), timeZone);
    const list = map.get(key);
    if (list) list.push(slot);
    else map.set(key, [slot]);
  }
  return map;
}

export function groupByPart(
  slots: string[],
  timeZone: string,
): Array<{ part: DayPart; slots: string[] }> {
  const order: DayPart[] = ["morning", "afternoon", "evening"];
  const groups = new Map<DayPart, string[]>();
  for (const slot of slots) {
    const part = dayPart(slot, timeZone);
    const list = groups.get(part);
    if (list) list.push(slot);
    else groups.set(part, [slot]);
  }
  return order.flatMap((part) => {
    const list = groups.get(part);
    return list ? [{ part, slots: list }] : [];
  });
}

/**
 * Up to three suggested times: the soonest, then the soonest on another day
 * at another part of the day, then the same again on a third day. Falls back
 * to any other day when the parts of the day can't differ.
 */
export function quickPicks(slots: string[], timeZone: string): string[] {
  const sorted = [...slots].sort();
  const first = sorted[0];
  if (!first) return [];
  const picks = [first];
  const usedDays = new Set([zoneKey(new Date(first), timeZone)]);
  while (picks.length < 3) {
    const lastPart = dayPart(picks[picks.length - 1], timeZone);
    const freshDay = (slot: string) => !usedDays.has(zoneKey(new Date(slot), timeZone));
    const next =
      sorted.find((slot) => freshDay(slot) && dayPart(slot, timeZone) !== lastPart) ??
      sorted.find(freshDay);
    if (!next) break;
    picks.push(next);
    usedDays.add(zoneKey(new Date(next), timeZone));
  }
  return picks;
}

/** Whole days from one `YYYY-MM-DD` key to another. */
export function daysBetween(fromKey: string, toKey: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toKey) - toUtc(fromKey)) / 86_400_000);
}

export function durationPhrase(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/** The city part of an IANA zone, for "Warsaw time". */
export function zonePlace(zone: string): string {
  if (zone === "UTC") return "UTC";
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}
