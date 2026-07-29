// Data hook for the calendar module: loads the events+accounts bundle and
// exposes optimistic event CRUD. Mirrors the Tasks hook posture — apply
// locally first (<200ms perceived), reconcile with the server row, roll back
// + quiet toast on error. Reads degrade to empty pre-migration (deploy gap).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Truncation } from "../../../lib/paged-select";
import { undoToast } from "../../../lib/undo-toast";
import type {
  CalendarAccountModel,
  CalendarEventModel,
  CalendarEventPatch,
} from "../events";
import {
  allTimeCalendarWindow,
  defaultCalendarWindow,
  widenCalendarWindow,
  type CalendarWindow,
} from "../window";

type Params = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
};

export type CreateEventDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  rrule?: string | null;
  description?: string;
};

const isTempId = (id: string) => id.startsWith("tmp-");

function applyPatch(
  e: CalendarEventModel,
  patch: CalendarEventPatch,
): CalendarEventModel {
  return {
    ...e,
    title: patch.title !== undefined ? patch.title : e.title,
    description: patch.description !== undefined ? patch.description : e.description,
    startsAt: patch.startsAt !== undefined ? patch.startsAt : e.startsAt,
    endsAt: patch.endsAt !== undefined ? patch.endsAt : e.endsAt,
    allDay: patch.allDay !== undefined ? patch.allDay : e.allDay,
    rrule: patch.rrule !== undefined ? patch.rrule : e.rrule,
    updatedAt: new Date().toISOString(),
  };
}

export function useCalendarModule(runtime: ModuoRuntime | null, params: Params) {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [events, setEvents] = useState<CalendarEventModel[]>([]);
  const [accounts, setAccounts] = useState<CalendarAccountModel[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [truncated, setTruncated] = useState<Truncation[]>([]);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);
  // SCALE-1: the events read is windowed instead of "all history". The window
  // only ever grows (see ensureRange), so walking back and forth over months
  // you've already visited never refetches.
  const [fetchWindow, setFetchWindow] = useState<CalendarWindow>(() => defaultCalendarWindow());

  const load = useCallback(async () => {
    if (!runtime || !userId || !workspaceId || !canRead) {
      setEvents([]);
      setAccounts([]);
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    const bundle = await runtime.calendar.listModule(workspaceId, fetchWindow);
    if (reqRef.current !== req) return;
    // Keep unsettled optimistic creates: a reload is now also triggered by
    // navigation (window widening), so it can land between a create's
    // optimistic row and its server row — which would otherwise drop the
    // event until the next reload (the tmp-id reconcile finds nothing).
    setEvents((prev) => {
      const pending = prev.filter((e) => isTempId(e.id));
      return pending.length > 0 ? [...bundle.events, ...pending] : bundle.events;
    });
    setAccounts(bundle.accounts);
    setDegraded(bundle.degraded);
    setTruncated(bundle.truncated);
    setLoading(false);
  }, [runtime, userId, workspaceId, canRead, fetchWindow]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Tell the hook which days are actually on screen. Widens the fetch window
   * (and reloads) when you navigate past its edge — without this, the date
   * window would simply make old/far-future months look empty.
   */
  const ensureRange = useCallback((from: Date, to: Date) => {
    setFetchWindow((current) => widenCalendarWindow(current, from, to) ?? current);
  }, []);

  /**
   * Drop the window entirely — for readers that must see all of history (the
   * `?event=` deep link, which would otherwise call an old event "deleted"
   * just because it wasn't in the window). Idempotent: re-calling it once the
   * window is already all-time returns the same state object, so it can't
   * drive a reload loop.
   */
  const ensureAllTime = useCallback(() => {
    setFetchWindow((current) => {
      const all = allTimeCalendarWindow();
      return current.fromIso === all.fromIso && current.toIso === all.toIso ? current : all;
    });
  }, []);

  // A different workspace starts from the default window again — otherwise the
  // 2019 you paged back to in workspace A makes B's first read all-history.
  useEffect(() => {
    setFetchWindow(defaultCalendarWindow());
  }, [workspaceId]);

  const liveEvents = useMemo(() => events.filter((e) => !e.deletedAt), [events]);

  const guardEdit = useCallback((): boolean => {
    if (!canEdit) {
      toast.error("View-only in this workspace.");
      return false;
    }
    if (!runtime || !workspaceId) return false;
    return true;
  }, [canEdit, runtime, workspaceId]);

  const createEvent = useCallback(
    async (draft: CreateEventDraft): Promise<CalendarEventModel | null> => {
      if (!guardEdit()) return null;
      const tempId = `tmp-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const nowIso = new Date().toISOString();
      const optimistic: CalendarEventModel = {
        id: tempId,
        workspaceId: workspaceId as string,
        ownerId: userId,
        sourceAccountId: null,
        externalEventId: null,
        calendarId: "moduo",
        title: draft.title,
        description: draft.description ?? "",
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        allDay: draft.allDay ?? false,
        rrule: draft.rrule ?? null,
        status: "confirmed",
        color: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };
      setEvents((prev) => [...prev, optimistic]);
      try {
        const saved = await (runtime as ModuoRuntime).calendar.createEvent({
          workspaceId: workspaceId as string,
          title: draft.title,
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
          allDay: draft.allDay,
          rrule: draft.rrule,
          description: draft.description,
        });
        setEvents((prev) => prev.map((e) => (e.id === tempId ? saved : e)));
        return saved;
      } catch (err) {
        setEvents((prev) => prev.filter((e) => e.id !== tempId));
        toast.error(err instanceof Error ? err.message : "Couldn't save the event.");
        return null;
      }
    },
    [guardEdit, runtime, workspaceId, userId],
  );

  const updateEvent = useCallback(
    async (eventId: string, patch: CalendarEventPatch): Promise<void> => {
      if (!guardEdit() || isTempId(eventId)) return;
      // Snapshot INSIDE the updater — a stale closure snapshot would roll a
      // rapid second edit back past the first one's success.
      let before: CalendarEventModel | undefined;
      setEvents((prev) =>
        prev.map((e) => {
          if (e.id !== eventId) return e;
          before = e;
          return applyPatch(e, patch);
        }),
      );
      if (!before) return;
      const snapshot = before;
      try {
        const saved = await (runtime as ModuoRuntime).calendar.updateEvent({
          workspaceId: workspaceId as string,
          eventId,
          patch,
        });
        setEvents((prev) => prev.map((e) => (e.id === eventId ? saved : e)));
      } catch (err) {
        setEvents((prev) => prev.map((e) => (e.id === eventId ? snapshot : e)));
        toast.error(err instanceof Error ? err.message : "Couldn't update the event.");
      }
    },
    [guardEdit, runtime, workspaceId],
  );

  const deleteEvent = useCallback(
    async (eventId: string): Promise<void> => {
      if (!guardEdit() || isTempId(eventId)) return;
      // Surgical rollback: re-insert only the removed row — restoring a whole
      // snapshot would resurrect tmp-ids reconciled while the RPC flew.
      let removed: CalendarEventModel | undefined;
      setEvents((prev) =>
        prev.filter((e) => {
          if (e.id === eventId) {
            removed = e;
            return false;
          }
          return true;
        }),
      );
      if (!removed) return;
      const snapshot = removed;
      try {
        await (runtime as ModuoRuntime).calendar.removeEvent({
          workspaceId: workspaceId as string,
          eventId,
        });
        // The delete is soft — Undo un-deletes server-side and re-inserts the
        // returned row (same 8s grammar as unschedule/move/extend, DF-5).
        undoToast("Event deleted", {
          description: snapshot.title || undefined,
          onUndo: () => {
            void (async () => {
              const restored = await (runtime as ModuoRuntime).calendar.restoreEvent({
                workspaceId: workspaceId as string,
                eventId,
              });
              setEvents((prev) =>
                prev.some((e) => e.id === restored.id) ? prev : [...prev, restored],
              );
            })().catch((err) =>
              toast.error(err instanceof Error ? err.message : "Couldn't restore the event."),
            );
          },
        });
      } catch (err) {
        setEvents((prev) =>
          prev.some((e) => e.id === eventId) ? prev : [...prev, snapshot],
        );
        toast.error(err instanceof Error ? err.message : "Couldn't delete the event.");
      }
    },
    [guardEdit, runtime, workspaceId],
  );

  return {
    events: liveEvents,
    accounts,
    degraded,
    truncated,
    ensureRange,
    ensureAllTime,
    loading,
    canEdit,
    reload: load,
    createEvent,
    updateEvent,
    deleteEvent,
  };
}

export type CalendarModuleApi = ReturnType<typeof useCalendarModule>;
