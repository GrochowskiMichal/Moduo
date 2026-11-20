// Asks "This event / All events" before a change to one occurrence of a
// repeating event (CALR-11, AC44); anything that doesn't repeat writes at once.

import { useCallback, useState } from "react";

import type { CalendarEventModel, CalendarEventPatch } from "../events";
import {
  type OccurrenceChange,
  type OccurrenceScope,
  occurrenceScopeChoices,
} from "../occurrence-edit";
import { cancellationNotice } from "./calendar-delete-dialog";
import type { OccurrenceQuestion } from "./occurrence-scope-dialog";

type Pending = {
  eventId: string;
  occurrenceStartMs: number;
  change: OccurrenceChange;
  question: OccurrenceQuestion;
};

type Params = {
  eventsById: Map<string, CalendarEventModel>;
  /** `${eventId}:${startMs}` of the selected chip. */
  selectedOccurrenceKey: string | null;
  updateEvent: (eventId: string, patch: CalendarEventPatch) => Promise<void>;
  writeOccurrence: (
    eventId: string,
    occurrenceStartMs: number,
    scope: OccurrenceScope,
    change: OccurrenceChange,
  ) => Promise<void>;
  /** The plain "Delete this event?" confirm, for an event that doesn't repeat. */
  confirmDelete: (eventId: string) => void;
};

export function useOccurrenceQuestion({
  eventsById,
  selectedOccurrenceKey,
  updateEvent,
  writeOccurrence,
  confirmDelete,
}: Params) {
  const [pending, setPending] = useState<Pending | null>(null);

  /** True when it asks (the caller then leaves the write to the answer). */
  const ask = useCallback(
    (eventId: string, occurrenceStartMs: number, change: OccurrenceChange): boolean => {
      const event = eventsById.get(eventId);
      if (!event) return false;
      const choices = occurrenceScopeChoices(event, change);
      if (!choices.ask) return false;
      setPending({
        eventId,
        occurrenceStartMs,
        change,
        question: {
          action: change.kind === "delete" ? "delete" : "change",
          title: event.title,
          allEvents: choices.allEvents,
          note: change.kind === "delete" ? cancellationNotice(event) : null,
        },
      });
      return true;
    },
    [eventsById],
  );

  /** Where the selected occurrence of `event` starts (else the event's own start). */
  const occurrenceStartOf = useCallback(
    (event: CalendarEventModel, occKey: string | null = selectedOccurrenceKey): number => {
      const [id, at] = occKey?.split(":") ?? [];
      return id === event.id && at ? Number(at) : Date.parse(event.startsAt);
    },
    [selectedOccurrenceKey],
  );

  /** A delete: one occurrence of a repeat asks which; anything else confirms as before. */
  const requestEventDelete = useCallback(
    (eventId: string, occurrenceStartMs?: number) => {
      const event = eventsById.get(eventId);
      if (!event) return;
      const at = occurrenceStartMs ?? occurrenceStartOf(event);
      if (!ask(eventId, at, { kind: "delete" })) confirmDelete(eventId);
    },
    [eventsById, occurrenceStartOf, ask, confirmDelete],
  );

  /** A panel edit. Its times are the series' own; for one occurrence they move to its day. */
  const patchEvent = useCallback(
    (eventId: string, patch: CalendarEventPatch) => {
      const event = eventsById.get(eventId);
      // The repeat itself belongs to the series (the picker): never per occurrence.
      if (!event || patch.rrule !== undefined) {
        void updateEvent(eventId, patch);
        return;
      }
      const at = occurrenceStartOf(event);
      const offset = event.rrule ? at - Date.parse(event.startsAt) : 0;
      const moved = (iso: string) => new Date(Date.parse(iso) + offset).toISOString();
      const inOccurrence: CalendarEventPatch = {
        ...patch,
        ...(patch.startsAt !== undefined ? { startsAt: moved(patch.startsAt) } : {}),
        ...(patch.endsAt !== undefined ? { endsAt: moved(patch.endsAt) } : {}),
      };
      if (!ask(eventId, at, { kind: "patch", patch: inOccurrence }))
        void updateEvent(eventId, patch);
    },
    [eventsById, occurrenceStartOf, ask, updateEvent],
  );

  /** A drag or resize of one occurrence: the patch is its new span. True when it asks. */
  const askMove = useCallback(
    (
      eventId: string,
      deltas: { startDeltaMs: number; endDeltaMs: number },
      occurrence: { startMs: number; endMs: number },
    ): boolean =>
      ask(eventId, occurrence.startMs, {
        kind: "patch",
        patch: {
          startsAt: new Date(occurrence.startMs + deltas.startDeltaMs).toISOString(),
          endsAt: new Date(occurrence.endMs + deltas.endDeltaMs).toISOString(),
        },
      }),
    [ask],
  );

  const onAnswer = useCallback(
    (scope: OccurrenceScope) => {
      if (!pending) return;
      setPending(null);
      void writeOccurrence(pending.eventId, pending.occurrenceStartMs, scope, pending.change);
    },
    [pending, writeOccurrence],
  );

  const onCancel = useCallback(() => setPending(null), []);

  return {
    askMove,
    occurrenceStartOf,
    requestEventDelete,
    patchEvent,
    dialog: { question: pending?.question ?? null, onAnswer, onCancel },
  };
}
