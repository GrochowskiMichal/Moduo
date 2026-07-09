// DB-6 — pure countdown math + <input type="datetime-local"> ↔ ISO conversion.
// No React, so it's unit-testable; the widget ticks and renders.

export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  isComplete: boolean;
};

export function computeCountdown(nowMs: number, targetMs: number): CountdownParts {
  const diff = targetMs - nowMs;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, isComplete: true };
  }
  const totalSec = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    totalMs: diff,
    isComplete: false,
  };
}

/** Parse a local `datetime-local` value ('YYYY-MM-DDTHH:MM') to epoch ms (local). */
export function parseLocalDateTime(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback.getTime();
}

/** Format an ISO string as a local `datetime-local` value (for the input). */
export function toDateTimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
