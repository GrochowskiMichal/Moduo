// Data hook for the calendar module: loads the events+accounts bundle and
// exposes optimistic event CRUD. Mirrors the Tasks hook posture — apply
// locally first (<200ms perceived), reconcile with the server row, roll back
// + quiet toast on error. Reads degrade to empty pre-migration (deploy gap).
// Live events (CALR-7): while a workspace is open the hook follows its
// calendar's inserts, updates and deletes (`runtime.calendar.listenLive`,
// merged by `applyLiveChange`), and a resync refetches quietly. A read that
// fails keeps the week it had (CALR-3).

import type { CalendarItemKind } from "@contracts/vocabularies";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Truncation } from "../../../lib/paged-select";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web.client";
import { recordEventUndo, recordUndo } from "../commands/undo";
import type {
  CalendarAccountModel,
  CalendarAttendeeInput,
  CalendarEventModel,
  CalendarEventPatch,
  CalendarLiveChange,
} from "../events";
import { applyLiveChange } from "../live";
import { type BusyBlockRow, busyBlockToEvent } from "../teammates";
import {
  allTimeCalendarWindow,
  busyWindowFor,
  type CalendarWindow,
  defaultCalendarWindow,
  widenCalendarWindow,
  windowCovers,
} from "../window";
import { writableEvent } from "../writable";
import { useOccurrenceWrites } from "./use-occurrence-writes";

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
  // CALR-9's composer: sent only when set (the op still takes the old seven arguments).
  /** A Moduo or custom calendar's row id; omitted = Your calendar. */
  calendarId?: string;
  location?: string;
  attendees?: CalendarAttendeeInput[];
  /** Focus time (CALR-14) holds `focusTaskId`. */
  kind?: CalendarItemKind;
  focusTaskId?: string;
};

/**
 * A burst of resyncs (focus + visibilitychange on one return, a reconnect
 * right after) refetches once: the first schedules a quiet read this long
 * after it, and the rest inside that window ride along.
 */
const RESYNC_COALESCE_MS = 250;
/**
 * A return to the window refetches at most this often (every app switch fires
 * `focus` on desktop); a reconnect, which may have missed changes, always does.
 */
const RETURN_RESYNC_GAP_MS = 30_000;

const VIEW_ONLY_EVENT = "This calendar is view only here.";

/** `meet` is Google's; the Moduo op never gets it. */
function withoutMeet(patch: CalendarEventPatch): CalendarEventPatch {
  if (patch.meet === undefined) return patch;
  const { meet: _meet, ...rest } = patch;
  return rest;
}

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
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.isPrivate !== undefined ? { isPrivate: patch.isPrivate } : {}),
    ...(patch.attendees !== undefined
      ? {
          attendees: patch.attendees.map((a) => ({
            email: a.email,
            name: a.name ?? "",
            status: a.status ?? "needsAction",
          })),
        }
      : {}),
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
   * Nothing lands while there is no scope at all.
   */
  const setEventsIn = useCallback(
    (forScope: string | null, next: (events: CalendarEventModel[]) => CalendarEventModel[]) =>
      setList((current) => {
        if (forScope === null || current.scope !== forScope) return current;
        const nextEvents = next(current.events);
        return nextEvents === current.events ? current : { scope: forScope, events: nextEvents };
      }),
    [],
  );
  const reqRef = useRef(0);
  /**
   * Live changes that arrived while a read was in flight. The read's snapshot
   * may predate them, so they are replayed onto its reply (as the Tasks store's
   * `applyWhole` does) instead of being overwritten by it.
   */
  const liveDuringReadRef = useRef<{ req: number; changes: CalendarLiveChange[] } | null>(null);
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

  /**
   * Read the bundle for the current scope and window. `quiet` (a live resync)
   * leaves `loading` alone, so the grid refreshes in place instead of
   * flashing a skeleton.
   */
  // Busy blocks are read for the days on screen and the composer's horizon
  // (busyWindowFor), not the fetch window: a reply holds one row per occurrence.
  const busyWindowRef = useRef<CalendarWindow | null>(null);
  const readBusy = useCallback(async (req: number, ws: string) => {
    const now = new Date();
    const window =
      busyWindowRef.current ?? busyWindowFor(now, new Date(now.getTime() + 7 * 86_400_000));
    busyWindowRef.current = window;
    try {
      const busyRows = await supabaseClient.rpc("calendar_busy_blocks", {
        p_workspace_id: ws,
        p_from: window.fromIso,
        p_to: window.toIso,
      });
      if (reqRef.current !== req) return;
      setBusy(
        busyRows.error || !Array.isArray(busyRows.data)
          ? []
          : busyRows.data.map((row: BusyBlockRow, i: number) => busyBlockToEvent(row, ws, i)),
      );
    } catch {
      if (reqRef.current === req) setBusy([]);
    }
  }, []);

  const load = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!aliveRef.current) return; // a late `reload()` after unmount reads nothing
      if (!runtime || !userId || !workspaceId || !canRead) {
        setList({ scope, events: [] });
        setAccounts([]);
        setBusy([]);
        setDegraded(false);
        setTruncated([]);
        setLoading(false);
        return;
      }
      const req = ++reqRef.current;
      liveDuringReadRef.current = { req, changes: [] };
      if (!options?.quiet) setLoading(true);
      const bundle = await runtime.calendar.listModule(workspaceId, fetchWindow);
      if (reqRef.current !== req) return;
      const missed =
        liveDuringReadRef.current?.req === req ? liveDuringReadRef.current.changes : [];
      liveDuringReadRef.current = null;
      const fresh =
        scope === null
          ? bundle.events
          : missed.reduce(
              (events, change) => applyLiveChange(events, change, scope),
              bundle.events,
            );
      // Keep unsettled optimistic creates: a reload is now also triggered by
      // navigation (window widening), so it can land between a create's
      // optimistic row and its server row — which would otherwise drop the
      // event until the next reload (the tmp-id reconcile finds nothing).
      // Only this scope's own: a create still saving in the workspace you just
      // left stays there.
      // A failed read (CALR-3) returns nothing: keep what this scope's week
      // already shows, so a failed resync never empties it into "Nothing
      // scheduled". The banner says the read failed.
      const failed = bundle.degraded && bundle.events.length === 0;
      setList((prev) => {
        if (failed && prev.scope === scope && prev.events.length > 0) return prev;
        const pending = prev.scope === scope ? prev.events.filter((e) => isTempId(e.id)) : [];
        return {
          scope,
          events: pending.length > 0 ? [...fresh, ...pending] : fresh,
        };
      });
      setAccounts((prev) =>
        bundle.degraded && bundle.accounts.length === 0 ? prev : bundle.accounts,
      );
      setDegraded(bundle.degraded);
      setTruncated(bundle.truncated);
      setLoading(false);
      void readBusy(req, workspaceId);
    },
    [runtime, userId, workspaceId, canRead, fetchWindow, scope],
  );

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

  // Events deleted here this session (an undo of an add, ⌫): live echoes skip them.
  const goneRef = useRef(new Set<string>());

  // Live events (CALR-7). Subscribed per scope as the signed-in person; a
  // workspace switch or unmount stops it. A change goes through `setEventsIn`,
  // so one that arrives late from the workspace you left is dropped. A resync
  // runs the CURRENT `load` (via `loadRef`) quietly, once per burst. Runtimes
  // without live events (test fakes) skip all of this.
  useEffect(() => {
    if (!runtime || !scope || !userId) return;
    if (typeof runtime.calendar.listenLive !== "function") return;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastResyncAt = Number.NEGATIVE_INFINITY;
    const stop = runtime.calendar.listenLive({ workspaceId: scope, selfId: userId }, (event) => {
      if (event.type === "change") {
        // A late echo of an event just deleted here (its insert, a stamp) never
        // brings it back: the delete's own update may not reach this channel.
        const { change } = event;
        if (
          change.kind !== "delete" &&
          !change.event.deletedAt &&
          goneRef.current.has(change.event.id)
        )
          return;
        liveDuringReadRef.current?.changes.push(event.change);
        setEventsIn(scope, (prev) => applyLiveChange(prev, event.change, scope));
        return;
      }
      if (resyncTimer !== null) return;
      if (event.reason === "return" && Date.now() - lastResyncAt < RETURN_RESYNC_GAP_MS) return;
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        lastResyncAt = Date.now();
        void loadRef.current({ quiet: true });
      }, RESYNC_COALESCE_MS);
    });
    return () => {
      stop();
      if (resyncTimer !== null) clearTimeout(resyncTimer);
    };
  }, [runtime, scope, userId, setEventsIn]);

  /**
   * Tell the hook which days are actually on screen. Widens the fetch window
   * (and reloads) when you navigate past its edge — without this, the date
   * window would simply make old/far-future months look empty.
   */
  const ensureRange = useCallback(
    (from: Date, to: Date) => {
      setFetchWindow((current) => widenCalendarWindow(current, from, to) ?? current);
      // Days past what the busy blocks hold: read them again for the new days.
      if (windowCovers(busyWindowRef.current, from, to)) return;
      busyWindowRef.current = busyWindowFor(from, to);
      if (workspaceId && canRead) void readBusy(reqRef.current, workspaceId);
    },
    [setFetchWindow, workspaceId, canRead, readBusy],
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

  // The busy overlay lands after `loading` settles (it must never hold the
  // calendar up), so right after a workspace switch `busy` still holds the
  // previous workspace's blocks until the new reply lands. Each row carries the
  // workspace it was fetched for, so show only the current scope's: a switch
  // hides the old blocks at once, so does losing read access or signing out
  // (scope goes null in that same render), and a same-workspace reload (a
  // widened window) keeps them up instead of flashing them off and on.
  const liveEvents = useMemo(
    () => [...events.filter((e) => !e.deletedAt), ...busy.filter((b) => b.workspaceId === scope)],
    [events, busy, scope],
  );

  const guardEdit = useCallback((): boolean => {
    if (!canEdit) {
      toast.error("View-only in this workspace.");
      return false;
    }
    if (!runtime || !workspaceId) return false;
    return true;
  }, [canEdit, runtime, workspaceId]);

  // Undo steps run later, against the rows as they are then (set below).
  const writesRef = useRef<{
    updateEvent: (
      id: string,
      patch: CalendarEventPatch,
      opts?: { undo?: boolean },
    ) => Promise<void>;
    deleteEvent: (id: string, opts?: { quiet?: boolean }) => Promise<boolean>;
  }>({ updateEvent: async () => {}, deleteEvent: async () => false });

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
        location: draft.location ?? null,
        kind: draft.kind ?? "event",
        status: "confirmed",
        color: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        ...(draft.focusTaskId ? { focusTaskId: draft.focusTaskId } : {}),
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
          calendarId: draft.calendarId,
          location: draft.location,
          attendees: draft.attendees,
          kind: draft.kind,
          focusTaskId: draft.focusTaskId,
        });
        // Filter-then-append, not map: a widen-triggered reload can land
        // between the optimistic row and this reconcile, in which case the
        // bundle ALREADY holds the server row and a map would leave two.
        setEventsIn(scope, (prev) => [
          ...prev.filter((e) => e.id !== tempId && e.id !== saved.id),
          saved,
        ]);
        // AC21: an add undoes by deleting it again, quietly.
        recordUndo(
          "Event added",
          async () => {
            await writesRef.current.deleteEvent(saved.id, { quiet: true });
          },
          {
            toast: true,
            description: saved.title,
          },
        );
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
  /** The write itself; resolves to the row as it was when the save landed, else null. */
  const saveEvent = useCallback(
    async (eventId: string, patch: CalendarEventPatch): Promise<CalendarEventModel | null> => {
      if (!guardEdit() || isTempId(eventId) || isBusyId(eventId)) return null;
      const snapshot = events.find((e) => e.id === eventId);
      if (!snapshot) return null;
      const writer = writableEvent(snapshot, accounts, userId);
      if (!writer) {
        toast.error(VIEW_ONLY_EVENT);
        return null;
      }
      const account = accounts.find((a) => a.id === snapshot.sourceAccountId);
      const optimistic = applyPatch(snapshot, patch);
      setEventsIn(scope, (prev) => prev.map((e) => (e.id === eventId ? optimistic : e)));
      try {
        const calendar = (runtime as ModuoRuntime).calendar;
        const saved =
          writer === "google" && account
            ? await calendar.updateGoogleEvent({
                workspaceId: workspaceId as string,
                event: snapshot,
                account,
                patch,
              })
            : await calendar.updateEvent({
                workspaceId: workspaceId as string,
                eventId,
                patch: withoutMeet(patch),
              });
        // Only over our own optimistic row: a live echo that already landed
        // (CALR-7) carries the server's split place and stamp, and stays.
        setEventsIn(scope, (prev) =>
          prev.map((e) =>
            e.id === eventId && (e === optimistic || writer === "moduo") ? saved : e,
          ),
        );
        return snapshot;
      } catch (err) {
        setEventsIn(scope, (prev) => prev.map((e) => (e.id === eventId ? snapshot : e)));
        const reason = err instanceof Error ? err.message : "";
        toast.error(
          writer === "google"
            ? `Google didn't save it${reason ? `: ${reason}` : "."}`
            : reason || "Couldn't update the event.",
        );
        return null;
      }
    },
    [guardEdit, runtime, workspaceId, events, accounts, userId, scope, setEventsIn],
  );

  const updateEvent = useCallback(
    async (
      eventId: string,
      patch: CalendarEventPatch,
      opts: { undo?: boolean } = {},
    ): Promise<void> => {
      const before = await saveEvent(eventId, patch);
      // AC21: every edit is one ⌘Z step; a move or resize also shows the toast.
      if (before && opts.undo !== false) {
        recordEventUndo(before, patch, (back) =>
          writesRef.current.updateEvent(eventId, back, { undo: false }),
        );
      }
    },
    [saveEvent],
  );

  /** A Google event's delete, already removed from the list: Google first, back on refusal. */
  const deleteFromGoogle = useCallback(
    async (
      snapshot: CalendarEventModel,
      account: CalendarAccountModel,
      quiet = false,
    ): Promise<boolean> => {
      try {
        await (runtime as ModuoRuntime).calendar.removeGoogleEvent({
          workspaceId: workspaceId as string,
          event: snapshot,
          account,
        });
        // No Undo: it would come back as a new Google event (out of scope).
        if (!quiet) toast.success("Event deleted");
        return true;
      } catch (err) {
        goneRef.current.delete(snapshot.id);
        setEventsIn(scope, (prev) =>
          prev.some((e) => e.id === snapshot.id) ? prev : [...prev, snapshot],
        );
        const reason = err instanceof Error ? err.message : "";
        toast.error(`Google didn't delete it${reason ? `: ${reason}` : "."}`);
        return false;
      }
    },
    [runtime, workspaceId, scope, setEventsIn],
  );

  const deleteEvent = useCallback(
    // Resolves whether the event went (a move's Undo checks it, CALR-4b).
    async (eventId: string, opts: { quiet?: boolean } = {}): Promise<boolean> => {
      if (!guardEdit() || isTempId(eventId) || isBusyId(eventId)) return false;
      const snapshot = events.find((e) => e.id === eventId);
      if (!snapshot) return false;
      const writer = writableEvent(snapshot, accounts, userId);
      if (!writer) {
        toast.error(VIEW_ONLY_EVENT);
        return false;
      }
      const account = accounts.find((a) => a.id === snapshot.sourceAccountId);
      // A series takes its changed occurrences with it (CALR-11).
      const overrides = events.filter((e) => e.seriesId === eventId);
      setEventsIn(scope, (prev) => prev.filter((e) => e.id !== eventId && e.seriesId !== eventId));
      goneRef.current.add(eventId);
      if (writer === "google" && account) {
        return deleteFromGoogle(snapshot, account, opts.quiet);
      }
      try {
        await (runtime as ModuoRuntime).calendar.removeEvent({
          workspaceId: workspaceId as string,
          eventId,
        });
        // The delete is soft — Undo un-deletes server-side and re-inserts the
        // returned row (same 8s grammar as unschedule/move/extend, DF-5).
        if (opts.quiet) return true;
        recordUndo(
          "Event deleted",
          async () => {
            goneRef.current.delete(eventId);
            const restored = await (runtime as ModuoRuntime).calendar.restoreEvent({
              workspaceId: workspaceId as string,
              eventId,
            });
            setEventsIn(scope, (prev) =>
              prev.some((e) => e.id === restored.id) ? prev : [...prev, restored],
            );
            // Its changed occurrences came back with it: read them.
            if (overrides.length > 0) await loadRef.current({ quiet: true });
          },
          { toast: true, description: snapshot.title },
        );
        return true;
      } catch (err) {
        goneRef.current.delete(eventId);
        // Surgical rollback: re-insert only the removed row — restoring a whole
        // list snapshot would resurrect tmp-ids reconciled while the RPC flew.
        setEventsIn(scope, (prev) => [
          ...prev,
          ...[snapshot, ...overrides].filter((row) => !prev.some((e) => e.id === row.id)),
        ]);
        toast.error(err instanceof Error ? err.message : "Couldn't delete the event.");
        return false;
      }
    },
    [
      guardEdit,
      runtime,
      workspaceId,
      events,
      accounts,
      userId,
      scope,
      setEventsIn,
      deleteFromGoogle,
    ],
  );

  // One occurrence of a repeat (CALR-11): This event / All events.
  const canWrite = useCallback(
    (event: CalendarEventModel | undefined): event is CalendarEventModel => {
      if (!event || !guardEdit() || isTempId(event.id) || isBusyId(event.id)) return false;
      if (writableEvent(event, accounts, userId)) return true;
      toast.error(VIEW_ONLY_EVENT);
      return false;
    },
    [guardEdit, accounts, userId],
  );
  const writeOccurrence = useOccurrenceWrites({
    runtime,
    workspaceId,
    scope,
    events,
    accounts,
    setEventsIn,
    canWrite,
    updateEvent,
    deleteEvent,
    reload,
  });

  useEffect(() => {
    writesRef.current = { updateEvent, deleteEvent };
  });

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
    writeOccurrence,
  };
}

export type CalendarModuleApi = ReturnType<typeof useCalendarModule>;
