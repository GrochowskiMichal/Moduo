// One occurrence (CALR-11, AC44): who is asked "This event / All events" and
// what each answer writes. Pure: the dialog asks, the runtime writes the plan.
//
// Moduo: This event on a plain occurrence makes an override (or an exdate, for
// a delete) through the occurrence ops; on an override it edits that row. All
// events edits the series, moved by as much as the occurrence was.
// Google: This event is the instance id, All events its recurringEventId.

import { type CalendarEventModel, type CalendarEventPatch, isNativeEvent } from "./events";

export type OccurrenceScope = "this" | "all";

export type OccurrenceChange = { kind: "patch"; patch: CalendarEventPatch } | { kind: "delete" };

export type OccurrenceWritePlan =
  | { kind: "event-update"; eventId: string; patch: CalendarEventPatch }
  | { kind: "event-delete"; eventId: string }
  | {
      kind: "occurrence-update";
      seriesId: string;
      originalStart: string;
      patch: CalendarEventPatch;
    }
  | { kind: "occurrence-delete"; seriesId: string; originalStart: string }
  | { kind: "google-update"; externalEventId: string; patch: CalendarEventPatch }
  | { kind: "google-delete"; externalEventId: string }
  | { kind: "google-series-update"; externalSeriesId: string; patch: CalendarEventPatch }
  | { kind: "google-series-delete"; externalSeriesId: string };

type Repeatable = Pick<
  CalendarEventModel,
  "sourceAccountId" | "rrule" | "seriesId" | "externalSeriesId"
>;

/** A series, an override of one, or a Google instance of a repeat. */
export function isRepeatOccurrence(event: Repeatable): boolean {
  return Boolean(event.rrule || event.seriesId || event.externalSeriesId);
}

function movesTime(patch: CalendarEventPatch): boolean {
  return "startsAt" in patch || "endsAt" in patch || "allDay" in patch;
}

/**
 * Whether the change asks This event / All events, and whether All events is
 * offered. A Google series doesn't move in time from here yet (a later block).
 */
export function occurrenceScopeChoices(
  event: Repeatable,
  change: OccurrenceChange,
): { ask: boolean; allEvents: boolean } {
  if (!isRepeatOccurrence(event)) return { ask: false, allEvents: false };
  if (isNativeEvent(event)) return { ask: true, allEvents: true };
  return { ask: true, allEvents: change.kind === "delete" || !movesTime(change.patch) };
}

/** The occurrence's move, applied to the series anchor: each time key shifts by
 * how far the occurrence's own start or end moved. */
function shiftedToSeries(
  patch: CalendarEventPatch,
  series: Pick<CalendarEventModel, "startsAt" | "endsAt">,
  occurrenceStartMs: number,
  occurrenceEndMs: number,
): CalendarEventPatch {
  const out = { ...patch };
  const shift = (anchor: string, to: string, from: number) =>
    new Date(Date.parse(anchor) + Date.parse(to) - from).toISOString();
  if (patch.startsAt !== undefined)
    out.startsAt = shift(series.startsAt, patch.startsAt, occurrenceStartMs);
  if (patch.endsAt !== undefined) out.endsAt = shift(series.endsAt, patch.endsAt, occurrenceEndMs);
  return out;
}

type PlanInput = {
  event: CalendarEventModel;
  /** The series, when `event` is an override (All events moves it). */
  series?: CalendarEventModel;
  /** Where the occurrence acted on starts now. */
  occurrenceStartMs: number;
  scope: OccurrenceScope;
  change: OccurrenceChange;
};

export function planOccurrenceWrite(input: PlanInput): OccurrenceWritePlan {
  const { event, change } = input;
  if (!isNativeEvent(event)) return planGoogle(input);
  if (!isRepeatOccurrence(event)) {
    return change.kind === "delete"
      ? { kind: "event-delete", eventId: event.id }
      : { kind: "event-update", eventId: event.id, patch: change.patch };
  }
  return input.scope === "this" ? planThisEvent(input) : planAllEvents(input);
}

function planGoogle({ event, scope, change }: PlanInput): OccurrenceWritePlan {
  const externalSeriesId = event.externalSeriesId;
  if (scope === "all" && externalSeriesId) {
    return change.kind === "delete"
      ? { kind: "google-series-delete", externalSeriesId }
      : { kind: "google-series-update", externalSeriesId, patch: change.patch };
  }
  const externalEventId = event.externalEventId ?? event.id;
  return change.kind === "delete"
    ? { kind: "google-delete", externalEventId }
    : { kind: "google-update", externalEventId, patch: change.patch };
}

/** An override is edited in place, and deleted by the occurrence it replaced. */
function planThisEvent({ event, occurrenceStartMs, change }: PlanInput): OccurrenceWritePlan {
  const seriesId = event.seriesId ?? event.id;
  const originalStart =
    (event.seriesId && event.originalStart) || new Date(occurrenceStartMs).toISOString();
  if (change.kind === "delete") return { kind: "occurrence-delete", seriesId, originalStart };
  return event.seriesId
    ? { kind: "event-update", eventId: event.id, patch: change.patch }
    : { kind: "occurrence-update", seriesId, originalStart, patch: change.patch };
}

function planAllEvents({
  event,
  series,
  occurrenceStartMs,
  change,
}: PlanInput): OccurrenceWritePlan {
  const seriesId = event.seriesId ?? event.id;
  if (change.kind === "delete") return { kind: "event-delete", eventId: seriesId };
  if (!movesTime(change.patch))
    return { kind: "event-update", eventId: seriesId, patch: change.patch };
  const anchor = event.seriesId ? series : event;
  if (!anchor) throw new Error("All events needs the series to move it.");
  const occurrenceEndMs = occurrenceStartMs + Date.parse(event.endsAt) - Date.parse(event.startsAt);
  return {
    kind: "event-update",
    eventId: seriesId,
    patch: shiftedToSeries(change.patch, anchor, occurrenceStartMs, occurrenceEndMs),
  };
}
