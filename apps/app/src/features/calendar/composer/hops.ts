// Free time for the composer (CALR-9, AC16): where N opens, a bare day's first
// free time, ⇥ / ⇧⇥ hops, and the clash that leads the echo. Wall-clock
// minutes per day through local Dates (DST-safe, like gap-finder.ts), on a
// 15-minute step, inside working hours, never before now.

export type FreeBusy = { startMs: number; endMs: number; title?: string };

const STEP = 15;
/** How far a hop looks before it gives up. */
const HOP_DAYS = 14;

function atMinute(dayStartMs: number, minute: number): number {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minute).getTime();
}

function addDays(dayStartMs: number, n: number): number {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

function dayOf(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function minuteOf(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

const overlaps = (s: number, e: number, busy: FreeBusy[]) =>
  busy.some((b) => b.startMs < e && b.endMs > s);

/** The earliest minute a slot may start on a day: the bound, after now (snapped up). */
function lowerBound(dayStartMs: number, fromMinute: number, nowMs: number): number {
  if (dayOf(nowMs) !== dayStartMs) return dayOf(nowMs) > dayStartMs ? Infinity : fromMinute;
  const now = Math.ceil(minuteOf(nowMs) / STEP) * STEP;
  return Math.max(fromMinute, now);
}

/** The first free start on a day between two minutes, or null. */
export function firstFreeStart(q: {
  dayStartMs: number;
  fromMinute: number;
  untilMinute: number;
  lengthMinutes: number;
  nowMs: number;
  busy: FreeBusy[];
}): number | null {
  const from = Math.ceil(lowerBound(q.dayStartMs, q.fromMinute, q.nowMs) / STEP) * STEP;
  for (let m = from; m + q.lengthMinutes <= q.untilMinute; m += STEP) {
    const s = atMinute(q.dayStartMs, m);
    if (!overlaps(s, s + q.lengthMinutes * 60_000, q.busy)) return s;
  }
  return null;
}

type Hours = {
  nowMs: number;
  workStartMinute: number;
  workEndMinute: number;
  busyOn: (dayStartMs: number) => FreeBusy[];
};

/** The day's candidate starts for a hop, nearest first in the hop's direction. */
function hopCandidates(day: number, length: number, q: Hours, direction: 1 | -1): number[] {
  const low = Math.ceil(lowerBound(day, q.workStartMinute, q.nowMs) / STEP) * STEP;
  const out: number[] = [];
  for (let m = low; m + length <= q.workEndMinute; m += STEP) out.push(m);
  return direction < 0 ? out.reverse() : out;
}

/** ⇥ (1) / ⇧⇥ (-1): the next / previous free slot of the draft's length, or null. */
export function hopFreeTime(
  q: Hours & { startMs: number; endMs: number; direction: 1 | -1 },
): { startMs: number; endMs: number } | null {
  const length = Math.max(STEP, Math.round((q.endMs - q.startMs) / 60_000));
  const startDay = dayOf(q.startMs);
  const fromMinute = minuteOf(q.startMs);
  const beyond = (m: number) => (q.direction > 0 ? m > fromMinute : m < fromMinute);
  for (let i = 0; i < HOP_DAYS; i++) {
    const day = addDays(startDay, i * q.direction);
    if (q.direction < 0 && day < dayOf(q.nowMs)) return null;
    const busy = q.busyOn(day);
    const hit = hopCandidates(day, length, q, q.direction)
      .filter((m) => i > 0 || beyond(m))
      .map((m) => atMinute(day, m))
      .find((s) => !overlaps(s, s + length * 60_000, busy));
    if (hit !== undefined) return { startMs: hit, endMs: hit + length * 60_000 };
  }
  return null;
}

/** Where N opens: the grid cursor, else the next free 30 minutes from now (today, then later days). */
export function openingSlot(q: Hours & { cursor: { dayStartMs: number; minute: number } | null }): {
  dayStartMs: number;
  startMinute: number;
} {
  if (q.cursor) return { dayStartMs: q.cursor.dayStartMs, startMinute: q.cursor.minute };
  const today = dayOf(q.nowMs);
  for (let i = 0; i < HOP_DAYS; i++) {
    const day = addDays(today, i);
    const s = firstFreeStart({
      dayStartMs: day,
      fromMinute: q.workStartMinute,
      untilMinute: q.workEndMinute,
      lengthMinutes: 30,
      nowMs: q.nowMs,
      busy: q.busyOn(day),
    });
    if (s !== null) return { dayStartMs: day, startMinute: minuteOf(s) };
  }
  const next = Math.ceil(minuteOf(q.nowMs) / STEP) * STEP;
  return { dayStartMs: today, startMinute: Math.min(next, 24 * 60 - 30) };
}

/** The first busy item the draft overlaps (it leads the echo), or null. */
export function clashFor<T extends FreeBusy>(
  startMs: number,
  endMs: number,
  busyOn: (dayStartMs: number) => T[],
): T | null {
  for (let day = dayOf(startMs); day < endMs; day = addDays(day, 1)) {
    const hit = busyOn(day)
      .filter((b) => b.startMs < endMs && b.endMs > startMs)
      .sort((a, b) => a.startMs - b.startMs)[0];
    if (hit) return hit;
  }
  return null;
}
