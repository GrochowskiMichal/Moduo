// One occurrence (CALR-11, AC44): the write behind "This event / All events".
// The plan (occurrence-edit.ts) says what to write; plain event edits and
// deletes go through the module's own updateEvent / deleteEvent, and the rest
// are here, optimistic with a surgical rollback like those two.

import { useCallback } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { undoToast } from "../../../lib/undo-toast";
import type { CalendarAccountModel, CalendarEventModel, CalendarEventPatch } from "../events";
import {
  type OccurrenceChange,
  type OccurrenceScope,
  type OccurrenceWritePlan,
  planOccurrenceWrite,
} from "../occurrence-edit";

type SetEventsIn = (
  forScope: string | null,
  next: (events: CalendarEventModel[]) => CalendarEventModel[],
) => void;

type Deps = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  scope: string | null;
  events: CalendarEventModel[];
  accounts: CalendarAccountModel[];
  setEventsIn: SetEventsIn;
  /** The module's own checks (edit rights, temp and busy rows, writable): false = stop. */
  canWrite: (event: CalendarEventModel | undefined) => event is CalendarEventModel;
  updateEvent: (eventId: string, patch: CalendarEventPatch) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  reload: () => Promise<void>;
};

const withExdate = (series: CalendarEventModel, at: string): CalendarEventModel => {
  const exdates = series.exdates ?? [];
  const ms = Date.parse(at);
  return exdates.some((d) => Date.parse(d) === ms)
    ? series
    : { ...series, exdates: [...exdates, at] };
};

/** What the override will look like before the server answers. */
function draftOverride(
  series: CalendarEventModel,
  originalStart: string,
  patch: CalendarEventPatch,
) {
  const length = Date.parse(series.endsAt) - Date.parse(series.startsAt);
  const startsAt = patch.startsAt ?? originalStart;
  const draft: CalendarEventModel = {
    ...series,
    id: `tmp-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    rrule: null,
    exdates: [],
    seriesId: series.id,
    originalStart,
    title: patch.title ?? series.title,
    description: patch.description ?? series.description,
    startsAt,
    endsAt: patch.endsAt ?? new Date(Date.parse(startsAt) + length).toISOString(),
    allDay: patch.allDay ?? series.allDay,
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.isPrivate !== undefined ? { isPrivate: patch.isPrivate } : {}),
  };
  return draft;
}

/** The non-time fields of an All events edit, shown on each Google instance at once. */
function patchedInstance(event: CalendarEventModel, patch: CalendarEventPatch): CalendarEventModel {
  return {
    ...event,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.isPrivate !== undefined ? { isPrivate: patch.isPrivate } : {}),
  };
}

export function useOccurrenceWrites(deps: Deps) {
  const { runtime, workspaceId, scope, events, accounts, setEventsIn, canWrite } = deps;
  const { updateEvent, deleteEvent, reload } = deps;

  /** Put rows back as they were (an id that's gone comes back, one that's new goes). */
  const rollback = useCallback(
    (before: CalendarEventModel[], added: string[] = []) =>
      setEventsIn(scope, (prev) => {
        const byId = new Map(before.map((e) => [e.id, e]));
        const kept = prev.filter((e) => !added.includes(e.id)).map((e) => byId.get(e.id) ?? e);
        const missing = before.filter((e) => !kept.some((k) => k.id === e.id));
        return [...kept, ...missing];
      }),
    [scope, setEventsIn],
  );

  const updateOne = useCallback(
    async (plan: Extract<OccurrenceWritePlan, { kind: "occurrence-update" }>) => {
      const series = events.find((e) => e.id === plan.seriesId);
      if (!series) return;
      const draft = draftOverride(series, plan.originalStart, plan.patch);
      setEventsIn(scope, (prev) => [
        ...prev.map((e) => (e.id === series.id ? withExdate(e, plan.originalStart) : e)),
        draft,
      ]);
      try {
        const saved = await (runtime as ModuoRuntime).calendar.updateOccurrence({
          workspaceId: workspaceId as string,
          seriesId: plan.seriesId,
          originalStart: plan.originalStart,
          patch: plan.patch,
        });
        // Filter-then-append: a live echo may already have brought the row.
        setEventsIn(scope, (prev) => [
          ...prev.filter((e) => e.id !== draft.id && e.id !== saved.id),
          saved,
        ]);
      } catch (err) {
        rollback([series], [draft.id]);
        toast.error(err instanceof Error ? err.message : "Couldn't change the event.");
      }
    },
    [events, runtime, workspaceId, scope, setEventsIn, rollback],
  );

  const deleteOne = useCallback(
    async (
      plan: Extract<OccurrenceWritePlan, { kind: "occurrence-delete" }>,
      event: CalendarEventModel,
    ) => {
      const series = events.find((e) => e.id === plan.seriesId);
      if (!series) return;
      const override = event.seriesId ? event : null;
      setEventsIn(scope, (prev) =>
        prev
          .filter((e) => e.id !== override?.id)
          .map((e) => (e.id === series.id ? withExdate(e, plan.originalStart) : e)),
      );
      const args = {
        workspaceId: workspaceId as string,
        seriesId: plan.seriesId,
        originalStart: plan.originalStart,
      };
      const calendar = (runtime as ModuoRuntime).calendar;
      try {
        await calendar.removeOccurrence(args);
        undoToast("Event deleted", {
          description: event.title || undefined,
          onUndo: () => {
            void (async () => {
              const restored = await calendar.restoreOccurrence(args);
              setEventsIn(scope, (prev) => prev.map((e) => (e.id === restored.id ? restored : e)));
              // A restored override comes back by the live channel; a reload makes sure.
              await reload();
            })().catch((err) =>
              toast.error(err instanceof Error ? err.message : "Couldn't restore the event."),
            );
          },
        });
      } catch (err) {
        rollback(override ? [series, override] : [series]);
        toast.error(err instanceof Error ? err.message : "Couldn't delete the event.");
      }
    },
    [events, runtime, workspaceId, scope, setEventsIn, rollback, reload],
  );

  const googleSeries = useCallback(
    async (
      plan: Extract<OccurrenceWritePlan, { kind: "google-series-update" | "google-series-delete" }>,
      event: CalendarEventModel,
    ) => {
      const account = accounts.find((a) => a.id === event.sourceAccountId);
      if (!account) return;
      const instances = events.filter(
        (e) =>
          e.sourceAccountId === event.sourceAccountId &&
          e.externalSeriesId === plan.externalSeriesId &&
          !e.deletedAt,
      );
      const ids = new Set(instances.map((e) => e.id));
      const calendar = (runtime as ModuoRuntime).calendar;
      const input = { workspaceId: workspaceId as string, account, instance: event, instances };
      try {
        if (plan.kind === "google-series-delete") {
          setEventsIn(scope, (prev) => prev.filter((e) => !ids.has(e.id)));
          await calendar.removeGoogleSeries(input);
          // No Undo: it would come back as a new Google series.
          toast.success("Events deleted");
        } else {
          setEventsIn(scope, (prev) =>
            prev.map((e) => (ids.has(e.id) ? patchedInstance(e, plan.patch) : e)),
          );
          await calendar.updateGoogleSeries({ ...input, patch: plan.patch });
        }
      } catch (err) {
        rollback(instances);
        const reason = err instanceof Error ? err.message : "";
        const verb = plan.kind === "google-series-delete" ? "delete" : "save";
        toast.error(`Google didn't ${verb} it${reason ? `: ${reason}` : "."}`);
      }
    },
    [accounts, events, runtime, workspaceId, scope, setEventsIn, rollback],
  );

  /**
   * Change or delete the occurrence of `eventId` that starts at
   * `occurrenceStartMs`, for This event or All events. A patch is in the
   * occurrence's terms (its own new start and end).
   */
  const writeOccurrence = useCallback(
    async (
      eventId: string,
      occurrenceStartMs: number,
      occurrenceScope: OccurrenceScope,
      change: OccurrenceChange,
    ): Promise<void> => {
      const event = events.find((e) => e.id === eventId);
      if (!canWrite(event)) return;
      const series = event.seriesId ? events.find((e) => e.id === event.seriesId) : undefined;
      let plan: OccurrenceWritePlan;
      try {
        plan = planOccurrenceWrite({
          event,
          series,
          occurrenceStartMs,
          scope: occurrenceScope,
          change,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't change the event.");
        return;
      }
      switch (plan.kind) {
        case "event-update":
          return updateEvent(plan.eventId, plan.patch);
        case "event-delete":
          return deleteEvent(plan.eventId);
        // A Google instance is a row of its own: the module's Google-first path.
        case "google-update":
          return updateEvent(event.id, plan.patch);
        case "google-delete":
          return deleteEvent(event.id);
        case "occurrence-update":
          return updateOne(plan);
        case "occurrence-delete":
          return deleteOne(plan, event);
        default:
          return googleSeries(plan, event);
      }
    },
    [events, canWrite, updateEvent, deleteEvent, updateOne, deleteOne, googleSeries],
  );

  return writeOccurrence;
}
