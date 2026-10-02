// Calendar preferences.
//
// Two halves (specs/calendar.md §10 / assumption 7):
//  • View state (view mode + last visible date) — localStorage per
//    user+workspace, the Tasks page pattern. This file is that half.
//  • The `user_preferences.calendar` cloud domain (working hours, week start,
//    weekends, per-calendar visibility/colors) — lands with CAL-4/CAL-6. The
//    shape + sanitizer live here already so the cloud wiring is a transport
//    change, not a model change.

import { z } from "zod";

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

const viewStateSchema = z.object({
  view: z.enum(["day", "week"]).optional(),
  anchor: z.string().optional(),
});

export function sanitizeViewState(raw: unknown, now: Date = new Date()): CalendarViewState {
  const fallback = defaultViewState(now);
  const parsed = viewStateSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  const view: CalendarView =
    parsed.data.view === "day" || parsed.data.view === "week" ? parsed.data.view : fallback.view;
  const anchor =
    typeof parsed.data.anchor === "string" && parseDayKey(parsed.data.anchor)
      ? parsed.data.anchor
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

// ── right-panel variant (localStorage, per user+workspace — §10) ────────────

export type PanelVariantId = "tasks" | "detail" | "notes";

const PANEL_VARIANT_IDS: readonly PanelVariantId[] = ["tasks", "detail", "notes"];

function panelVariantKey(userId: string, workspaceId: string): string {
  return `moduo:calendar:panel-variant:${userId}:${workspaceId}`;
}

export function readPanelVariant(userId: string, workspaceId: string): PanelVariantId {
  return readStored(
    panelVariantKey(userId, workspaceId),
    (raw) =>
      PANEL_VARIANT_IDS.includes(raw as PanelVariantId) ? (raw as PanelVariantId) : "tasks",
    () => "tasks" as PanelVariantId,
  );
}

export function writePanelVariant(
  userId: string,
  workspaceId: string,
  variant: PanelVariantId,
): void {
  writeStored(panelVariantKey(userId, workspaceId), variant);
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
  /** Account ids toggled OFF in the left rail — their mirrored events hide from
   * the grid (CAL-6, §3a). Persisted so a hidden calendar stays hidden. */
  hiddenAccountIds: string[];
  /** Per-account color override (a bounded label hue name; see tag-colors). The
   * provider's own color is the default until the user recolors it. */
  accountColors: Record<string, string>;
};

/** 08:00–18:00, Monday start, weekends shown (spec §10 defaults). */
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  workStartMinute: 8 * 60,
  workEndMinute: 18 * 60,
  weekStartsOn: 1,
  showWeekends: true,
  hiddenAccountIds: [],
  accountColors: {},
};

function asMinute(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.round(v);
  return n < 0 || n > 1440 ? fallback : n;
}

const calendarPrefsShape = z.object({
  workStartMinute: z.unknown().optional(),
  workEndMinute: z.unknown().optional(),
  weekStartsOn: z.unknown().optional(),
  showWeekends: z.unknown().optional(),
  hiddenAccountIds: z.unknown().optional(),
  accountColors: z.unknown().optional(),
});

/** Coerce any stored/synced value into a valid prefs object (round-trips). */
export function sanitizeCalendarPrefs(raw: unknown): CalendarPrefs {
  const d = DEFAULT_CALENDAR_PREFS;
  const parsed = calendarPrefsShape.safeParse(raw);
  if (!parsed.success) return { ...d };
  const o = parsed.data;
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
  const showWeekends = typeof o.showWeekends === "boolean" ? o.showWeekends : d.showWeekends;
  const hiddenAccountIds = Array.isArray(o.hiddenAccountIds)
    ? o.hiddenAccountIds.filter((v): v is string => typeof v === "string")
    : [];
  const accountColors: Record<string, string> = {};
  if (o.accountColors && typeof o.accountColors === "object") {
    for (const [k, v] of Object.entries(o.accountColors as Record<string, unknown>)) {
      if (typeof v === "string") accountColors[k] = v;
    }
  }
  return {
    workStartMinute,
    workEndMinute,
    weekStartsOn,
    showWeekends,
    hiddenAccountIds,
    accountColors,
  };
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
