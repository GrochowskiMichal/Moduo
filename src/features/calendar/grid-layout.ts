// Calendar grid geometry — pure, real-instant math. A day column's height and
// every chip position derive from actual elapsed minutes between instants,
// never from "hour × 60" indices, so the 23h/25h DST days lay out without
// drifting chip positions (specs/calendar.md edge case + grid-layout test).

/** One horizontal hour line: where it sits and what local hour it labels. */
export type HourMark = {
  /** Real minutes elapsed since the local day start. */
  minuteOfDay: number;
  /** Local hour label (0–23). Appears twice on the 25h fall-back day. */
  hour: number;
};

export type DayGeometry = {
  dayStartMs: number;
  /** Exclusive end — the next local midnight. */
  dayEndMs: number;
  /** Real minutes in this local day: 1380 (spring), 1440, or 1500 (fall). */
  totalMinutes: number;
  hourMarks: HourMark[];
};

/** Geometry for one local calendar day, DST-aware. */
export function dayGeometry(day: Date): DayGeometry {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const dayStartMs = start.getTime();
  const dayEndMs = end.getTime();
  const totalMinutes = Math.round((dayEndMs - dayStartMs) / 60_000);
  const hourMarks: HourMark[] = [];
  for (let t = dayStartMs; t < dayEndMs; t += 3_600_000) {
    hourMarks.push({
      minuteOfDay: Math.round((t - dayStartMs) / 60_000),
      hour: new Date(t).getHours(),
    });
  }
  return { dayStartMs, dayEndMs, totalMinutes, hourMarks };
}

export type ChipSpan = {
  /** Real minutes from the day start to the chip's (clamped) top. */
  topMinutes: number;
  heightMinutes: number;
};

/** Clamp a chip's real span into a day column. Null when fully outside. */
export function chipSpanInDay(
  startMs: number,
  endMs: number,
  geom: DayGeometry,
): ChipSpan | null {
  const s = Math.max(startMs, geom.dayStartMs);
  const e = Math.min(endMs, geom.dayEndMs);
  if (e <= s) return null;
  return {
    topMinutes: (s - geom.dayStartMs) / 60_000,
    heightMinutes: (e - s) / 60_000,
  };
}

/** Minutes elapsed since the day start for an instant (the now-line position). */
export function minutesIntoDay(ms: number, geom: DayGeometry): number | null {
  if (ms < geom.dayStartMs || ms >= geom.dayEndMs) return null;
  return (ms - geom.dayStartMs) / 60_000;
}

/**
 * Real minutes into the day for a WALL-CLOCK minute-of-day (e.g. the 08:00
 * working-hours pref). On DST days the same wall-clock time sits at a
 * different real offset — resolving through a local Date keeps prefs-driven
 * geometry (washes, gap bounds) aligned with the real-instant chip layout.
 * Clamped to the day's real span.
 */
export function wallClockToRealMinutes(
  minuteOfDay: number,
  geom: DayGeometry,
): number {
  const start = new Date(geom.dayStartMs);
  const at = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  const real = (at.getTime() - geom.dayStartMs) / 60_000;
  return Math.min(Math.max(real, 0), geom.totalMinutes);
}

// ── overlap clustering ───────────────────────────────────────────────────────

export type LayoutChip = { id: string; startMs: number; endMs: number };

export type PlacedChip = {
  id: string;
  /** Column index within the cluster (0-based). */
  col: number;
  /** Total visible columns in the chip's cluster — divide the width by this. */
  cols: number;
};

/** Chips beyond the visible column cap, collapsed into one "+N" chip. */
export type OverflowChip = {
  ids: string[];
  /** Where the "+N" chip anchors — the earliest hidden chip's start. */
  startMs: number;
  endMs: number;
};

export const MAX_VISIBLE_COLUMNS = 3;

/**
 * Cluster overlapping chips into side-by-side columns (standard cluster
 * layout). At most `maxCols` columns render; chips assigned beyond that
 * collapse into a per-cluster "+N" overflow chip (opens a popover list).
 */
export function layoutDayChips(
  chips: LayoutChip[],
  maxCols: number = MAX_VISIBLE_COLUMNS,
): { placed: PlacedChip[]; overflow: OverflowChip[] } {
  const sorted = chips
    .slice()
    .sort(
      (a, b) =>
        a.startMs - b.startMs || b.endMs - a.endMs || a.id.localeCompare(b.id),
    );

  const placed: PlacedChip[] = [];
  const overflow: OverflowChip[] = [];

  // A cluster = a maximal run of transitively-overlapping chips.
  let cluster: Array<{ chip: LayoutChip; col: number }> = [];
  let colEnds: number[] = []; // per-column latest end within the cluster
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const visibleCols = Math.min(colEnds.length, maxCols);
    const hidden = cluster.filter((c) => c.col >= maxCols);
    for (const { chip, col } of cluster) {
      if (col < maxCols) placed.push({ id: chip.id, col, cols: visibleCols });
    }
    if (hidden.length > 0) {
      overflow.push({
        ids: hidden.map((c) => c.chip.id),
        startMs: Math.min(...hidden.map((c) => c.chip.startMs)),
        endMs: Math.max(...hidden.map((c) => c.chip.endMs)),
      });
    }
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };

  for (const chip of sorted) {
    if (cluster.length > 0 && chip.startMs >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= chip.startMs);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(chip.endMs);
    } else {
      colEnds[col] = chip.endMs;
    }
    cluster.push({ chip, col });
    clusterEnd = Math.max(clusterEnd, chip.endMs);
  }
  flush();

  return { placed, overflow };
}
