// Open times for a booking link. Weekly hours are wall-clock in the host's
// timezone. A slot is offered when its meeting does not overlap any busy
// interval expanded by the link's buffers (padding before and after).

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type TimeWindow = { start: string; end: string };

export type WeeklyHours = Record<Weekday, TimeWindow[]>;

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  sun: [],
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
  sat: [],
};

export type Interval = { start: Date; end: Date };

const HM = /^(\d{2}):(\d{2})$/;

export function parseHm(value: string): { h: number; m: number } | null {
  const match = HM.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

export function normalizeWeeklyHours(raw: unknown): WeeklyHours {
  const out: WeeklyHours = {
    sun: [],
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
  };
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WEEKLY_HOURS, sun: [], sat: [] };
  const record = raw as Record<string, unknown>;
  for (const day of WEEKDAYS) {
    const windows = record[day];
    if (!Array.isArray(windows)) continue;
    for (const window of windows) {
      if (!window || typeof window !== "object") continue;
      const start = (window as TimeWindow).start;
      const end = (window as TimeWindow).end;
      if (typeof start !== "string" || typeof end !== "string") continue;
      if (!parseHm(start) || !parseHm(end) || start >= end) continue;
      out[day].push({ start, end });
    }
  }
  return out;
}

function weekdayIndex(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const label = fmt.format(date).slice(0, 3);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
  return idx < 0 ? 0 : idx;
}

type Ymd = { y: number; m: number; d: number };

function ymdInZone(date: Date, timeZone: string): Ymd {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) };
}

function addDays(ymd: Ymd, days: number): Ymd {
  const utc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

function partsInZone(date: Date, timeZone: string): Ymd & { h: number; min: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let h = Number(map.hour);
  let d = Number(map.day);
  let m = Number(map.month);
  let y = Number(map.year);
  if (h === 24) {
    h = 0;
    const next = addDays({ y, m, d }, 1);
    y = next.y;
    m = next.m;
    d = next.d;
  }
  return { y, m, d, h, min: Number(map.minute) };
}

/** Wall-clock time in `timeZone` → UTC instant. */
export function zonedTimeToUtc(
  y: number,
  month: number,
  d: number,
  h: number,
  min: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(y, month - 1, d, h, min, 0);
  for (let i = 0; i < 4; i++) {
    const got = partsInZone(new Date(utc), timeZone);
    const gotUtc = Date.UTC(got.y, got.m - 1, got.d, got.h, got.min, 0);
    const want = Date.UTC(y, month - 1, d, h, min, 0);
    const delta = want - gotUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function computeOpenSlots(input: {
  now: Date;
  hostTimeZone: string;
  weeklyHours: WeeklyHours;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  horizonDays: number;
  minNoticeMinutes: number;
  busy: Interval[];
}): Date[] {
  const duration = Math.max(1, Math.round(input.durationMinutes));
  const before = Math.max(0, input.bufferBeforeMinutes) * 60_000;
  const after = Math.max(0, input.bufferAfterMinutes) * 60_000;
  const horizon = Math.max(1, Math.min(90, Math.round(input.horizonDays)));
  const earliest = input.now.getTime() + Math.max(0, input.minNoticeMinutes) * 60_000;
  const hours = normalizeWeeklyHours(input.weeklyHours);
  const blocked = input.busy.map((interval) => ({
    start: interval.start.getTime() - before,
    end: interval.end.getTime() + after,
  }));

  const startDay = ymdInZone(input.now, input.hostTimeZone);
  const slots: Date[] = [];

  for (let offset = 0; offset < horizon; offset++) {
    const day = addDays(startDay, offset);
    const noon = zonedTimeToUtc(day.y, day.m, day.d, 12, 0, input.hostTimeZone);
    const weekday = WEEKDAYS[weekdayIndex(noon, input.hostTimeZone)];
    for (const window of hours[weekday]) {
      const from = parseHm(window.start);
      const to = parseHm(window.end);
      if (!from || !to) continue;
      const windowStart = from.h * 60 + from.m;
      const windowEnd = to.h * 60 + to.m;
      for (let cursor = windowStart; cursor + duration <= windowEnd; cursor += duration) {
        const start = zonedTimeToUtc(
          day.y,
          day.m,
          day.d,
          Math.floor(cursor / 60),
          cursor % 60,
          input.hostTimeZone,
        );
        const startMs = start.getTime();
        const endMs = startMs + duration * 60_000;
        if (startMs < earliest) continue;
        const hit = blocked.some((block) => overlaps(startMs, endMs, block.start, block.end));
        if (!hit) slots.push(start);
      }
    }
  }
  return slots;
}
