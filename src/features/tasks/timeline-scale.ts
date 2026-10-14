// The Timeline's time axis (Tasks v3 TV-TL1, spec §6, REPLAN 69): zoom
// levels, day numbers, the endless range, the two-tier header and the week
// buckets "Due per week" counts in. Pure: no React, no IO.
//
// Days are whole numbers (days since 1970-01-01 of a local calendar date), so
// positions never drift across a DST change and a date key ("2026-10-13") maps
// to one column on every machine. x = (day − range start) × day width; a
// point sits in the middle of its day.
//
// TV-TL2's seam: `dayAtX` turns a pointer's x on the track into the day under
// it, and `xOfDay` / `dayCenterX` place anything a drag previews.

/** Week · Month · Quarter · Year (REPLAN 69). */
export type TimelineZoom = "week" | "month" | "quarter" | "year";

export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ["week", "month", "quarter", "year"];

export const ZOOM_LABELS: Record<TimelineZoom, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

/**
 * Pixels per day. Whole pixels, so day lines stay crisp. A canvas about
 * 900 px wide shows a week and a bit (Week), five weeks (Month), a quarter
 * (Quarter) and most of a year (Year).
 */
export const DAY_WIDTH: Record<TimelineZoom, number> = {
  week: 120,
  month: 24,
  quarter: 10,
  year: 3,
};

export function isTimelineZoom(value: unknown): value is TimelineZoom {
  return value === "week" || value === "month" || value === "quarter" || value === "year";
}

/** One step in (−1) or out (+1), clamped to the ends. */
export function stepZoom(zoom: TimelineZoom, direction: 1 | -1): TimelineZoom {
  const i = TIMELINE_ZOOMS.indexOf(zoom);
  const next = Math.max(0, Math.min(TIMELINE_ZOOMS.length - 1, i + direction));
  return TIMELINE_ZOOMS[next] ?? zoom;
}

// ── Day numbers ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The day number of a calendar date (month is 0-based, as in `Date`). */
export function dayNumOf(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month, day) / DAY_MS);
}

/** The day number of a local moment's calendar date. */
export function dayNumOfDate(date: Date): number {
  return dayNumOf(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The day number of a date key ("2026-10-13"), or null when it isn't one. */
export function dayNumOfKey(key: string | null | undefined): number | null {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return null;
  return dayNumOf(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** The day number of an ISO instant, read in the device's calendar. */
export function dayNumOfInstant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dayNumOfDate(d);
}

/** The local midnight of a day number (for the app's date words). */
export function dateOfDay(day: number): Date {
  const utc = new Date(day * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** The date key of a day number ("2026-10-13"). */
export function keyOfDay(day: number): string {
  const utc = new Date(day * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday (1970-01-01, day 0, was a Thursday). */
export function weekdayOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** The first day of the week `day` is in, for a week that starts on `weekStartsOn`. */
export function weekStartOf(day: number, weekStartsOn: number): number {
  return day - ((weekdayOf(day) - weekStartsOn + 7) % 7);
}

function partsOf(day: number): { year: number; month: number; date: number } {
  const utc = new Date(day * DAY_MS);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth(), date: utc.getUTCDate() };
}

/** The first day of the month after the one `day` is in. */
function nextMonthStart(day: number): number {
  const { year, month } = partsOf(day);
  return dayNumOf(year, month + 1, 1);
}

// ── The range: endless both ways ─────────────────────────────────────────────

/** The days the canvas is drawn for: `start` … `start + days − 1`. */
export type TimelineRange = { start: number; days: number };

/** How far the canvas reaches past today (and past the dated work) at first. */
const RANGE_PAD_DAYS = 400;
/** How far one extension reaches when the scroll nears an edge. */
export const RANGE_EXTEND_DAYS = 365;
/** Dates further than this from today never stretch the canvas (a typo'd year). */
const RANGE_CAP_DAYS = 365 * 5;

/**
 * The first range: today and every dated item (`extent`, clamped to five
 * years either side), padded a year and more both ways. The scroll extends it
 * on demand (`extendRange`), so it reads as endless.
 */
export function initialRange(
  today: number,
  extent: { min: number; max: number } | null = null,
): TimelineRange {
  let min = today;
  let max = today;
  if (extent) {
    min = Math.max(today - RANGE_CAP_DAYS, Math.min(min, extent.min));
    max = Math.min(today + RANGE_CAP_DAYS, Math.max(max, extent.max));
  }
  const start = min - RANGE_PAD_DAYS;
  return { start, days: max + RANGE_PAD_DAYS - start + 1 };
}

/**
 * Grow the range when the visible days come within `margin` days of an edge.
 * Returns null when nothing changes; `shift` is how many days were added at
 * the start (the scroll position moves by `shift × day width` to stay put).
 */
export function extendRange(
  range: TimelineRange,
  visible: { from: number; to: number },
  margin: number,
): { range: TimelineRange; shift: number } | null {
  let { start, days } = range;
  let shift = 0;
  if (visible.from - start < margin) {
    start -= RANGE_EXTEND_DAYS;
    days += RANGE_EXTEND_DAYS;
    shift = RANGE_EXTEND_DAYS;
  }
  if (start + days - 1 - visible.to < margin) days += RANGE_EXTEND_DAYS;
  if (start === range.start && days === range.days) return null;
  return { range: { start, days }, shift };
}

/** Left edge of a day's column on the track. */
export function xOfDay(range: TimelineRange, dayWidth: number, day: number): number {
  return (day - range.start) * dayWidth;
}

/** The middle of a day's column: where a point or a diamond sits. */
export function dayCenterX(range: TimelineRange, dayWidth: number, day: number): number {
  return (day - range.start + 0.5) * dayWidth;
}

/** The day under an x on the track (clamped to the range). */
export function dayAtX(range: TimelineRange, dayWidth: number, x: number): number {
  const idx = Math.floor(x / dayWidth);
  return range.start + Math.max(0, Math.min(range.days - 1, idx));
}

/** The days a scroll position shows (whole days, both edges included). */
export function visibleDays(
  range: TimelineRange,
  dayWidth: number,
  scrollLeft: number,
  trackWidth: number,
): { from: number; to: number } {
  const from = range.start + Math.floor(Math.max(0, scrollLeft) / dayWidth);
  const to =
    range.start + Math.ceil((Math.max(0, scrollLeft) + Math.max(0, trackWidth)) / dayWidth);
  return { from, to };
}

/**
 * The visible days widened by a screen on each side and snapped to blocks of
 * that size, so the header and ghosts redraw only when the scroll crosses a
 * block, not on every frame.
 */
export function drawWindow(visible: { from: number; to: number }): { from: number; to: number } {
  const span = Math.max(14, visible.to - visible.from);
  const from = Math.floor((visible.from - span) / span) * span;
  const to = Math.ceil((visible.to + span) / span) * span;
  return { from, to };
}

/** Where the scroll sits with `day` a quarter of the way across (REPLAN 69). */
export function scrollLeftFor(
  range: TimelineRange,
  dayWidth: number,
  day: number,
  trackWidth: number,
  fraction = 0.25,
): number {
  return Math.max(0, dayCenterX(range, dayWidth, day) - trackWidth * fraction);
}

// ── The header ───────────────────────────────────────────────────────────────

/** One labelled stretch of a tier: [start, end] in days, inclusive. */
export type HeaderCell = {
  start: number;
  end: number;
  label: string;
  /** Today falls in it. */
  today?: boolean;
  /** A Saturday or Sunday (Week and Month, drawn quieter). */
  weekend?: boolean;
};

type Formats = {
  month: Intl.DateTimeFormat;
  monthShort: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
};

let formats: Formats | null = null;
function fmt(): Formats {
  formats ??= {
    month: new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }),
    monthShort: new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }),
  };
  return formats;
}

function utcOf(day: number): Date {
  return new Date(day * DAY_MS);
}

/**
 * The top tier: months (with the year when it isn't today's), or years at
 * Year zoom. Cells cover `window` (clipped to the range).
 */
export function topTier(
  zoom: TimelineZoom,
  window: { from: number; to: number },
  today: number,
): HeaderCell[] {
  const out: HeaderCell[] = [];
  const thisYear = partsOf(today).year;
  if (zoom === "year") {
    let { year } = partsOf(window.from);
    while (dayNumOf(year, 0, 1) <= window.to) {
      const start = dayNumOf(year, 0, 1);
      const end = dayNumOf(year + 1, 0, 1) - 1;
      out.push({ start, end, label: String(year), today: today >= start && today <= end });
      year += 1;
    }
    return out;
  }
  const { year, month } = partsOf(window.from);
  let start = dayNumOf(year, month, 1);
  while (start <= window.to) {
    const end = nextMonthStart(start) - 1;
    const p = partsOf(start);
    const name = fmt().month.format(utcOf(start));
    out.push({
      start,
      end,
      label: p.year === thisYear ? name : `${name} ${p.year}`,
      today: today >= start && today <= end,
    });
    start = end + 1;
  }
  return out;
}

/**
 * The bottom tier: days at Week ("Mon 12") and Month ("12"), weeks at Quarter
 * (each week's first day, by the person's week start), months at Year ("Jan").
 */
export function bottomTier(
  zoom: TimelineZoom,
  window: { from: number; to: number },
  today: number,
  weekStartsOn: number,
): HeaderCell[] {
  const out: HeaderCell[] = [];
  if (zoom === "week" || zoom === "month") {
    for (let day = window.from; day <= window.to; day++) {
      const wd = weekdayOf(day);
      const date = String(partsOf(day).date);
      out.push({
        start: day,
        end: day,
        label: zoom === "week" ? `${fmt().weekday.format(utcOf(day))} ${date}` : date,
        today: day === today,
        weekend: wd === 0 || wd === 6,
      });
    }
    return out;
  }
  if (zoom === "quarter") {
    for (let start = weekStartOf(window.from, weekStartsOn); start <= window.to; start += 7) {
      out.push({
        start,
        end: start + 6,
        label: String(partsOf(start).date),
        today: today >= start && today <= start + 6,
      });
    }
    return out;
  }
  const { year, month } = partsOf(window.from);
  let start = dayNumOf(year, month, 1);
  while (start <= window.to) {
    const end = nextMonthStart(start) - 1;
    out.push({
      start,
      end,
      label: fmt().monthShort.format(utcOf(start)),
      today: today >= start && today <= end,
    });
    start = end + 1;
  }
  return out;
}

/** The days in `window` where a stronger line marks a month's start (a year's at Year). */
export function strongLines(zoom: TimelineZoom, window: { from: number; to: number }): number[] {
  const out: number[] = [];
  if (zoom === "year") {
    let { year } = partsOf(window.from);
    for (let d = dayNumOf(year, 0, 1); d <= window.to; d = dayNumOf(++year, 0, 1)) {
      if (d >= window.from) out.push(d);
    }
    return out;
  }
  const { year, month } = partsOf(window.from);
  for (let d = dayNumOf(year, month, 1); d <= window.to; d = nextMonthStart(d)) {
    if (d >= window.from) out.push(d);
  }
  return out;
}

/** Month starts at Year zoom: the grid's unit lines there (months aren't even). */
export function monthLines(window: { from: number; to: number }): number[] {
  const out: number[] = [];
  const { year, month } = partsOf(window.from);
  for (let d = dayNumOf(year, month, 1); d <= window.to; d = nextMonthStart(d)) {
    if (d >= window.from) out.push(d);
  }
  return out;
}

/** What the grid draws as a CSS background: its unit and where the first one falls. */
export function gridUnit(zoom: TimelineZoom): "day" | "week" | "month" {
  return zoom === "week" || zoom === "month" ? "day" : zoom === "quarter" ? "week" : "month";
}

// ── Due per week (AC2.7) ─────────────────────────────────────────────────────

/**
 * How many dated items fall in each week (keyed by the week's first day, by
 * the person's week start): the header's quiet "Due per week" row.
 */
export function weekCounts(days: Iterable<number>, weekStartsOn: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const day of days) {
    const week = weekStartOf(day, weekStartsOn);
    out.set(week, (out.get(week) ?? 0) + 1);
  }
  return out;
}
