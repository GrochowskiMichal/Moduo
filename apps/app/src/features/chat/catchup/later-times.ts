// Later's times (specs/chat-v2.md #33): in 1 hour · this evening (18:00 in
// your zone) · tomorrow (9:00) · pick a time. "This evening" and "tomorrow"
// are in the person's zone (Time & region), never the device's or the
// server's; what goes to the server is an instant.

export type LaterChoiceId = "hour" | "evening" | "tomorrow";

export type LaterChoice = {
  id: LaterChoiceId;
  label: string;
  at: Date;
};

/** One year: the server refuses anything later. */
export const LATER_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

type Wall = { y: number; mo: number; d: number; h: number; mi: number };

/** The wall clock in a zone at an instant. */
export function wallIn(at: Date, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour") % 24, mi: n("minute") };
}

/** The instant a wall-clock time happens in a zone (the later one across a DST fold). */
export function instantOf(wall: Wall, zone: string): Date {
  const asUtc = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi);
  let guess = asUtc;
  // Two passes settle the zone's offset (one more covers a DST edge).
  for (let i = 0; i < 3; i += 1) {
    const seen = wallIn(new Date(guess), zone);
    const seenUtc = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi);
    const diff = asUtc - seenUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function addDays(wall: Wall, days: number): Wall {
  const t = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d + days));
  return { ...wall, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Later's three quick times from `now`, in `zone`. "This evening" only before 18:00. */
export function laterChoices(now: Date, zone: string): LaterChoice[] {
  const today = wallIn(now, zone);
  const out: LaterChoice[] = [
    { id: "hour", label: "In 1 hour", at: new Date(now.getTime() + 60 * 60 * 1000) },
  ];
  const evening = instantOf({ ...today, h: 18, mi: 0 }, zone);
  if (evening.getTime() > now.getTime()) {
    out.push({ id: "evening", label: "This evening", at: evening });
  }
  out.push({
    id: "tomorrow",
    label: "Tomorrow",
    at: instantOf({ ...addDays(today, 1), h: 9, mi: 0 }, zone),
  });
  return out;
}

/** A `datetime-local` value ("2026-10-17T14:30") read as a time in `zone`; null when unusable. */
export function pickedInstant(value: string, zone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return instantOf({ y, mo, d, h, mi }, zone);
}

/** The `datetime-local` value for an instant in `zone` (the picker's start and bounds). */
export function localValue(at: Date, zone: string): string {
  const w = wallIn(at, zone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** Why a picked time can't be used, or null. */
export function laterRefusal(at: Date | null, now: Date): string | null {
  if (!at) return "Pick a date and a time.";
  if (at.getTime() <= now.getTime()) return "Pick a time in the future.";
  if (at.getTime() > now.getTime() + LATER_HORIZON_MS) return "Pick a time within a year.";
  return null;
}

/** How a time reads next to its choice ("6:00 PM", "Sat 9:00 AM"), in `zone`. */
export function laterHint(at: Date, now: Date, zone: string, hour12: boolean): string {
  const sameDay =
    wallIn(at, zone).d === wallIn(now, zone).d &&
    at.getTime() - now.getTime() < 24 * 60 * 60 * 1000;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12,
    ...(sameDay ? {} : { weekday: "short" }),
  }).format(at);
}
