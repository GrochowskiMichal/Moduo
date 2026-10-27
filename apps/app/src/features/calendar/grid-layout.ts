// Calendar grid geometry — pure. The grid is laid out in WALL-CLOCK minutes:
// every day has 24 rows and an hour label always sits on the hour it names,
// also in a week with a clock change (CALR-1, AC1 — the old real-minutes
// layout drew a 23h/25h column whose lines disagreed with the shared gutter).
// On the fall-back day the repeated hour shares its row; on the spring-forward
// day the skipped hour is an empty row. Every pointer → time conversion goes
// through `instantAtWallMinute`, so a click lands on the hour its label shows.

const MIN = 60_000;
const DAY_MINUTES = 24 * 60;

/** One horizontal hour line: where it sits and what hour it labels. */
export type HourMark = {
  /** Wall-clock minutes since midnight (always `hour * 60`). */
  minuteOfDay: number;
  hour: number;
};

export type DayGeometry = {
  dayStartMs: number;
  /** Exclusive end — the next local midnight. */
  dayEndMs: number;
  /** Wall-clock minutes in a day column: always 1440. */
  totalMinutes: number;
  hourMarks: HourMark[];
  /** The clocks change on this day (the header labels it). */
  clockChange: "forward" | "back" | null;
};

const HOUR_MARKS: HourMark[] = Array.from({ length: 24 }, (_, hour) => ({
  minuteOfDay: hour * 60,
  hour,
}));

/** Geometry for one local calendar day. */
export function dayGeometry(day: Date): DayGeometry {
  const dayStartMs = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEndMs = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const realMinutes = Math.round((dayEndMs - dayStartMs) / MIN);
  return {
    dayStartMs,
    dayEndMs,
    totalMinutes: DAY_MINUTES,
    hourMarks: HOUR_MARKS,
    clockChange: realMinutes < DAY_MINUTES ? "forward" : realMinutes > DAY_MINUTES ? "back" : null,
  };
}

/** The wall-clock minute of an instant, clamped to the day (1440 at its end). */
export function wallMinuteOf(ms: number, geom: DayGeometry): number {
  if (ms <= geom.dayStartMs) return 0;
  if (ms >= geom.dayEndMs) return DAY_MINUTES;
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / MIN;
}

/** The instant at a wall-clock minute of the day (a click, a drop, a draft).
 *  A minute inside a skipped hour resolves forward, as the platform does. */
export function instantAtWallMinute(minute: number, geom: DayGeometry): number {
  const d = new Date(geom.dayStartMs);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    0,
    0,
    0,
    Math.round(minute * MIN),
  ).getTime();
}

export type ChipSpan = {
  /** Wall-clock minutes from midnight to the chip's (clamped) top. */
  topMinutes: number;
  heightMinutes: number;
};

/** Clamp a chip's span into a day column. Null when fully outside. */
export function chipSpanInDay(startMs: number, endMs: number, geom: DayGeometry): ChipSpan | null {
  const s = Math.max(startMs, geom.dayStartMs);
  const e = Math.min(endMs, geom.dayEndMs);
  if (e <= s) return null;
  const top = wallMinuteOf(s, geom);
  const bottom = wallMinuteOf(e, geom);
  // Inside the repeated fall-back hour the wall clock runs backwards: keep
  // the real length rather than a zero or negative height.
  return { topMinutes: top, heightMinutes: bottom > top ? bottom - top : (e - s) / MIN };
}

/** Wall-clock minutes into the day for an instant (the now line); null off-day. */
export function minutesIntoDay(ms: number, geom: DayGeometry): number | null {
  if (ms < geom.dayStartMs || ms >= geom.dayEndMs) return null;
  return wallMinuteOf(ms, geom);
}

// ── the opening scroll ───────────────────────────────────────────────────────

/** Room left above the working-day start when the grid opens. */
const OPEN_HEADROOM_MINUTES = 30;

/**
 * The minute at the top of the viewport when the week opens (AC5): just above
 * the start of working hours, unless today is visible and now would sit
 * outside the view (early or late), in which case now comes into view a third
 * of the way down.
 */
export function openingScrollMinute(q: {
  workStartMinute: number;
  workEndMinute: number;
  /** Now's wall-clock minute when today is visible; null otherwise. */
  nowMinute: number | null;
  viewportMinutes: number;
}): number {
  const maxTop = Math.max(0, DAY_MINUTES - q.viewportMinutes);
  const clamp = (v: number) => Math.min(Math.max(v, 0), maxTop);
  const top = clamp(q.workStartMinute - OPEN_HEADROOM_MINUTES);
  if (q.nowMinute == null) return top;
  const margin = Math.min(60, q.viewportMinutes / 4);
  const nowInView = q.nowMinute >= top + margin && q.nowMinute <= top + q.viewportMinutes - margin;
  return nowInView ? top : clamp(q.nowMinute - q.viewportMinutes / 3);
}

// ── overlaps: side by side, cascade, fold ────────────────────────────────────

export type LayoutChip = { id: string; startMs: number; endMs: number };

export type PlacedChip = {
  id: string;
  /** Left edge and width as fractions of the day column. */
  left: number;
  width: number;
  /** Stacking order: a card that cascades over another sits above it. */
  layer: number;
  /** Where a later card starts covering this one (it shows only what fits
   *  above that); null when nothing cascades over it. */
  coveredFromMs: number | null;
};

/** Chips beyond the side-by-side cap, folded into one "+N" that opens them. */
export type OverflowChip = {
  ids: string[];
  /** Where the "+N" anchors — the earliest hidden chip's start. */
  startMs: number;
  endMs: number;
};

/** Side-by-side cap: two in Week, four in Day (AC8). */
export const WEEK_COLUMNS = 2;
export const DAY_COLUMNS = 4;
/** A start this far into an earlier card cascades over it instead of splitting. */
const CASCADE_AFTER_MS = 30 * MIN;
/** How far in a cascading card starts, per level. */
const CASCADE_INDENT = 0.25;
const MAX_CASCADE_DEPTH = 2;

/** The grid's stacking order. Cards take chipBase…chipMax by cascade depth;
 *  the now line runs over all of them; the meeting in progress sits over the
 *  line so its title stays readable (AC10). */
export const GRID_LAYER = {
  chipBase: 1,
  chipMax: 1 + MAX_CASCADE_DEPTH,
  overflow: 4,
  now: 5,
  live: 6,
  ghost: 7,
  pending: 8,
} as const;

type Member = { chip: LayoutChip; col: number };
type Group = { startMs: number; depth: number; colEnds: number[]; members: Member[] };

/** The cascade depth of a chip that starts a new group: one past the deepest
 *  earlier group still running when it starts. */
function cascadeDepth(groups: Group[], chip: LayoutChip): number {
  let depth = 0;
  for (const g of groups) {
    if (g.members.some((m) => m.chip.endMs > chip.startMs)) depth = Math.max(depth, g.depth + 1);
  }
  return Math.min(depth, MAX_CASCADE_DEPTH);
}

/** Split a cluster into side-by-side groups (starts within 30 minutes of the
 *  group's first), each with greedy columns. */
function groupCluster(cluster: LayoutChip[]): Group[] {
  const groups: Group[] = [];
  for (const chip of cluster) {
    let group = groups.at(-1);
    if (!group || chip.startMs - group.startMs >= CASCADE_AFTER_MS) {
      group = {
        startMs: chip.startMs,
        depth: cascadeDepth(groups, chip),
        colEnds: [],
        members: [],
      };
      groups.push(group);
    }
    let col = group.colEnds.findIndex((end) => end <= chip.startMs);
    if (col === -1) col = group.colEnds.length;
    group.colEnds[col] = chip.endMs;
    group.members.push({ chip, col });
  }
  return groups;
}

/** The earliest start of a shown, deeper card that begins inside `m`. */
function coveredFrom(m: Member, deeper: Member[]): number | null {
  let at: number | null = null;
  for (const o of deeper) {
    if (o.chip.startMs <= m.chip.startMs || o.chip.startMs >= m.chip.endMs) continue;
    at = Math.min(at ?? Infinity, o.chip.startMs);
  }
  return at;
}

/**
 * Lay out one day's chips. Chips starting within 30 minutes of each other sit
 * side by side (at most `maxCols`; the rest fold into "+N"). A chip starting
 * 30+ minutes into an earlier one it overlaps cascades over it from 25% in,
 * and the covered card keeps its full width (it learns where it's covered).
 */
export function layoutDayChips(
  chips: LayoutChip[],
  maxCols: number = WEEK_COLUMNS,
): { placed: PlacedChip[]; overflow: OverflowChip[] } {
  const sorted = chips
    .slice()
    .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs || a.id.localeCompare(b.id));

  const placed: PlacedChip[] = [];
  const overflow: OverflowChip[] = [];
  const shown = (m: Member) => m.col < maxCols;

  const flush = (cluster: LayoutChip[]) => {
    const groups = groupCluster(cluster);
    for (const [gi, group] of groups.entries()) {
      const visibleCols = Math.min(group.colEnds.length, maxCols);
      const indent = group.depth * CASCADE_INDENT;
      const deeper = groups
        .slice(gi + 1)
        .filter((g) => g.depth > group.depth)
        .flatMap((g) => g.members.filter(shown));
      for (const m of group.members.filter(shown)) {
        placed.push({
          id: m.chip.id,
          left: indent + (m.col * (1 - indent)) / visibleCols,
          width: (1 - indent) / visibleCols,
          layer: GRID_LAYER.chipBase + group.depth,
          coveredFromMs: coveredFrom(m, deeper),
        });
      }
      const hidden = group.members.filter((m) => !shown(m));
      if (hidden.length > 0) {
        overflow.push({
          ids: hidden.map((m) => m.chip.id),
          startMs: Math.min(...hidden.map((m) => m.chip.startMs)),
          endMs: Math.max(...hidden.map((m) => m.chip.endMs)),
        });
      }
    }
  };

  // A cluster = a maximal run of transitively overlapping chips.
  let cluster: LayoutChip[] = [];
  let clusterEnd = -Infinity;
  for (const chip of sorted) {
    if (cluster.length > 0 && chip.startMs >= clusterEnd) {
      flush(cluster);
      cluster = [];
      clusterEnd = -Infinity;
    }
    cluster.push(chip);
    clusterEnd = Math.max(clusterEnd, chip.endMs);
  }
  if (cluster.length > 0) flush(cluster);

  return { placed, overflow };
}
