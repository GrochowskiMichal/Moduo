// The CalDAV/ICS → mirror mapper (CAL-8, AC17). The desktop engine fetches raw
// ICS resource strings (one VCALENDAR per CalDAV resource, or one whole feed);
// this pure layer parses them with ical.js and normalizes VEVENTs to the same
// `CalendarMirrorEventInput` shape the Google/Outlook mappers produce.
//
// Two deliberate postures (spec assumptions 15–16):
//
// 1. **Recurrences expand HERE, at sync time, into occurrence rows** — id
//    `uid::occurrenceStartISO`, `rrule: null` — within the sync window. ical.js
//    applies EXDATE and RECURRENCE-ID overrides correctly, so a moved occurrence
//    renders once at its moved time (better than the Graph best-effort), and the
//    mirror needs no exception storage. This matches what Google already mirrors
//    (its fetch uses `singleEvents=true`). The account-wide deletion diff
//    tombstones rows that leave the window — identical to the Google path.
//
// 2. **Timezones never guess** (the Graph posture, extended): a TZID resolves
//    from the resource's own VTIMEZONE; a bare TZID that is a valid IANA name
//    converts via an Intl fallback; anything else DROPS the event — a missing
//    chip beats a wrong-slot one. All-day (VALUE=DATE) lands on LOCAL midnight
//    (date-only parsed as UTC would spill a day east of UTC); DTEND stays
//    end-exclusive like the Google date path. Floating times render as local
//    wall time (the same posture native events use).

import ICAL from "ical.js";

import type { CalendarMirrorEventInput } from "./events";
import type { RawProviderEvent } from "./mirror";

/** Hard caps so a pathological rule can't wedge a sync. */
const MAX_ITERATIONS_PER_EVENT = 10_000;
const MAX_OCCURRENCES_PER_EVENT = 1_000;

// ── timezone helpers ──────────────────────────────────────────────────────────

// A calendar references only a handful of distinct zones, but a recurring
// expansion converts start+end per occurrence — so build each zone's Intl
// formatter once and reuse it (the repo's cached-formatter posture, CAL-1).
const OFFSET_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
const IANA_VALID_CACHE = new Map<string, boolean>();

/** True when `Intl` can resolve the zone (a usable IANA name). Memoized. */
export function isValidIanaZone(tzid: string): boolean {
  const cached = IANA_VALID_CACHE.get(tzid);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tzid });
    ok = true;
  } catch {
    ok = false;
  }
  IANA_VALID_CACHE.set(tzid, ok);
  return ok;
}

/** The zone's UTC offset (ms) at a given instant, via a cached Intl formatter. */
function zoneOffsetAt(instant: Date, timeZone: string): number {
  let dtf = OFFSET_FMT_CACHE.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    OFFSET_FMT_CACHE.set(timeZone, dtf);
  }
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in an IANA zone to the real instant (two-pass so a
 * DST boundary resolves to the post-transition offset, never a wrong hour).
 */
export function wallTimeToInstant(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date | null {
  if (!isValidIanaZone(timeZone)) return null;
  const utcGuess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  if (!Number.isFinite(utcGuess)) return null;
  const first = zoneOffsetAt(new Date(utcGuess), timeZone);
  let ts = utcGuess - first;
  const second = zoneOffsetAt(new Date(ts), timeZone);
  if (second !== first) ts = utcGuess - second;
  return new Date(ts);
}

/**
 * The event's zone fallback plan, from the DTSTART/DTEND TZID params:
 * - no TZID, or a TZID backed by a registered VTIMEZONE → ical.js converts;
 * - a bare TZID that is a valid IANA name → we convert via Intl;
 * - anything else → drop the event (never silently shift).
 */
function zoneFallbackFor(
  vevent: ICAL.Component,
): { ok: true; iana: string | null } | { ok: false } {
  for (const propName of ["dtstart", "dtend"] as const) {
    const prop = vevent.getFirstProperty(propName);
    const tzid = prop?.getParameter("tzid");
    if (typeof tzid !== "string" || tzid.length === 0) continue;
    if (ICAL.TimezoneService.has(tzid)) continue; // VTIMEZONE-backed
    if (isValidIanaZone(tzid)) return { ok: true, iana: tzid };
    return { ok: false };
  }
  return { ok: true, iana: null };
}

/** ICAL.Time → ISO instant (or local-midnight ISO for date-only values). */
function timeToIso(t: ICAL.Time, fallbackIana: string | null): string | null {
  if (t.isDate) {
    const d = new Date(t.year, t.month - 1, t.day);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // An unregistered-but-valid-IANA TZID parses with a FLOATING zone (while
  // `t.timezone` still echoes the raw TZID param) — its wall fields are the
  // zone's wall clock, so convert them through the zone ourselves.
  const zoneTzid = (t.zone as { tzid?: string } | null)?.tzid ?? "floating";
  if (zoneTzid === "floating" && fallbackIana) {
    const d = wallTimeToInstant(
      {
        year: t.year,
        month: t.month,
        day: t.day,
        hour: t.hour,
        minute: t.minute,
        second: t.second,
      },
      fallbackIana,
    );
    return d ? d.toISOString() : null;
  }
  const d = t.toJSDate();
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── parsing ───────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function registerTimezones(vcal: ICAL.Component): void {
  for (const vtz of vcal.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(vtz);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) {
        ICAL.TimezoneService.register(tz);
      }
    } catch {
      // A malformed VTIMEZONE just leaves its TZID unregistered — events
      // referencing it fall through to the IANA-or-drop path.
    }
  }
}

function isCancelled(comp: ICAL.Component): boolean {
  const status = comp.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

type MapWindow = { timeMin: string; timeMax: string };

function overlapsWindow(startIso: string, endIso: string, win: MapWindow): boolean {
  return endIso >= win.timeMin && startIso <= win.timeMax;
}

/**
 * A machine-timezone-INDEPENDENT key for one occurrence slot, from the raw
 * wall fields of its ORIGINAL recurrence time — so the mirror id is stable
 * whether or not the occurrence is later moved (an override UPDATES its row in
 * place instead of tombstone+recreate) and never churns on an OS zone change.
 */
function occurrenceKey(t: ICAL.Time): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${t.year}-${p(t.month)}-${p(t.day)}`;
  return t.isDate ? date : `${date}T${p(t.hour)}:${p(t.minute)}:${p(t.second)}`;
}

function mirrorInput(args: {
  externalEventId: string;
  item: ICAL.Component;
  startIso: string;
  endIso: string;
  allDay: boolean;
  calendarId: string | undefined;
}): CalendarMirrorEventInput {
  const { externalEventId, item, startIso, endIso, allDay, calendarId } = args;
  return {
    externalEventId,
    title: str(item.getFirstPropertyValue("summary")) ?? "",
    startsAt: startIso,
    endsAt: endIso,
    allDay,
    rrule: null, // occurrences are pre-expanded — the mirror never re-expands
    status: "confirmed", // cancelled events/occurrences are skipped (diff removes)
    description: str(item.getFirstPropertyValue("description")) ?? "",
    calendarId,
  };
}

/** Resolve one event component at given start/end times, or null to drop it. */
function resolveTimes(
  comp: ICAL.Component,
  startDate: ICAL.Time | null,
  endDate: ICAL.Time | null,
): { startIso: string; endIso: string; allDay: boolean; iana: string | null } | null {
  const fallback = zoneFallbackFor(comp);
  if (!fallback.ok) return null; // unresolvable TZID — drop, never shift
  const allDay = Boolean(startDate?.isDate);
  const startIso = startDate ? timeToIso(startDate, fallback.iana) : null;
  const endIso = endDate ? timeToIso(endDate, fallback.iana) : startIso;
  if (!startIso || !endIso) return null;
  return { startIso, endIso, allDay, iana: fallback.iana };
}

/**
 * Map every VEVENT in one VCALENDAR text. Throws on input that is not a
 * parseable VCALENDAR (a valid-but-empty calendar returns []), so a fetch that
 * hands back an HTML error page under a 200 is a hard failure the caller can
 * see rather than an empty result that would look like "all events deleted".
 */
function mapCalendarText(
  ics: string,
  win: MapWindow,
  calendarId: string | undefined,
): CalendarMirrorEventInput[] {
  const vcal = new ICAL.Component(ICAL.parse(ics));
  if (vcal.name !== "vcalendar") {
    throw new Error(`ics_not_a_vcalendar:${vcal.name}`);
  }
  registerTimezones(vcal);

  const vevents = vcal.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const comp of vevents) {
    try {
      const ev = new ICAL.Event(comp);
      if (!ev.uid) continue;
      if (ev.recurrenceId) exceptions.push(ev);
      else masters.set(ev.uid, ev);
    } catch {
      // one malformed VEVENT never wedges the resource
    }
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) {
      try {
        master.relateException(ex);
      } catch {
        // fall through to the standalone exception pass below
      }
    }
  }

  const out: CalendarMirrorEventInput[] = [];
  // Ids are keyed by the occurrence's ORIGINAL slot (recurrence-id), so a
  // moved override and its base occurrence never collide, and the same slot
  // emitted twice (master loop + backward-moved-override pass) is deduped.
  const seen = new Set<string>();

  const emit = (
    id: string,
    comp: ICAL.Component,
    times: {
      startIso: string;
      endIso: string;
      allDay: boolean;
    },
  ) => {
    if (seen.has(id)) return;
    if (!overlapsWindow(times.startIso, times.endIso, win)) return;
    seen.add(id);
    out.push(
      mirrorInput({
        externalEventId: id,
        item: comp,
        startIso: times.startIso,
        endIso: times.endIso,
        allDay: times.allDay,
        calendarId,
      }),
    );
  };

  for (const master of masters.values()) {
    if (isCancelled(master.component)) continue;
    try {
      if (!master.isRecurring()) {
        const times = resolveTimes(master.component, master.startDate, master.endDate);
        if (times) emit(master.uid, master.component, times);
        continue;
      }

      const iterator = master.iterator();
      let iterations = 0;
      let emitted = 0;
      let next: ICAL.Time | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: iterator-drain idiom (body uses continue/break)
      while ((next = iterator.next() ?? null)) {
        if (++iterations > MAX_ITERATIONS_PER_EVENT) break;
        if (emitted >= MAX_OCCURRENCES_PER_EVENT) break;
        // Occurrence STARTS are monotonic, so once the original slot passes the
        // window the regular series is done. Backward-MOVED overrides (original
        // beyond the window, moved back into it) are caught by the pass below.
        if (occurrenceKey(next) > isoToKey(win.timeMax)) break;
        let occ: ReturnType<ICAL.Event["getOccurrenceDetails"]>;
        try {
          occ = master.getOccurrenceDetails(next);
        } catch {
          continue; // one bad occurrence never wedges the series
        }
        const item = occ.item?.component ?? master.component;
        if (isCancelled(item)) continue;
        const times = resolveTimes(item, occ.startDate ?? null, occ.endDate ?? null);
        if (!times) continue;
        emit(`${master.uid}::${occurrenceKey(next)}`, item, times);
        emitted += 1;
      }
    } catch {
      // one malformed series never wedges the resource
    }
  }

  // Overrides (RECURRENCE-ID rows), keyed by their ORIGINAL slot. In-window
  // ones the master loop already emitted are deduped; this pass exists for the
  // override moved BACKWARD into the window from an original slot past the
  // break, and for orphan overrides whose master isn't in the fetched set.
  for (const ex of exceptions) {
    if (isCancelled(ex.component) || !ex.recurrenceId) continue;
    const times = resolveTimes(ex.component, ex.startDate, ex.endDate);
    if (times) emit(`${ex.uid}::${occurrenceKey(ex.recurrenceId)}`, ex.component, times);
  }

  return out;
}

/** The window bound's occurrence-key form, for the monotonic break compare. */
function isoToKey(iso: string): string {
  // "2026-10-29T00:00:00.000Z" → "2026-10-29T00:00:00" (drop ms + Z); a
  // date-only key ("2026-10-29") sorts before any same-day timed key, which is
  // the safe side for an inclusive upper bound.
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]}T${m[2]}` : iso;
}

// ── the batch entry point (what the sync orchestrator calls) ──────────────────

/**
 * Map raw ICS resources (`[{ ics, calendarId? }]` from the Tauri engine —
 * one entry per CalDAV resource, or one entry holding a whole ICS feed) to
 * mirror inputs. The global ical.js TimezoneService is reset around EACH
 * resource so one resource's VTIMEZONE definitions can't shadow another's
 * same-named-but-different zone.
 *
 * Failure posture (the anti-data-loss rule): one bad resource in a multi-
 * resource CalDAV batch is isolated, BUT if NOTHING parsed as a VCALENDAR while
 * there was real input (the "server returned an HTML error page under a 200"
 * case), we THROW — so the sync loop flips the account to `error` and keeps the
 * last mirror, instead of diffing against `[]` and tombstoning every event.
 */
export function mapIcsEvents(raws: RawProviderEvent[], win: MapWindow): CalendarMirrorEventInput[] {
  const out: CalendarMirrorEventInput[] = [];
  let nonEmptyResources = 0;
  let parsedResources = 0;
  try {
    for (const raw of raws) {
      const ics = str(raw.ics);
      if (!ics) continue;
      nonEmptyResources += 1;
      const calendarId = str(raw.calendarId) ?? undefined;
      try {
        out.push(...mapCalendarText(ics, win, calendarId));
        parsedResources += 1;
      } catch {
        // per-resource isolation
      } finally {
        ICAL.TimezoneService.reset();
      }
    }
  } catch {
    ICAL.TimezoneService.reset();
  }
  if (nonEmptyResources > 0 && parsedResources === 0) {
    // Every resource we were handed failed to parse — the fetch is untrust-
    // worthy (bad body / captive portal). Don't let it read as "0 events".
    throw new Error("ics_fetch_unparseable");
  }
  return out;
}

/** The feed's display name (X-WR-CALNAME), for the Add-ICS-feed default label. */
export function icsCalendarName(ics: string): string | null {
  try {
    const vcal = new ICAL.Component(ICAL.parse(ics));
    return str(vcal.getFirstPropertyValue("x-wr-calname"));
  } catch {
    return null;
  }
}
