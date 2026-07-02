// Calendar event + account models (the Wave-2 shapes over the extended
// calendar_events table) and the pure occurrence selectors that put event
// chips on the grid. Mirrors the lens: selectors in, chips out, no state.

import { localDayKey, addDays, startOfLocalDay, type VisibleRange } from "./lens";
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
  color: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

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
};

export type EventChipsByDay = {
  /** Timed chips per local day (assigned to their start's day, like blocks). */
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
      const base = {
        eventId: event.id,
        occurrenceKey: `${event.id}:${occ.startMs}`,
        title: event.title,
        startMs: occ.startMs,
        endMs: occ.endMs,
        allDay: event.allDay,
        external: !isNativeEvent(event),
        recurring: Boolean(event.rrule),
      };
      if (event.allDay) {
        // One chip per covered local day, END-EXCLUSIVE on exact midnights
        // (a native 1-day event = [Jul 2 00:00, Jul 3 00:00) → Jul 2 only).
        // Provider all-day events arriving as UTC midnights still spill a day
        // east of UTC — CAL-6's mirror mapper normalizes them to local dates.
        const lastCovered = startOfLocalDay(
          new Date(Math.min(occ.endMs - 1, range.endMs - 1)),
        );
        let day = startOfLocalDay(new Date(Math.max(occ.startMs, range.startMs)));
        while (day.getTime() <= lastCovered.getTime()) {
          push(allDay, localDayKey(day), { ...base, dayKey: localDayKey(day) });
          day = addDays(day, 1);
        }
      } else {
        const dayKey = localDayKey(new Date(occ.startMs));
        push(timed, dayKey, { ...base, dayKey });
      }
    }
  }
  for (const list of timed.values()) list.sort((a, b) => a.startMs - b.startMs);
  for (const list of allDay.values()) list.sort((a, b) => a.startMs - b.startMs);
  return { timed, allDay };
}
