// Calendar preferences.
//
// Two halves (specs/calendar.md §10 / assumption 7):
//  • View state (view mode + last visible date) — localStorage per
//    user+workspace, the Tasks page pattern. This file is that half.
//  • The `user_preferences.calendar` cloud domain (working hours, week start,
//    weekends, per-calendar visibility/colors) — lands with CAL-4/CAL-6. The
//    shape + sanitizer live here already so the cloud wiring is a transport
//    change, not a model change.

import type { CalendarView } from "./lens";
import { localDayKey, parseDayKey } from "./lens";

// One storage scaffold for every calendar localStorage domain: guard →
// parse/stringify → sanitize → fall back. The CAL-4/6 cloud swap replaces the
// transport here without touching the public read/write functions.
function readStored<T>(key: string, sanitize: (raw: unknown) => T, fallback: () => T): T {
  if (typeof window === "undefined") return fallback();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback();
    return sanitize(JSON.parse(raw));
  } catch {
    return fallback();
  }
}

function writeStored(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or storage disabled — non-fatal */
  }
}

// ── view state (localStorage half) ──────────────────────────────────────────

export type CalendarViewState = {
  view: CalendarView;
  /** Last visible date as a local YYYY-MM-DD key. */
  anchor: string;
};

function viewKey(userId: string, workspaceId: string): string {
  return `moduo:calendar:view:${userId}:${workspaceId}`;
}

/** Default: Week view (the Morgen habit), anchored on today. */
export function defaultViewState(now: Date = new Date()): CalendarViewState {
  return { view: "week", anchor: localDayKey(now) };
}

export function sanitizeViewState(
  raw: unknown,
  now: Date = new Date(),
): CalendarViewState {
  const fallback = defaultViewState(now);
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const view: CalendarView =
    o.view === "day" || o.view === "week" ? o.view : fallback.view;
  const anchor =
    typeof o.anchor === "string" && parseDayKey(o.anchor)
      ? o.anchor
      : fallback.anchor;
  return { view, anchor };
}

export function readViewState(
  userId: string,
  workspaceId: string,
  now: Date = new Date(),
): CalendarViewState {
  return readStored(
    viewKey(userId, workspaceId),
    (raw) => sanitizeViewState(raw, now),
    () => defaultViewState(now),
  );
}

export function writeViewState(
  userId: string,
  workspaceId: string,
  state: CalendarViewState,
): void {
  writeStored(viewKey(userId, workspaceId), state);
}

// ── the calendar prefs domain (cloud shape; local fallback until CAL-4/6) ───

export type CalendarPrefs = {
  /** Working-hours bound, minutes from local midnight. Used ONLY for the
   * off-hours wash + (CAL-4) gap-finding — never a visible fullness UI. */
  workStartMinute: number;
  workEndMinute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
  showWeekends: boolean;
};

/** 08:00–18:00, Monday start, weekends shown (spec §10 defaults). */
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  workStartMinute: 8 * 60,
  workEndMinute: 18 * 60,
  weekStartsOn: 1,
  showWeekends: true,
};

function asMinute(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.round(v);
  return n < 0 || n > 1440 ? fallback : n;
}

/** Coerce any stored/synced value into a valid prefs object (round-trips). */
export function sanitizeCalendarPrefs(raw: unknown): CalendarPrefs {
  const d = DEFAULT_CALENDAR_PREFS;
  if (!raw || typeof raw !== "object") return { ...d };
  const o = raw as Record<string, unknown>;
  let workStartMinute = asMinute(o.workStartMinute, d.workStartMinute);
  let workEndMinute = asMinute(o.workEndMinute, d.workEndMinute);
  if (workStartMinute >= workEndMinute) {
    workStartMinute = d.workStartMinute;
    workEndMinute = d.workEndMinute;
  }
  const weekStartsOn =
    typeof o.weekStartsOn === "number" &&
    Number.isInteger(o.weekStartsOn) &&
    o.weekStartsOn >= 0 &&
    o.weekStartsOn <= 6
      ? o.weekStartsOn
      : d.weekStartsOn;
  const showWeekends =
    typeof o.showWeekends === "boolean" ? o.showWeekends : d.showWeekends;
  return { workStartMinute, workEndMinute, weekStartsOn, showWeekends };
}

function prefsKey(userId: string): string {
  return `moduo:calendar:prefs:${userId}`;
}

export function readCalendarPrefs(userId: string): CalendarPrefs {
  return readStored(prefsKey(userId), sanitizeCalendarPrefs, () => ({
    ...DEFAULT_CALENDAR_PREFS,
  }));
}

export function writeCalendarPrefs(userId: string, prefs: CalendarPrefs): void {
  writeStored(prefsKey(userId), sanitizeCalendarPrefs(prefs));
}
