// The provider→mirror mapper (CAL-6, AC12). The desktop sync engine fetches raw
// Google / Microsoft-Graph events; this pure layer normalizes them to the
// `CalendarMirrorEventInput` shape the `calendar_op_mirror_events` op takes,
// so the web (and desktop) render one Supabase-owned truth. Keeping it pure +
// tested is the AC12 proof; the op is idempotent by (account, external id), so
// re-syncing updates and never duplicates.
//
// All-day normalization (the events.ts note): a provider all-day carries a
// date-only ("2026-07-02"), which naively parsed as UTC midnight spills a day
// east of UTC. We resolve it to LOCAL midnight so the grid's local-day math
// lands it on the right column.

import type { CalendarMirrorEventInput } from "./events";
import { googleMeetingLink, graphMeetingLink } from "./meeting-link";

/** Loosely-typed provider JSON — we read only the fields we normalize. */
export type RawProviderEvent = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** ISO instant for LOCAL midnight of a YYYY-MM-DD date-only value (all-day). */
export function localMidnightIso(dateOnly: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalize any ISO-ish instant to a canonical ISO string; null if unparseable. */
function instantIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Graph's UTC zone aliases — the only naive zone we can normalize losslessly. */
function isUtcZone(tz: string | null): boolean {
  if (!tz) return true; // absent → the desktop sync's UTC contract
  const t = tz.toLowerCase();
  return t === "utc" || t === "etc/utc" || t === "coordinated universal time";
}

/**
 * A Microsoft-Graph timed instant. Graph returns a NAIVE wall value (no offset)
 * beside a `timeZone` field; the desktop sync engine requests events in UTC
 * (`Prefer: outlook.timezone="UTC"`), so a naive value is UTC — append `Z`.
 * Values with an explicit offset/`Z` parse as-is. A naive value tagged with a
 * NON-UTC zone means the UTC contract was broken upstream: rather than emit an
 * 8-hour-wrong instant, we DROP the event (Graph uses Windows zone names, which
 * `Intl` can't resolve here) — a missing chip beats a wrong-slot one. In
 * practice this branch never fires because our own sync sets the header.
 */
function graphTimedInstant(v: unknown, timeZone: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  if (hasZone) return instantIso(s);
  if (!isUtcZone(str(timeZone))) return null; // contract violated — drop, don't lie
  return instantIso(`${s}Z`);
}

/** Provider status → the two the op keeps: 'confirmed' | 'cancelled'. */
function normalizeStatus(raw: string | null): "confirmed" | "cancelled" {
  return raw === "cancelled" ? "cancelled" : "confirmed";
}

// KNOWN GAP (v1 = series edits, spec §7c): a cancelled SINGLE OCCURRENCE of a
// recurring series often arrives with no start/end (just an originalStartTime),
// so it maps to null and its tombstone never reaches the op — that one instance
// keeps rendering. Acceptable at alpha; a per-occurrence exception tombstone is
// a follow-up (needs the op to accept occurrence keys).

/** Only send `location` when there is one, so the sync never clears it by accident. */
function withLocation(value: string | null): { location?: string } {
  return value ? { location: value } : {};
}

// ── Google Calendar API v3 event → mirror input ──────────────────────────────

/**
 * Map one Google event. Returns null when it lacks an id or resolvable times.
 * Google `recurrence` is an array of RFC-5545 lines — we take the RRULE line.
 * All-day events use `start.date`/`end.date` (date-only); timed use `dateTime`.
 */
export function mapGoogleEvent(raw: RawProviderEvent): CalendarMirrorEventInput | null {
  const externalEventId = str(raw.id);
  if (!externalEventId) return null;

  const start = (raw.start ?? {}) as Record<string, unknown>;
  const end = (raw.end ?? {}) as Record<string, unknown>;
  const startDate = str(start.date);
  const endDate = str(end.date);
  const allDay = Boolean(startDate);

  const startsAt = allDay
    ? startDate
      ? localMidnightIso(startDate)
      : null
    : instantIso(start.dateTime);
  const endsAt = allDay ? (endDate ? localMidnightIso(endDate) : null) : instantIso(end.dateTime);
  if (!startsAt || !endsAt) return null;

  const recurrence = Array.isArray(raw.recurrence) ? (raw.recurrence as unknown[]) : [];
  const rruleLine = recurrence
    .map((l) => (typeof l === "string" ? l : ""))
    .find((l) => l.toUpperCase().startsWith("RRULE:"));
  const rrule = rruleLine ? rruleLine.slice("RRULE:".length).trim() || null : null;

  return {
    externalEventId,
    title: str(raw.summary) ?? "",
    startsAt,
    endsAt,
    allDay,
    rrule,
    status: normalizeStatus(str(raw.status)),
    description: str(raw.description) ?? "",
    calendarId: str(raw.calendarId) ?? undefined,
    ...withLocation(googleMeetingLink(raw)),
  };
}

// ── Microsoft Graph event → mirror input ─────────────────────────────────────

/** Graph recurrence patterns → a best-effort RRULE; null for unsupported ones. */
function graphRecurrenceToRrule(recurrence: unknown): string | null {
  if (!recurrence || typeof recurrence !== "object") return null;
  const pattern = (recurrence as Record<string, unknown>).pattern as
    | Record<string, unknown>
    | undefined;
  if (!pattern) return null;
  const type = str(pattern.type)?.toLowerCase();
  const interval = typeof pattern.interval === "number" ? pattern.interval : 1;
  const intervalPart = interval > 1 ? `;INTERVAL=${interval}` : "";
  const DAYS: Record<string, string> = {
    sunday: "SU",
    monday: "MO",
    tuesday: "TU",
    wednesday: "WE",
    thursday: "TH",
    friday: "FR",
    saturday: "SA",
  };
  const byday = Array.isArray(pattern.daysOfWeek)
    ? (pattern.daysOfWeek as unknown[])
        .map((d) => DAYS[str(d)?.toLowerCase() ?? ""] ?? "")
        .filter(Boolean)
        .join(",")
    : "";
  switch (type) {
    case "daily":
      return `FREQ=DAILY${intervalPart}`;
    case "weekly":
      return `FREQ=WEEKLY${intervalPart}${byday ? `;BYDAY=${byday}` : ""}`;
    case "absolutemonthly":
    case "relativemonthly":
      return `FREQ=MONTHLY${intervalPart}`;
    case "absoluteyearly":
    case "relativeyearly":
      return `FREQ=YEARLY${intervalPart}`;
    default:
      return null; // unsupported → render as a single occurrence
  }
}

/** Map one Microsoft-Graph event. Returns null without an id or times. */
export function mapOutlookEvent(raw: RawProviderEvent): CalendarMirrorEventInput | null {
  const externalEventId = str(raw.id);
  if (!externalEventId) return null;

  const start = (raw.start ?? {}) as Record<string, unknown>;
  const end = (raw.end ?? {}) as Record<string, unknown>;
  const allDay = raw.isAllDay === true;

  // Graph timed events carry a naive dateTime + a timeZone; all-day ones are
  // date-midnight in the account zone. We normalize the wall value to local.
  const startsAt = allDay
    ? localMidnightIso(str(start.dateTime) ?? "")
    : graphTimedInstant(start.dateTime, start.timeZone);
  const endsAt = allDay
    ? localMidnightIso(str(end.dateTime) ?? "")
    : graphTimedInstant(end.dateTime, end.timeZone);
  if (!startsAt || !endsAt) return null;

  const cancelled = raw.isCancelled === true;

  return {
    externalEventId,
    title: str(raw.subject) ?? "",
    startsAt,
    endsAt,
    allDay,
    rrule: graphRecurrenceToRrule(raw.recurrence),
    status: cancelled ? "cancelled" : "confirmed",
    description: str(raw.bodyPreview) ?? "",
    calendarId: str(raw.calendarId) ?? undefined,
    ...withLocation(graphMeetingLink(raw)),
  };
}

// ── batch mapping (what the sync orchestrator calls) ─────────────────────────

export type CalendarProviderKind = "google" | "microsoft";

/** Map a provider's fetched events, dropping any that can't be normalized. */
export function mapProviderEvents(
  provider: CalendarProviderKind,
  raws: RawProviderEvent[],
): CalendarMirrorEventInput[] {
  const map = provider === "google" ? mapGoogleEvent : mapOutlookEvent;
  const out: CalendarMirrorEventInput[] = [];
  for (const raw of raws) {
    const mapped = map(raw);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * The external ids that were mirrored before but the provider no longer returns
 * (a full-sync diff) — the op tombstones these. Cancelled events already carry
 * status='cancelled' via the mapper, so this is only for vanished events.
 */
export function deletedExternalIds(
  previouslyMirrored: string[],
  stillPresent: Iterable<string>,
): string[] {
  const present = new Set(stillPresent);
  return previouslyMirrored.filter((id) => !present.has(id));
}
