// Data hook for the calendar module: loads the events+accounts bundle and
// exposes optimistic event CRUD. Mirrors the Tasks hook posture — apply
// locally first (<200ms perceived), reconcile with the server row, roll back
// + quiet toast on error. Reads degrade to empty pre-migration (deploy gap).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Truncation } from "../../../lib/paged-select";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web";
import { undoToast } from "../../../lib/undo-toast";
import type { CalendarAccountModel, CalendarEventModel, CalendarEventPatch } from "../events";
import {
  allTimeCalendarWindow,
  type CalendarWindow,
  defaultCalendarWindow,
  widenCalendarWindow,
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
const isBusyId = (id: string) => id.startsWith("busy:");

function applyPatch(e: CalendarEventModel, patch: CalendarEventPatch): CalendarEventModel {
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
  /** The workspace whose calendar this hook shows: null whenever `load` can't read one. */
  const scope = runtime && userId && canRead ? workspaceId : null;

  // The event list is stored WITH the scope it was read for. When the scope
  // changes (a workspace switch, or read access going away), everything the
  // last `listModule` read returned is reset during render, like the window
  // below. The old workspace's rows then never show in the new one, not even
  // for a frame, and its still-saving creates are left behind. Writes that
  // settle later go through `setEventsIn`, which drops them once the list has
  // moved on.
  const [list, setList] = useState<{ scope: string | null; events: CalendarEventModel[] }>(() => ({
    scope,
    events: [],
  }));
  const [busy, setBusy] = useState<CalendarEventModel[]>([]);
  const [accounts, setAccounts] = useState<CalendarAccountModel[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [truncated, setTruncated] = useState<Truncation[]>([]);
  const [loading, setLoading] = useState(true);
  if (list.scope !== scope) {
    setList({ scope, events: [] });
    setAccounts([]);
    setDegraded(false);
    setTruncated([]);
    // Effects that wait for `loading` (the `?event=` deep link, the Google
    // calendar linker) must not read the emptied list as this scope's.
    setLoading(scope !== null);
  }
  const events = list.events;

  /**
   * Change the event list only while it still belongs to `forScope`, the scope
   * a write started in. A write that settles after a switch has still saved in
   * its own workspace; it just never lands in another workspace's list.
   */
  const setEventsIn = useCallback(
    (forScope: string | null, next: (events: CalendarEventModel[]) => CalendarEventModel[]) =>
      setList((current) => {
        if (current.scope !== forScope) return current;
        const nextEvents = next(current.events);
        return nextEvents === current.events ? current : { scope: forScope, events: nextEvents };
      }),
    [],
  );
  const reqRef = useRef(0);
  const aliveRef = useRef(true); // the load effect clears it; only unmount leaves it false
  // SCALE-1: the events read is windowed instead of "all history". The window
  // only ever grows (see ensureRange), so walking back and forth over months
  // you've already visited never refetches.
  //
  // The window is stored WITH the workspace it belongs to and reset during
  // render, not in an effect: an effect would let one read fire against the
  // previous workspace's (possibly all-time) window first, then immediately
  // refetch — two round-trips on every mount and every switch.
  const [windowState, setWindowState] = useState<{
    workspaceId: string | null;
    window: CalendarWindow;
  }>(() => ({ workspaceId, window: defaultCalendarWindow() }));
  if (windowState.workspaceId !== workspaceId) {
    setWindowState({ workspaceId, window: defaultCalendarWindow() });
  }
  const fetchWindow = windowState.window;
  const setFetchWindow = useCallback(
    (next: (current: CalendarWindow) => CalendarWindow) =>
      setWindowState((s) => {
        const w = next(s.window);
        return w === s.window ? s : { ...s, window: w };
      }),
    [],
  );
  const isAllTimeWindow =
    fetchWindow.fromIso === allTimeCalendarWindow().fromIso &&
    fetchWindow.toIso === allTimeCalendarWindow().toIso;

  const load = useCallback(async () => {
    if (!aliveRef.current) return; // a late `reload()` after unmount reads nothing
    if (!runtime || !userId || !workspaceId || !canRead) {
      setList({ scope, events: [] });
      setAccounts([]);
      setDegraded(false);
      setTruncated([]);
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
    // Only this scope's own: a create still saving in the workspace you just
    // left stays there.
    setList((prev) => {
      const pending = prev.scope === scope ? prev.events.filter((e) => isTempId(e.id)) : [];
      return {
        scope,
        events: pending.length > 0 ? [...bundle.events, ...pending] : bundle.events,
      };
    });
    setAccounts(bundle.accounts);
    setDegraded(bundle.degraded);
    setTruncated(bundle.truncated);
    setLoading(false);
    void (async () => {
      try {
        const busyRows = await supabaseClient.rpc("calendar_busy_blocks", {
          p_workspace_id: workspaceId,
          p_from: fetchWindow.fromIso,
          p_to: fetchWindow.toIso,
        });
        if (reqRef.current !== req) return;
        setBusy(
          busyRows.error || !Array.isArray(busyRows.data)
            ? []
            : busyRows.data.map(
                (
                  row: { calendar_id: string; start_time: string; end_time: string },
                  i: number,
                ) => ({
                  // Two busy blocks can start at the same time; keep keys unique.
                  id: `busy:${row.calendar_id}:${row.start_time}:${i}`,
                  workspaceId,
                  ownerId: null,
                  sourceAccountId: "busy",
                  externalEventId: null,
                  calendarId: "busy",
                  title: "Busy",
                  description: "",
                  startsAt: row.start_time,
                  endsAt: row.end_time,
                  allDay: false,
                  rrule: null,
                  status: "confirmed",
                  color: null,
                  createdAt: row.start_time,
                  updatedAt: row.start_time,
                  deletedAt: null,
                }),
              ),
        );
      } catch {
        if (reqRef.current === req) setBusy([]);
      }
    })();
  }, [runtime, userId, workspaceId, canRead, fetchWindow, scope]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    // Orphan the in-flight read on unmount (or when new deps supersede it):
    // every late `set*` in `load`, the un-awaited busy overlay's included,
    // then sees a stale `req` and bails, and a `reload()` that fires after
    // unmount (a sync finishing late) starts nothing. Otherwise a reply landing
    // after a test's jsdom teardown calls setState → "window is not defined".
    return () => {
      aliveRef.current = false;
      reqRef.current++;
    };
  }, [load]);

  // `reload` always runs the CURRENT `load`. Callers hold it across awaits (a
  // sync finishing, an account removal, a push to Google), and by the time it
  // fires the user may have switched workspace: the `load` they captured would
  // read the old workspace into this one's list, and orphan this one's read.
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  }, [load]);
  const reload = useCallback(() => loadRef.current(), []);

  /**
   * Tell the hook which days are actually on screen. Widens the fetch window
   * (and reloads) when you navigate past its edge — without this, the date
   * window would simply make old/far-future months look empty.
   */
  const ensureRange = useCallback(
    (from: Date, to: Date) => {
      setFetchWindow((current) => widenCalendarWindow(current, from, to) ?? current);
    },
    [setFetchWindow],
  );

  /**
   * Drop the window entirely — for readers that must see all of history (the
   * `?event=` deep link, which would otherwise call an old event "deleted"
   * just because it wasn't in the window). Idempotent: once the window is
   * already all-time this is a no-op, so it can't drive a reload loop — which
   * is exactly why callers must check `isAllTimeWindow` before treating this
   * as "try again", or they wait forever for a reload that never comes.
   */
  const ensureAllTime = useCallback(() => {
    setFetchWindow((current) => {
      const all = allTimeCalendarWindow();
      return current.fromIso === all.fromIso && current.toIso === all.toIso ? current : all;
    });
  }, [setFetchWindow]);

  const liveEvents = useMemo(
    () => [...events.filter((e) => !e.deletedAt), ...busy],
    [events, busy],
  );

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
      setEventsIn(scope, (prev) => [...prev, optimistic]);
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
        // Filter-then-append, not map: a widen-triggered reload can land
        // between the optimistic row and this reconcile, in which case the
        // bundle ALREADY holds the server row and a map would leave two.
        setEventsIn(scope, (prev) => [
          ...prev.filter((e) => e.id !== tempId && e.id !== saved.id),
          saved,
        ]);
        return saved;
      } catch (err) {
        setEventsIn(scope, (prev) => prev.filter((e) => e.id !== tempId));
        toast.error(err instanceof Error ? err.message : "Couldn't save the event.");
        return null;
      }
    },
    [guardEdit, runtime, workspaceId, userId, scope, setEventsIn],
  );

  // updateEvent and deleteEvent take their snapshot from the rendered list,
  // the way the Tasks hook does. They used to take it inside the state updater
  // and return early while it was still empty, but React doesn't promise to
  // run an updater before setState returns (it only does when nothing else is
  // queued on the component). A delete from the confirm dialog, which queues
  // four setStates first, never reached the server, and edits often didn't.
  // The rendered row is only stale for a second edit made inside the same
  // handler as the first, and nothing does that.
  const updateEvent = useCallback(
    async (eventId: string, patch: CalendarEventPatch): Promise<void> => {
      if (!guardEdit() || isTempId(eventId) || isBusyId(eventId)) return;
      const snapshot = events.find((e) => e.id === eventId);
      if (!snapshot) return;
      setEventsIn(scope, (prev) => prev.map((e) => (e.id === eventId ? applyPatch(e, patch) : e)));
      try {
        const saved = await (runtime as ModuoRuntime).calendar.updateEvent({
          workspaceId: workspaceId as string,
          eventId,
          patch,
        });
        setEventsIn(scope, (prev) => prev.map((e) => (e.id === eventId ? saved : e)));
      } catch (err) {
        setEventsIn(scope, (prev) => prev.map((e) => (e.id === eventId ? snapshot : e)));
        toast.error(err instanceof Error ? err.message : "Couldn't update the event.");
      }
    },
    [guardEdit, runtime, workspaceId, events, scope, setEventsIn],
  );

  const deleteEvent = useCallback(
    async (eventId: string): Promise<void> => {
      if (!guardEdit() || isTempId(eventId) || isBusyId(eventId)) return;
      const snapshot = events.find((e) => e.id === eventId);
      if (!snapshot) return;
      setEventsIn(scope, (prev) => prev.filter((e) => e.id !== eventId));
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
              setEventsIn(scope, (prev) =>
                prev.some((e) => e.id === restored.id) ? prev : [...prev, restored],
              );
            })().catch((err) =>
              toast.error(err instanceof Error ? err.message : "Couldn't restore the event."),
            );
          },
        });
      } catch (err) {
        // Surgical rollback: re-insert only the removed row — restoring a whole
        // list snapshot would resurrect tmp-ids reconciled while the RPC flew.
        setEventsIn(scope, (prev) =>
          prev.some((e) => e.id === eventId) ? prev : [...prev, snapshot],
        );
        toast.error(err instanceof Error ? err.message : "Couldn't delete the event.");
      }
    },
    [guardEdit, runtime, workspaceId, events, scope, setEventsIn],
  );

  return {
    events: liveEvents,
    accounts,
    degraded,
    truncated,
    ensureRange,
    ensureAllTime,
    isAllTimeWindow,
    loading,
    canEdit,
    reload,
    createEvent,
    updateEvent,
    deleteEvent,
  };
}

export type CalendarModuleApi = ReturnType<typeof useCalendarModule>;
