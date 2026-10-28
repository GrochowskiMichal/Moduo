// The gap-finder (CAL-4, AC8) — "Later today" and "Move to today" both ask the
// same question: where is the next free slot today that fits this block?
//
// Real-instant math throughout (like grid-layout.ts), so the working-hours
// bound is resolved through a local Date and DST days stay honest. The search
// runs AFTER now, inside the working-hours bound, skipping every busy interval
// (events + other task blocks). Snapped to the grid step so placements land on
// clean boundaries. Returns null when the day is full — the caller then leaves
// the block where it is (still in the strip) with honest copy.

/** A slot the day is already spoken for — an event or another task block. */
export type BusyInterval = { startMs: number; endMs: number };

export type GapQuery = {
  /** The current instant — gaps are only searched after this. */
  nowMs: number;
  /** Local midnight of the target day (today). */
  dayStartMs: number;
  /** Working-hours bound, wall-clock minutes from local midnight. */
  workStartMinute: number;
  workEndMinute: number;
  /** Minutes the block needs. */
  durationMinutes: number;
  /** Events + task blocks on the day (any order; overlaps fine). */
  busy: BusyInterval[];
  /** Placement granularity (default 15-min, the grid step). */
  stepMinutes?: number;
};

/** Real instant of a wall-clock minute-of-day on the target day (DST-safe). */
function wallClockInstant(dayStartMs: number, minute: number): number {
  const d = new Date(dayStartMs);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    Math.floor(minute / 60),
    minute % 60,
  ).getTime();
}

/** Round an instant UP to the next `stepMs` boundary measured from day start. */
function snapUp(ms: number, dayStartMs: number, stepMs: number): number {
  const off = ms - dayStartMs;
  return dayStartMs + Math.ceil(off / stepMs) * stepMs;
}

/**
 * The first fitting gap's start instant, or null if the day has no room left.
 * The gap must sit entirely inside [workStart, workEnd] and after `now`.
 */
export function findNextGap(q: GapQuery): number | null {
  const step = (q.stepMinutes ?? 15) * 60_000;
  const durMs = Math.max(0, q.durationMinutes) * 60_000;
  if (durMs <= 0) return null;

  const workStart = wallClockInstant(q.dayStartMs, q.workStartMinute);
  const workEnd = wallClockInstant(q.dayStartMs, q.workEndMinute);
  if (workEnd <= workStart) return null;

  // Start no earlier than now or the working window, snapped to the grid step.
  let cursor = snapUp(Math.max(q.nowMs, workStart), q.dayStartMs, step);
  if (cursor + durMs > workEnd) return null;

  // Only intervals that could still block us — after the cursor, sorted.
  const intervals = q.busy
    .filter((b) => b.endMs > cursor && b.startMs < workEnd)
    .sort((a, b) => a.startMs - b.startMs);

  for (const iv of intervals) {
    const gapEnd = Math.min(iv.startMs, workEnd);
    if (gapEnd - cursor >= durMs) return cursor; // fits before this interval
    // Jump past the interval; re-snap so the next start stays on the grid.
    cursor = Math.max(cursor, snapUp(iv.endMs, q.dayStartMs, step));
    if (cursor + durMs > workEnd) return null;
  }

  return workEnd - cursor >= durMs ? cursor : null;
}

/**
 * The free stretches of a day that fit the block (CALR-5): after now, inside
 * working hours, between the busy intervals, each start on the grid step. What
 * placing a task washes on the grid and where a click may put it.
 */
export function freeSlots(q: GapQuery): BusyInterval[] {
  const step = (q.stepMinutes ?? 15) * 60_000;
  const durMs = Math.max(0, q.durationMinutes) * 60_000;
  if (durMs <= 0) return [];
  const workStart = wallClockInstant(q.dayStartMs, q.workStartMinute);
  const workEnd = wallClockInstant(q.dayStartMs, q.workEndMinute);
  const out: BusyInterval[] = [];
  let cursor = snapUp(Math.max(q.nowMs, workStart), q.dayStartMs, step);
  const intervals = q.busy
    .filter((b) => b.endMs > cursor && b.startMs < workEnd)
    .sort((a, b) => a.startMs - b.startMs);
  for (const iv of intervals) {
    const gapEnd = Math.min(iv.startMs, workEnd);
    if (gapEnd - cursor >= durMs) out.push({ startMs: cursor, endMs: gapEnd });
    cursor = Math.max(cursor, snapUp(iv.endMs, q.dayStartMs, step));
  }
  if (workEnd - cursor >= durMs) out.push({ startMs: cursor, endMs: workEnd });
  return out;
}

export type RangeGapQuery = Omit<GapQuery, "nowMs" | "dayStartMs"> & {
  /** Search from this instant (now, or a later day's start). */
  fromMs: number;
  /** The days to search, in order (local midnights or any instant on them). */
  days: readonly Date[];
};

function eachDay(q: RangeGapQuery): GapQuery[] {
  return q.days
    .map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()))
    .filter((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() > q.fromMs)
    .map((d) => ({ ...q, dayStartMs: d.getTime(), nowMs: Math.max(q.fromMs, d.getTime()) }));
}

/** S: the first free slot across the days that fits the estimate, or null. */
export function findFreeSlot(q: RangeGapQuery): number | null {
  for (const day of eachDay(q)) {
    const gap = findNextGap(day);
    if (gap != null) return gap;
  }
  return null;
}

/** ⇥: the start of the next free stretch after `currentMs` that fits, or null. */
export function nextFreeSlot(q: RangeGapQuery & { currentMs: number }): number | null {
  for (const day of eachDay(q)) {
    const slot = freeSlots(day).find((s) => s.startMs > q.currentMs);
    if (slot) return slot.startMs;
  }
  return null;
}
