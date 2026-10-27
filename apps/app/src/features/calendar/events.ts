// Calendar event + account models (the Wave-2 shapes over the extended
// calendar_events table) and the pure occurrence selectors that put event
// chips on the grid. Mirrors the lens: selectors in, chips out, no state.

import type { CalendarItemKind, ConferenceProvider } from "@contracts/vocabularies";

import { type LabelColor, normalizeLabelColor } from "../../components/tag-colors";
import type { Truncation } from "../../lib/paged-select";
import { formatTime } from "../../lib/time-format";
import { addDays, localDayKey, startOfLocalDay, type VisibleRange } from "./lens";
import { expandEventOccurrences } from "./recurrence-expand";

export type CalendarEventModel = {
  id: string;
  workspaceId: string | null;
  ownerId: string | null;
  /** Null = native Moduo event (writable); set = mirrored external (read-only). */
  sourceAccountId: string | null;
  externalEventId: string | null;
  calendarId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  rrule: string | null;
  status: string;
  /** The place. Before CALR-6 a booking's join URL sat here; now it moves to `conferenceUrl`. */
  location?: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  // ── Event data v2 (CALR-6). Optional: many fixtures build the model without them.
  /** The calendars row the event is on (null = not resolved yet). */
  calendarRef?: string | null;
  isPrivate?: boolean;
  /** The meeting link, kept apart from the place. */
  conferenceUrl?: string | null;
  conferenceProvider?: ConferenceProvider | null;
  kind?: CalendarItemKind;
  /** The task focus time is for (kind "focus" only). */
  focusTaskId?: string | null;
  attendees?: CalendarAttendee[];
};

/** One person on an event, as calendar_op_event_create/update store them. */
export type CalendarAttendee = {
  email: string;
  name: string;
  /** Google's response status words ("needsAction", "accepted", …). */
  status: string;
};

/** A person as the create/update ops take them: name and status are optional. */
export type CalendarAttendeeInput = { email: string; name?: string; status?: string };

export type CalendarAccountModel = {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  provider: string;
  externalId: string;
  displayLabel: string;
  isDefaultTarget: boolean;
  color: string | null;
  lastSyncAt: string | null;
  status: string;
  /** CAL-8: the CalDAV/ICS connection descriptor JSON (see `CalendarSyncDescriptor` in sync.ts); null for OAuth/native rows. */
  syncToken: string | null;
  deletedAt: string | null;
};

export function isNativeEvent(e: Pick<CalendarEventModel, "sourceAccountId">): boolean {
  return e.sourceAccountId === null;
}

/** The page's one-shot load. `degraded` = calendar tables unreachable (the
 * deploy-gap posture: the page still works as a task-lens calendar). */
export type CalendarModuleBundle = {
  events: CalendarEventModel[];
  accounts: CalendarAccountModel[];
  degraded: boolean;
  /** Collections cut at their read ceiling (SCALE-1) — empty = complete. */
  truncated: Truncation[];
};

/** Only-present keys apply (the contacts_op_set_details pattern). */
export type CalendarEventPatch = {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  /** null clears the recurrence (one-off again). */
  rrule?: string | null;
  // ── Event data v2 (CALR-6)
  /** The calendars row id to move the event to; null = back to your Moduo calendar. */
  calendarId?: string | null;
  location?: string | null;
  /** Replaces the people as a whole. */
  attendees?: CalendarAttendeeInput[];
  /** null removes the link and its provider. */
  conferenceUrl?: string | null;
  /** Omit to read it from the link. */
  conferenceProvider?: ConferenceProvider | null;
  isPrivate?: boolean;
  /** "hold" is refused (holds come from offers); leaving "focus" lets the task go. */
  kind?: CalendarItemKind;
  focusTaskId?: string | null;
};

/** One provider event as the desktop sync engine hands it to the mirror op. */
export type CalendarMirrorEventInput = {
  externalEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  rrule?: string | null;
  status?: string;
  description?: string;
  calendarId?: string;
  /** The place. Sent only when the provider has one. */
  location?: string;
  /** The provider's meeting link (CALR-6). Sent only when there is one; absent keeps the stored link. */
  conferenceUrl?: string | null;
};

/** One rendered occurrence of an event (recurring events yield several). */
export type EventChip = {
  eventId: string;
  /** Unique per occurrence — the React key + selection id. */
  occurrenceKey: string;
  title: string;
  startMs: number;
  endMs: number;
  dayKey: string;
  allDay: boolean;
  external: boolean;
  recurring: boolean;
  /** The mirrored account this chip belongs to (null = native Moduo) — the
   * grid resolves its hue from this for external attribution (CAL-6). */
  sourceAccountId: string | null;
  /** The event's own stored color (a label name for native events). */
  color: string | null;
  /** An overnight piece: the event began on an earlier day (its start), or
   * goes on into a later one (its end). Null when it starts / ends today. */
  continuesFromMs: number | null;
  continuesToMs: number | null;
};

/** The calendar hue an event chip takes (AC7): a mirrored event its
 * account's, a native one its own stored label (Your calendar is gray). */
export function eventHue(
  chip: Pick<EventChip, "sourceAccountId" | "color">,
  accountHues: Record<string, string>,
): LabelColor {
  return normalizeLabelColor(chip.sourceAccountId ? accountHues[chip.sourceAccountId] : chip.color);
}

/** "→ Thu 7:10" on the first day of an overnight event, "from Wed 22:40" on
 * the next; null for an event that starts and ends on its day (AC9). */
export function continuationLabel(
  chip: Pick<EventChip, "continuesFromMs" | "continuesToMs">,
  time: (ms: number) => string = formatTime,
): string | null {
  const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "short" });
  if (chip.continuesFromMs != null)
    return `from ${day(chip.continuesFromMs)} ${time(chip.continuesFromMs)}`;
  if (chip.continuesToMs != null) return `→ ${day(chip.continuesToMs)} ${time(chip.continuesToMs)}`;
  return null;
}

export type EventChipsByDay = {
  /** Timed chips per local day (an overnight event has a piece on each day). */
  timed: Map<string, EventChip[]>;
  /** All-day chips per local day — one chip per covered day. */
  allDay: Map<string, EventChip[]>;
};

function push(map: Map<string, EventChip[]>, key: string, chip: EventChip) {
  const list = map.get(key);
  if (list) list.push(chip);
  else map.set(key, [chip]);
}

/**
 * Expand visible events (recurrence included) into per-day chips. Cancelled
 * and deleted events never render; a hidden weekend day simply has no column
 * so its key is never read.
 */
type ChipBase = Omit<EventChip, "dayKey">;

function occurrenceChip(
  event: CalendarEventModel,
  occ: { startMs: number; endMs: number },
): ChipBase {
  return {
    eventId: event.id,
    occurrenceKey: `${event.id}:${occ.startMs}`,
    title: event.title,
    startMs: occ.startMs,
    endMs: occ.endMs,
    allDay: event.allDay,
    external: !isNativeEvent(event),
    recurring: Boolean(event.rrule),
    sourceAccountId: event.sourceAccountId,
    color: event.color,
    continuesFromMs: null,
    continuesToMs: null,
  };
}

/** One all-day chip per covered local day, END-EXCLUSIVE on exact midnights
 * (a native 1-day event = [Jul 2 00:00, Jul 3 00:00) → Jul 2 only). Provider
 * all-day events arriving as UTC midnights still spill a day east of UTC —
 * CAL-6's mirror mapper normalizes them to local dates. */
function pushAllDayPieces(into: Map<string, EventChip[]>, base: ChipBase, range: VisibleRange) {
  const lastCovered = startOfLocalDay(new Date(Math.min(base.endMs - 1, range.endMs - 1)));
  let day = startOfLocalDay(new Date(Math.max(base.startMs, range.startMs)));
  while (day.getTime() <= lastCovered.getTime()) {
    push(into, localDayKey(day), { ...base, dayKey: localDayKey(day) });
    day = addDays(day, 1);
  }
}

/** One timed piece per local day the event touches (overnight events cross
 * midnight, AC9), end-exclusive so an event ending at midnight stays on its
 * day. Each piece keeps the occurrence's own start and end. */
function pushTimedPieces(into: Map<string, EventChip[]>, base: ChipBase, range: VisibleRange) {
  const from = Math.max(base.startMs, range.startMs);
  const lastDay = startOfLocalDay(new Date(Math.max(from, Math.min(base.endMs, range.endMs) - 1)));
  let day = startOfLocalDay(new Date(from));
  while (day.getTime() <= lastDay.getTime()) {
    const next = addDays(day, 1);
    const dayKey = localDayKey(day);
    push(into, dayKey, {
      ...base,
      dayKey,
      continuesFromMs: base.startMs < day.getTime() ? base.startMs : null,
      continuesToMs: base.endMs > next.getTime() ? base.endMs : null,
    });
    day = next;
  }
}

export function eventChipsInRange(
  events: CalendarEventModel[],
  range: VisibleRange,
): EventChipsByDay {
  const timed = new Map<string, EventChip[]>();
  const allDay = new Map<string, EventChip[]>();
  for (const event of events) {
    if (event.deletedAt) continue;
    if (event.status === "cancelled") continue;
    const occurrences = expandEventOccurrences(
      { id: event.id, startsAt: event.startsAt, endsAt: event.endsAt, rrule: event.rrule },
      range.startMs,
      range.endMs,
    );
    for (const occ of occurrences) {
      const base = occurrenceChip(event, occ);
      if (event.allDay) pushAllDayPieces(allDay, base, range);
      else pushTimedPieces(timed, base, range);
    }
  }
  for (const list of timed.values()) list.sort((a, b) => a.startMs - b.startMs);
  for (const list of allDay.values()) list.sort((a, b) => a.startMs - b.startMs);
  return { timed, allDay };
}
