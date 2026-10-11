// Host-side booking link. Guest name and email are always collected; everything
// else is chosen while setting the link up.

import type { VideoSetting } from "./video";

export type GuestQuestion = {
  id: string;
  label: string;
  required: boolean;
};

export type BookingLink = {
  id: string;
  slotId: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  horizonDays: number;
  minNoticeMinutes: number;
  hostTimeZone: string;
  weeklyHours: unknown;
  busyCalendarIds: string[];
  noteEnabled: boolean;
  guestsEnabled: boolean;
  questions: GuestQuestion[];
  paused: boolean;
  videoProvider: VideoSetting;
};

export function newQuestionId(): string {
  return crypto.randomUUID();
}

export function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "meet"}-${suffix}`;
}

export function questionsFromJson(raw: unknown): GuestQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: GuestQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; label?: unknown; required?: unknown };
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    out.push({
      id: typeof row.id === "string" && row.id ? row.id : newQuestionId(),
      label,
      required: row.required === true,
    });
  }
  return out;
}

/**
 * The busy list's pseudo-calendar for work sessions from Tasks (TV-D10,
 * default d): with it, the host's scheduled sessions block slots. Guests see
 * only that a time is taken, never the task.
 */
export const TASKS_BUSY_ID = "tasks";

/** A new link's busy list: Moduo's calendar and your work sessions. */
export const DEFAULT_BUSY_IDS: readonly string[] = ["moduo", TASKS_BUSY_ID];

export function busyIdsFromJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_BUSY_IDS];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}
