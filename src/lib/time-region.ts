// Time & region (TV-D14, spec §14, REPLAN 76): one personal setting every
// module reads.
//
//   * Time zone: the clock the person's day runs on. The server keeps it
//     (`user_preferences.time_zone`): a repeat rolls over at its midnight,
//     reminders and due times are read in it, the time report dates entries
//     in it, and the app's repeat engine previews in it (`engineZone`).
//     Clocks on screen stay the device's own (decision D14-2): every date in
//     the app is a device-local day, so moving only some of them would put
//     due dates on the wrong day.
//   * Week start, 12/24-hour clock, date order: how dates read everywhere
//     (`time-format.ts` reads them). NULL = the device's.
//   * When the device's zone isn't the saved one, a quiet prompt asks once
//     per zone and device: "Your computer is on New York time now…".
//
// The saved values live on the server, written by `user_op_set_time_region`
// and read by `user_time_region` (never a synced prefs domain: a prefs push
// would carry a stale copy over them). This module holds the current copy
// (cached per person in localStorage for the first paint) and notifies its
// readers; `syncTimeRegion` runs at every sign-in.

import { requireRow, timeRegionRowSchema } from "@contracts/rows";
import type { DateOrder, HourCycle } from "@contracts/vocabularies";
import { useSyncExternalStore } from "react";

import { deviceTimeZone } from "./device-time-zone";

/** What the server keeps for a person. NULL = follow the device. */
export type TimeRegion = {
  timeZone: string | null;
  /** The zone is the person's (picked, answered, or adopted at sign-in). */
  timeZoneManual: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: number | null;
  hourCycle: HourCycle | null;
  dateOrder: DateOrder | null;
  /** "Share your tracked time with the workspace owner" (REPLAN 75). */
  shareTimeWithOwner: boolean;
};

/** A change to send: only the keys present change; null = the device's. */
export type TimeRegionPatch = {
  timeZone?: string;
  weekStart?: number | null;
  hourCycle?: HourCycle | null;
  dateOrder?: DateOrder | null;
  shareTimeWithOwner?: boolean;
};

/** What every reader uses: the saved values with the device's filled in. */
export type ResolvedTimeRegion = {
  /** The saved zone, else this device's, else UTC. */
  timeZone: string;
  /** This device's zone (what clocks on screen show), or null when unknown. */
  deviceZone: string | null;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour12: boolean;
  dateOrder: DateOrder;
};

export const EMPTY_TIME_REGION: TimeRegion = {
  timeZone: null,
  timeZoneManual: false,
  weekStart: null,
  hourCycle: null,
  dateOrder: null,
  shareTimeWithOwner: false,
};

// ── Rows ──────────────────────────────────────────────────────────────────────

/** Map what `user_time_region` / `user_op_set_time_region` answer. */
export function timeRegionRowToModel(raw: unknown): TimeRegion {
  const r = requireRow(timeRegionRowSchema, raw, "time region");
  return {
    timeZone: r.time_zone ?? null,
    timeZoneManual: r.time_zone_manual === true,
    weekStart: r.week_start ?? null,
    hourCycle: r.hour_cycle ?? null,
    dateOrder: r.date_order ?? null,
    shareTimeWithOwner: r.share_time_with_owner === true,
  };
}

/** The op's patch: only the keys the change carries. */
export function timeRegionPatchToRow(patch: TimeRegionPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.timeZone !== undefined) out.time_zone = patch.timeZone;
  if (patch.weekStart !== undefined) out.week_start = patch.weekStart;
  if (patch.hourCycle !== undefined) out.hour_cycle = patch.hourCycle;
  if (patch.dateOrder !== undefined) out.date_order = patch.dateOrder;
  if (patch.shareTimeWithOwner !== undefined) out.share_time_with_owner = patch.shareTimeWithOwner;
  return out;
}

// ── The device's defaults ─────────────────────────────────────────────────────

type WeekInfoLocale = Intl.Locale & {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
};

/** The device locale's first day of the week (0 = Sunday), Monday if unknown. */
export function deviceWeekStart(locale?: string): ResolvedTimeRegion["weekStartsOn"] {
  try {
    const tag = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;
    const loc = new Intl.Locale(tag) as WeekInfoLocale;
    const info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
    const first = info?.firstDay; // 1 = Monday … 7 = Sunday
    if (typeof first === "number" && first >= 1 && first <= 7) {
      return (first % 7) as ResolvedTimeRegion["weekStartsOn"];
    }
  } catch {
    // An engine without week data falls through.
  }
  return 1;
}

/** Whether the device's clock is 12-hour. */
export function deviceHour12(locale?: string): boolean {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle === "h11" || cycle === "h12";
  } catch {
    return false;
  }
}

/** Whether the device writes the month before the day ("Oct 16"). */
export function deviceDateOrder(locale?: string): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).formatToParts(
      new Date(2026, 9, 16),
    );
    const month = parts.findIndex((p) => p.type === "month");
    const day = parts.findIndex((p) => p.type === "day");
    return day >= 0 && month > day ? "day_month" : "month_day";
  } catch {
    return "month_day";
  }
}

/** A zone name the browser can use, or null. */
export function usableZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The saved values with the device's filled in. Pure. */
export function resolveTimeRegion(
  saved: TimeRegion,
  device: {
    zone: string | null;
    weekStart: ResolvedTimeRegion["weekStartsOn"];
    hour12: boolean;
    dateOrder: DateOrder;
  },
): ResolvedTimeRegion {
  const week = saved.weekStart;
  return {
    timeZone: usableZone(saved.timeZone) ?? device.zone ?? "UTC",
    deviceZone: device.zone,
    weekStartsOn:
      typeof week === "number" && Number.isInteger(week) && week >= 0 && week <= 6
        ? (week as ResolvedTimeRegion["weekStartsOn"])
        : device.weekStart,
    hour12: saved.hourCycle ? saved.hourCycle === "h12" : device.hour12,
    dateOrder: saved.dateOrder ?? device.dateOrder,
  };
}

function deviceDefaults() {
  return {
    zone: deviceTimeZone(),
    weekStart: deviceWeekStart(),
    hour12: deviceHour12(),
    dateOrder: deviceDateOrder(),
  };
}

// ── The current copy ──────────────────────────────────────────────────────────

let saved: TimeRegion = { ...EMPTY_TIME_REGION };
let resolved: ResolvedTimeRegion = resolveTimeRegion(saved, deviceDefaults());
let owner: string | null = null;
const listeners = new Set<() => void>();

const cacheKey = (userId: string) => `moduo.timeRegion.${userId}`;

function emit(): void {
  for (const fn of [...listeners]) fn();
}

/** The saved values (what Settings shows). */
export function getTimeRegion(): TimeRegion {
  return saved;
}

/** What every reader uses (formats, week start, the engines' zone). */
export function getResolvedTimeRegion(): ResolvedTimeRegion {
  return resolved;
}

export function subscribeTimeRegion(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React: the resolved setting; re-renders when it changes. */
export function useTimeRegion(): ResolvedTimeRegion {
  return useSyncExternalStore(subscribeTimeRegion, getResolvedTimeRegion, getResolvedTimeRegion);
}

/** React: the saved values (Settings). */
export function useSavedTimeRegion(): TimeRegion {
  return useSyncExternalStore(subscribeTimeRegion, getTimeRegion, getTimeRegion);
}

function sanitize(raw: unknown): TimeRegion {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const week = o.weekStart;
  return {
    timeZone: typeof o.timeZone === "string" && o.timeZone ? o.timeZone : null,
    timeZoneManual: o.timeZoneManual === true,
    weekStart:
      typeof week === "number" && Number.isInteger(week) && week >= 0 && week <= 6 ? week : null,
    hourCycle: o.hourCycle === "h12" || o.hourCycle === "h23" ? o.hourCycle : null,
    dateOrder: o.dateOrder === "month_day" || o.dateOrder === "day_month" ? o.dateOrder : null,
    shareTimeWithOwner: o.shareTimeWithOwner === true,
  };
}

/** Put a copy in place for `userId` (null = signed out: back to the device's). */
export function applyTimeRegion(next: TimeRegion, userId: string | null = owner): void {
  owner = userId;
  saved = sanitize(next);
  resolved = resolveTimeRegion(saved, deviceDefaults());
  if (userId && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(cacheKey(userId), JSON.stringify(saved));
    } catch {
      // Storage full or off: the server's copy is read at every sign-in.
    }
  }
  emit();
}

/** The cached copy for a person (instant first paint), or the device's. */
export function loadCachedTimeRegion(userId: string): void {
  let cached: TimeRegion = { ...EMPTY_TIME_REGION };
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(cacheKey(userId));
      if (raw) cached = sanitize(JSON.parse(raw));
    } catch {
      // Unreadable: start from the device's.
    }
  }
  owner = userId;
  saved = cached;
  resolved = resolveTimeRegion(saved, deviceDefaults());
  emit();
}

/** Signing out: forget the person's copy on this device. */
export function forgetTimeRegion(userId: string | null): void {
  if (userId && typeof localStorage !== "undefined") {
    try {
      // The zone this device asked about stays: a sign-in again doesn't re-ask.
      localStorage.removeItem(cacheKey(userId));
    } catch {
      // Nothing to forget.
    }
  }
  owner = null;
  saved = { ...EMPTY_TIME_REGION };
  resolved = resolveTimeRegion(saved, deviceDefaults());
  emit();
}

// ── Reading and writing through the runtime ───────────────────────────────────

/** The two calls this module needs (`runtime.preferences`). */
export type TimeRegionRuntime = {
  getTimeRegion(): Promise<TimeRegion | null>;
  setTimeRegion(patch: TimeRegionPatch): Promise<TimeRegion | null>;
  /** The old sign-in write (TV-D8), used when the server has no Time & region yet. */
  setTimeZone(timeZone: string): Promise<void>;
};

/** Apply a change at once, send it, take the server's answer; on a refusal
 *  put the copy back and throw. */
export async function saveTimeRegion(
  runtime: Pick<TimeRegionRuntime, "setTimeRegion">,
  patch: TimeRegionPatch,
): Promise<TimeRegion> {
  const before = saved;
  const userId = owner;
  applyTimeRegion(
    { ...saved, ...patch, ...(patch.timeZone ? { timeZoneManual: true } : {}) },
    userId,
  );
  try {
    const answer = await runtime.setTimeRegion(patch);
    if (!answer) throw new Error("Time & region isn't available yet.");
    if (owner === userId) applyTimeRegion(answer, userId);
    return answer;
  } catch (error) {
    if (owner === userId) applyTimeRegion(before, userId);
    throw error;
  }
}

// ── Travelling ────────────────────────────────────────────────────────────────

const askedKey = (userId: string) => `moduo.timeZoneAsked.${userId}`;

/** The device zone to ask about, or null: only when it isn't the saved zone
 *  and this device hasn't asked about it yet. Pure. */
export function travelPromptZone(
  region: Pick<TimeRegion, "timeZone">,
  device: string | null,
  asked: string | null,
): string | null {
  if (!device || !region.timeZone) return null;
  if (device === region.timeZone || device === asked) return null;
  return device;
}

function readAsked(userId: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(askedKey(userId));
  } catch {
    return null;
  }
}

/** This device has asked about `zone` (or the person picked a zone here). */
export function rememberZoneAsked(userId: string, zone: string | null): void {
  if (!zone || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(askedKey(userId), zone);
  } catch {
    // Asked again next time: harmless.
  }
}

/** A zone's city, for prompts: "America/New_York" → "New York". */
export function zoneCity(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

type PromptHandler = (ask: { userId: string; deviceZone: string; savedZone: string }) => void;
let promptHandler: PromptHandler | null = null;
let pendingPrompt: Parameters<PromptHandler>[0] | null = null;

/** The app shell shows the travel prompt (a toast); one handler at a time. */
export function onTravelPrompt(handler: PromptHandler | null): void {
  promptHandler = handler;
  if (handler && pendingPrompt) {
    const ask = pendingPrompt;
    pendingPrompt = null;
    if (ask.userId === owner) handler(ask);
  }
}

const syncing = new Map<string, Promise<void>>();

/**
 * At every sign-in: show the cached copy, read the server's, and keep the
 * zone right. A zone nobody picked yet becomes this device's (as TV-D8's
 * sign-in write did); a saved zone that isn't the device's asks once. A
 * server without Time & region gets the old sign-in write.
 */
export function syncTimeRegion(runtime: TimeRegionRuntime, userId: string): Promise<void> {
  const running = syncing.get(userId);
  if (running) return running;
  const run = (async () => {
    if (owner !== userId) loadCachedTimeRegion(userId);
    const device = deviceTimeZone();
    let region: TimeRegion | null;
    try {
      region = await runtime.getTimeRegion();
    } catch {
      return; // Offline: the cached copy stands; the next sign-in reads again.
    }
    if (owner !== userId) return;
    if (!region) {
      if (device) await runtime.setTimeZone(device).catch(() => {});
      return;
    }
    applyTimeRegion(region, userId);
    if (device && (!region.timeZoneManual || !region.timeZone)) {
      rememberZoneAsked(userId, device);
      await saveTimeRegion(runtime, { timeZone: device }).catch(() => {});
      return;
    }
    const zone = travelPromptZone(region, device, readAsked(userId));
    if (!zone || !region.timeZone) return;
    rememberZoneAsked(userId, zone);
    const ask = { userId, deviceZone: zone, savedZone: region.timeZone };
    if (promptHandler) promptHandler(ask);
    else pendingPrompt = ask;
  })().finally(() => {
    syncing.delete(userId);
  });
  syncing.set(userId, run);
  return run;
}

/** Tests only. */
export function resetTimeRegionForTests(): void {
  owner = null;
  saved = { ...EMPTY_TIME_REGION };
  resolved = resolveTimeRegion(saved, deviceDefaults());
  promptHandler = null;
  pendingPrompt = null;
  syncing.clear();
  listeners.clear();
}
