/** The web runtime's calendar (Supabase). */

import {
  calendarAccountRowSchema,
  calendarEventRowSchema,
  mapKnownRows,
  parsedCalendarProvider,
  requireRow,
} from "@contracts/rows";
import { normalizeCalendarItemKind, normalizeConferenceProvider } from "@contracts/vocabularies";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type {
  CalendarAccountModel,
  CalendarAttendee,
  CalendarEventModel,
  CalendarLiveChange,
  CalendarLiveEvent,
} from "../features/calendar/events";
import { defaultCalendarWindow } from "../features/calendar/window";
import { collectTruncations, READ_CAPS } from "./paged-select";
import { jsonObject, type RpcArgs, runRpc } from "./runtime.db";
import type { CalendarRuntime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { firstRow, selectCapped } from "./runtime.web.shared";

// ── Calendar module row⇄model mappers (Wave 2) ───────────────────────────────
// snake_case legacy column names (start_time/end_time/recurrence_rule) stay in
// the DB; the model speaks the Wave-2 vocabulary (startsAt/endsAt/rrule).

/** The people on a row: only objects with a string email; name and status get their defaults. */
function attendeesOf(raw: unknown): CalendarAttendee[] {
  if (!Array.isArray(raw)) return [];
  const out: CalendarAttendee[] = [];
  for (const person of raw) {
    if (!person || typeof person !== "object") continue;
    const { email, name, status } = person as Record<string, unknown>;
    if (typeof email !== "string") continue;
    out.push({
      email,
      name: typeof name === "string" ? name : "",
      status: typeof status === "string" ? status : "needsAction",
    });
  }
  return out;
}

function calendarEventRowToModel(raw: unknown): CalendarEventModel {
  const r = requireRow(calendarEventRowSchema, raw, "calendar event");
  return {
    id: r.id,
    workspaceId: r.workspace_id ?? null,
    ownerId: r.owner_id ?? null,
    sourceAccountId: r.source_account_id ?? null,
    externalEventId: r.external_event_id ?? null,
    calendarId: r.calendar_id ?? "moduo",
    title: r.title ?? "",
    description: r.description ?? "",
    startsAt: r.start_time,
    endsAt: r.end_time,
    allDay: Boolean(r.all_day),
    rrule: r.recurrence_rule ?? null,
    status: r.status ?? "confirmed",
    location: r.location ?? null,
    color: r.color ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    // Event data v2 (CALR-6): a row from before the migration reads as the defaults.
    calendarRef: r.calendar_ref ?? null,
    isPrivate: Boolean(r.is_private),
    conferenceUrl: r.conference_url ?? null,
    conferenceProvider: normalizeConferenceProvider(r.conference_provider),
    kind: normalizeCalendarItemKind(r.kind),
    focusTaskId: r.focus_task_id ?? null,
    attendees: attendeesOf(r.attendees),
    ...seriesFieldsOf(r),
  };
}

/** One occurrence (CALR-11): which series a row belongs to, and what its series skips. */
function seriesFieldsOf(r: {
  series_id?: string | null;
  original_start?: string | null;
  exdates?: string[] | null;
  external_series_id?: string | null;
}) {
  return {
    seriesId: r.series_id ?? null,
    originalStart: r.original_start ?? null,
    exdates: r.exdates ?? [],
    externalSeriesId: r.external_series_id ?? null,
  };
}

function calendarAccountRowToModel(raw: unknown): CalendarAccountModel {
  const r = requireRow(calendarAccountRowSchema, raw, "calendar account");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? null,
    provider: parsedCalendarProvider(r.provider),
    externalId: r.external_id ?? "",
    displayLabel: r.display_label ?? "",
    isDefaultTarget: Boolean(r.is_default_target),
    color: r.color ?? null,
    lastSyncAt: r.last_sync_at ?? null,
    status: r.status ?? "ok",
    syncToken: r.sync_token ?? null,
    deletedAt: r.deleted_at ?? null,
    readOnly: r.read_only ?? false,
    busyDefault: r.busy_default ?? true,
    lastError: r.last_error ?? null,
  };
}

// ── Live events (CALR-7) ─────────────────────────────────────────────────────
// One Supabase channel per workspace and person, `calendar-db:<ws>:<me>`, with
// one `postgres_changes` listener on calendar_events filtered by workspace,
// shared by every listener through a ref count (modelled on Tasks'
// `TasksLink`, features/tasks/realtime.ts). Realtime applies the subscriber's
// SELECT policy to inserts and updates; a DELETE carries only the row id. The
// channel streams the raw table, not the masked read: its policy drops
// teammates' private rows (CALR-15), so they reach the week on a resync. The
// channel is calendar's own: a channel naming an unpublished table silently
// delivers nothing for any of its tables.
//
// Realtime is a latency layer, not the source of truth: every rejoin after the
// first and the network coming back ask for a `reconnect` resync, a return to
// the window (focus, or the tab becoming visible) for a `return` one, and the
// hook refetches.

type LivePayload = {
  eventType?: unknown;
  new?: unknown;
  old?: unknown;
};

/** A Realtime payload → the change, or null for anything it can't read. */
function parseCalendarLiveChange(payload: unknown): CalendarLiveChange | null {
  if (!payload || typeof payload !== "object") return null;
  const { eventType, new: row, old } = payload as LivePayload;
  if (eventType === "INSERT" || eventType === "UPDATE") {
    try {
      return { kind: "upsert", event: calendarEventRowToModel(row) };
    } catch {
      return null; // a row that doesn't parse is dropped, never thrown
    }
  }
  if (eventType === "DELETE") {
    const id = (old as { id?: unknown } | null | undefined)?.id;
    return typeof id === "string" && id !== "" ? { kind: "delete", id } : null;
  }
  return null;
}

type LiveListener = (event: CalendarLiveEvent) => void;

class CalendarLink {
  private refs = 0;
  private channel: RealtimeChannel | null = null;
  private joinedOnce = false;
  private listeners = new Set<LiveListener>();

  constructor(
    readonly workspaceId: string,
    readonly selfId: string,
  ) {}

  get refCount(): number {
    return this.refs;
  }

  acquire(): void {
    this.refs += 1;
    if (this.refs === 1) this.open();
  }

  release(): void {
    this.refs -= 1;
    if (this.refs <= 0) this.close();
  }

  subscribe(fn: LiveListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private open(): void {
    const ws = this.workspaceId;
    const channel = supabaseClient
      .channel(`calendar-db:${ws}:${this.selfId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_events", filter: `workspace_id=eq.${ws}` },
        (payload) => {
          const change = parseCalendarLiveChange(payload);
          if (change) this.emit({ type: "change", change });
        },
      );
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // The first join is the initial load's job; every later join is a
      // reconnect that may have missed changes.
      if (this.joinedOnce) this.emit({ type: "resync", reason: "reconnect" });
      this.joinedOnce = true;
    });
    this.channel = channel;
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.onReturn);
      window.addEventListener("online", this.onOnline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  private close(): void {
    if (this.channel) void supabaseClient.removeChannel(this.channel);
    this.channel = null;
    this.joinedOnce = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.onReturn);
      window.removeEventListener("online", this.onOnline);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
  }

  private onReturn = () => this.emit({ type: "resync", reason: "return" });

  private onOnline = () => this.emit({ type: "resync", reason: "reconnect" });

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.onReturn();
  };

  private emit(event: CalendarLiveEvent): void {
    for (const fn of this.listeners) fn(event);
  }
}

const liveLinks = new Map<string, CalendarLink>();

function listenCalendarLive(
  { workspaceId, selfId }: { workspaceId: string; selfId: string },
  listener: LiveListener,
): () => void {
  const key = `${workspaceId}:${selfId}`;
  let link = liveLinks.get(key);
  if (!link) {
    link = new CalendarLink(workspaceId, selfId);
    liveLinks.set(key, link);
  }
  const held = link;
  const unsubscribe = held.subscribe(listener);
  held.acquire();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    held.release();
    if (held.refCount <= 0) liveLinks.delete(key);
  };
}

/** A Google instance's series id; never an empty id that Google would read as another event. */
function googleSeriesId(instance: CalendarEventModel): string {
  if (!instance.externalSeriesId) throw new Error("This event isn't part of a Google repeat.");
  return instance.externalSeriesId;
}

// ── Booking link panel (CALR-17) ─────────────────────────────────────────────

async function bookingLinkHosts(linkId: string) {
  const { data, error } = await supabaseClient
    .from("booking_link_hosts")
    .select("user_id, status")
    .eq("link_id", linkId);
  if (error) throw error;
  return (data ?? []).map((row) => ({ userId: row.user_id, status: row.status }));
}

async function bookingLinkBookings(slotId: string) {
  const { data, error } = await supabaseClient
    .from("slot_bookings")
    .select("id, attendee_name, attendee_email, start_at, end_at")
    .eq("slot_id", slotId)
    .in("status", ["pending", "confirmed"])
    .gte("end_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.attendee_name,
    email: row.attendee_email,
    startsAt: row.start_at,
    endsAt: row.end_at,
  }));
}

export const webCalendar: CalendarRuntime = {
  // ── Wave-2 module surface. Writes = calendar_op_* RPCs (guard + write +
  // entities upsert + attributed activity); reads = indexed SELECTs that
  // DEGRADE to empty pre-migration (the deploy-gap posture — the page still
  // works as a task-lens calendar with zero calendar tables).
  async listModule(workspaceId, window) {
    try {
      // SCALE-1: the events read rides a date window (the hook widens it as
      // you navigate). CALR-15: it goes through the masked read,
      // `calendar_events_visible`, which returns a teammate's private event
      // as "Busy" and applies the window itself: every RECURRING series
      // (its stored start_time is the FIRST occurrence, often years back)
      // plus the standard overlap test, so multi-day events spanning the
      // edge survive too.
      const { fromIso, toIso } = window ?? defaultCalendarWindow();
      const [eventsRes, accountsRes] = await Promise.all([
        selectCapped<any>({
          scope: "events",
          cap: READ_CAPS.calendarEvents,
          build: (opts) =>
            supabaseClient.rpc(
              "calendar_events_visible",
              { p_workspace_id: workspaceId, p_from: fromIso, p_to: toIso },
              opts,
            ),
          order: (q) => q.order("start_time", { ascending: true }).order("id"),
        }),
        selectCapped<any>({
          scope: "calendars",
          cap: READ_CAPS.calendarAccounts,
          build: (opts) =>
            supabaseClient
              .from("calendar_accounts")
              .select("*", opts)
              .eq("workspace_id", workspaceId)
              .is("deleted_at", null),
          order: (q) => q.order("created_at", { ascending: true }).order("id"),
        }),
      ]);
      // Accounts degrade independently: the events table pre-exists (legacy),
      // calendar_accounts only lands with the migration.
      const accounts = accountsRes.error
        ? []
        : mapKnownRows(accountsRes.rows, calendarAccountRowToModel);
      if (eventsRes.error) return { events: [], accounts, degraded: true, truncated: [] };
      return {
        events: mapKnownRows(eventsRes.rows, calendarEventRowToModel),
        accounts,
        degraded: Boolean(accountsRes.error),
        truncated: collectTruncations(
          eventsRes.truncation,
          accountsRes.error ? null : accountsRes.truncation,
        ),
      };
    } catch {
      return { events: [], accounts: [], degraded: true, truncated: [] };
    }
  },
  async createEvent(input) {
    const args: Record<string, unknown> = {
      p_workspace_id: input.workspaceId,
      p_title: input.title,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_all_day: input.allDay ?? false,
      p_rrule: input.rrule ?? null,
      p_description: input.description ?? "",
    };
    // CALR-6's arguments go only when set: PostgREST matches an RPC by its named
    // args, so an unset one left out keeps this working against a database that
    // still has the old 7-argument op.
    const v2: Record<string, unknown> = {
      p_calendar_id: input.calendarId,
      p_location: input.location,
      p_attendees: input.attendees,
      p_conference_url: input.conferenceUrl,
      p_conference_provider: input.conferenceProvider,
      p_is_private: input.isPrivate,
      p_kind: input.kind,
      p_focus_task_id: input.focusTaskId,
    };
    for (const [key, value] of Object.entries(v2)) if (value !== undefined) args[key] = value;
    // The new arguments aren't in the generated Database types until the migration
    // reaches prod (the upsertAccount pattern).
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_event_create", args as RpcArgs<"calendar_op_event_create">),
    );
    return calendarEventRowToModel(firstRow(data, "calendar_op_event_create"));
  },
  async updateEvent({ workspaceId, eventId, patch }) {
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_event_update", {
        p_workspace_id: workspaceId,
        p_event_id: eventId,
        p_patch: patch,
      }),
    );
    return calendarEventRowToModel(firstRow(data, "calendar_op_event_update"));
  },
  async removeEvent({ workspaceId, eventId }) {
    await runRpc(
      supabaseClient.rpc("calendar_op_event_delete", {
        p_workspace_id: workspaceId,
        p_event_id: eventId,
      }),
    );
  },
  async restoreEvent({ workspaceId, eventId }) {
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_event_restore", {
        p_workspace_id: workspaceId,
        p_event_id: eventId,
      }),
    );
    return calendarEventRowToModel(firstRow(data, "calendar_op_event_restore"));
  },
  // CALR-11: This event on a Moduo repeat.
  async updateOccurrence({ workspaceId, seriesId, originalStart, patch }) {
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_event_occurrence_update", {
        p_workspace_id: workspaceId,
        p_series_id: seriesId,
        p_original_start: originalStart,
        p_patch: patch,
      }),
    );
    return calendarEventRowToModel(firstRow(data, "calendar_op_event_occurrence_update"));
  },
  async removeOccurrence({ workspaceId, seriesId, originalStart }) {
    await runRpc(
      supabaseClient.rpc("calendar_op_event_occurrence_delete", {
        p_workspace_id: workspaceId,
        p_series_id: seriesId,
        p_original_start: originalStart,
      }),
    );
  },
  async restoreOccurrence({ workspaceId, seriesId, originalStart }) {
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_event_occurrence_restore", {
        p_workspace_id: workspaceId,
        p_series_id: seriesId,
        p_original_start: originalStart,
      }),
    );
    return calendarEventRowToModel(firstRow(data, "calendar_op_event_occurrence_restore"));
  },
  async upsertAccount({
    workspaceId,
    provider,
    externalId,
    displayLabel,
    color,
    status,
    lastSyncAt,
    syncToken,
    readOnly,
    busyDefault,
  }) {
    const args: Record<string, unknown> = {
      p_workspace_id: workspaceId,
      p_provider: provider,
      p_external_id: externalId,
      p_display_label: displayLabel,
      p_color: color ?? null,
      p_status: status ?? null,
      p_last_sync_at: lastSyncAt ?? null,
    };
    // p_sync_token only exists post-CAL-8-migration; PostgREST matches RPCs
    // by named args, so sending it against the older 7-arg function 404s.
    // Send it ONLY for a non-null descriptor (CalDAV/ICS connect — which needs
    // the migration anyway). null and undefined both OMIT it: post-migration
    // the SQL `coalesce(p_sync_token, sync_token)` keeps the stored value for
    // null too, so omitting is equivalent AND keeps OAuth callers (who pass
    // `?? null` in the house style) working against a pre-migration database.
    if (syncToken != null) args.p_sync_token = syncToken;
    // CALR-20's arguments, the same way: only when set (an older database lacks them).
    if (readOnly !== undefined) args.p_read_only = readOnly;
    if (busyDefault !== undefined) args.p_busy_default = busyDefault;
    const data = await runRpc(
      supabaseClient.rpc(
        "calendar_op_account_upsert",
        args as RpcArgs<"calendar_op_account_upsert">,
      ),
    );
    return calendarAccountRowToModel(firstRow(data, "calendar_op_account_upsert"));
  },
  async removeAccount({ workspaceId, accountId }) {
    await runRpc(
      supabaseClient.rpc("calendar_op_account_remove", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
      }),
    );
  },
  async restoreAccount({ workspaceId, accountId }) {
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_account_restore", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
      }),
    );
    return calendarAccountRowToModel(firstRow(data, "calendar_op_account_restore"));
  },
  async setAccountBusy({ workspaceId, accountId, busy }) {
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_account_set", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
        p_busy_default: busy,
      }),
    );
    return calendarAccountRowToModel(firstRow(data, "calendar_op_account_set"));
  },
  async mirrorEvents({ workspaceId, accountId, events, deletedExternalIds }) {
    const data = jsonObject(
      await runRpc(
        supabaseClient.rpc("calendar_op_mirror_events", {
          p_workspace_id: workspaceId,
          p_account_id: accountId,
          p_events: events,
          p_deleted_external_ids: deletedExternalIds ?? [],
        }),
      ),
    );
    return {
      upserted: Number(data?.upserted ?? 0),
      removed: Number(data?.removed ?? 0),
    };
  },
  // Outlook, CalDAV, and ICS still sync from the desktop keychain. Google
  // uses the refresh token stored at connect, so the web app can mirror it.
  // Throwing (rather than returning []) keeps the sync loop from tombstoning
  // a provider this runtime cannot read.
  async fetchExternalEvents({ provider, externalAccountId, timeMin, timeMax }) {
    if (provider !== "google") throw new Error("web_provider_sync_skipped");
    const { fetchGoogleWebEvents } = await import("../features/calendar/google-web");
    return fetchGoogleWebEvents({ externalAccountId, timeMin, timeMax });
  },
  listenLive: listenCalendarLive,
  // CALR-8: Google first, then the mirror stores Google's answer.
  async updateGoogleEvent({ workspaceId, event, account, patch }) {
    const { updateGoogleWebEvent } = await import("../features/calendar/google-web");
    // Google takes start and end together: a patch that moves one edge (the
    // detail panel, a resize) sends both, keeping the event's all-day-ness
    // unless the patch changes it.
    const movesTime =
      patch.startsAt !== undefined || patch.endsAt !== undefined || patch.allDay !== undefined;
    const sent = movesTime
      ? {
          ...patch,
          startsAt: patch.startsAt ?? event.startsAt,
          endsAt: patch.endsAt ?? event.endsAt,
          allDay: patch.allDay ?? event.allDay,
        }
      : patch;
    const mapped = await updateGoogleWebEvent({
      externalAccountId: account.externalId,
      calendarId: event.calendarId,
      eventId: event.externalEventId ?? "",
      patch: sent,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (!mapped) return event;
    // The mapper leaves an absent place out (a sync keeps what's stored), so a
    // place this edit cleared must be sent as empty to clear the stored one.
    if (patch.location !== undefined && mapped.location === undefined) mapped.location = "";
    // Google has saved it; if storing the answer here fails, the next sync
    // catches up, so that's no reason to roll the edit back.
    await webCalendar
      .mirrorEvents({ workspaceId, accountId: account.id, events: [mapped] })
      .catch(() => undefined);
    return {
      ...event,
      title: mapped.title,
      description: mapped.description ?? event.description,
      startsAt: mapped.startsAt,
      endsAt: mapped.endsAt,
      allDay: mapped.allDay ?? event.allDay,
      location: mapped.location || null,
      conferenceUrl: mapped.conferenceUrl ?? null,
      isPrivate: mapped.isPrivate ?? false,
      attendees: mapped.attendees ?? [],
      // The server's stamp, not this device's clock: the live row that follows
      // carries the real one and replaces this.
      updatedAt: event.updatedAt,
    };
  },
  async bookingLink({ linkId }) {
    const { data: row, error } = await supabaseClient
      .from("exposed_slot_links")
      .select("*")
      .eq("id", linkId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const [hosts, bookings] = await Promise.all([
      bookingLinkHosts(linkId).catch(() => []),
      bookingLinkBookings(row.slot_id).catch(() => []),
    ]);
    return { link: row, hosts, bookings };
  },
  async updateBookingLink({ linkId, patch }) {
    const { paused, durationMinutes, busyCalendarIds } = patch;
    const { error } = await supabaseClient
      .from("exposed_slot_links")
      .update({
        ...(paused !== undefined ? { paused } : {}),
        ...(durationMinutes !== undefined ? { duration_minutes: durationMinutes } : {}),
        ...(busyCalendarIds
          ? {
              busy_calendar_ids: busyCalendarIds,
              conflict_calendars: JSON.stringify(busyCalendarIds),
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", linkId);
    if (error) throw error;
  },
  async eventContext({ eventId, calendarRef }) {
    const calendarOf = async () => {
      if (!calendarRef) return null;
      const { data, error } = await supabaseClient
        .from("calendars")
        .select("name, kind, owner_id")
        .eq("id", calendarRef)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { name: data.name, kind: data.kind, ownerId: data.owner_id };
    };
    const shareOf = async () => {
      if (!calendarRef) return null;
      const { data, error } = await supabaseClient.rpc("share_op_state", {
        p_type: "calendar",
        p_id: calendarRef,
      });
      if (error) throw error;
      const state = data as Record<string, unknown> | null;
      if (!state || state.visible === false) return null;
      return {
        workspaceLevel: (state.workspaceLevel as string | null) ?? null,
        people: Array.isArray(state.people)
          ? (state.people as { userId: string; level: string }[])
          : [],
      };
    };
    const bookingOf = async () => {
      const booking = await supabaseClient
        .from("slot_bookings")
        .select("slot_id, created_at")
        .eq("calendar_event_id", eventId)
        .in("status", ["pending", "confirmed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (booking.error) throw booking.error;
      if (!booking.data) return null;
      const link = await supabaseClient
        .from("exposed_slot_links")
        .select("name")
        .eq("slot_id", booking.data.slot_id)
        .limit(1)
        .maybeSingle();
      return { linkName: link.data?.name?.trim() || null, bookedAt: booking.data.created_at };
    };
    // Fail soft per part: a refused or failed read hides that row of the
    // Event view, it never blanks the panel.
    const [calendar, share, booking] = await Promise.all([
      calendarOf().catch(() => null),
      shareOf().catch(() => null),
      bookingOf().catch(() => null),
    ]);
    return { calendar, share, booking };
  },
  // CALR-11: All events on a Google repeat goes to its series (recurringEventId).
  // Google answers with the series itself; mirroring that would add it as a row
  // of its own, so the change is stored on the instances shown instead.
  async updateGoogleSeries({ workspaceId, account, instance, instances, patch }) {
    const { updateGoogleWebEvent } = await import("../features/calendar/google-web");
    const { startsAt: _s, endsAt: _e, allDay: _a, ...rest } = patch;
    await updateGoogleWebEvent({
      externalAccountId: account.externalId,
      calendarId: instance.calendarId,
      eventId: googleSeriesId(instance),
      patch: rest,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const { meet: _m, rrule: _r, calendarId: _c, kind: _k, focusTaskId: _f, ...fields } = rest;
    const events = instances.flatMap((e) =>
      e.externalEventId
        ? [
            {
              externalEventId: e.externalEventId,
              title: fields.title ?? e.title,
              startsAt: e.startsAt,
              endsAt: e.endsAt,
              ...(fields.description !== undefined ? { description: fields.description } : {}),
              ...(fields.location !== undefined ? { location: fields.location ?? "" } : {}),
              ...(fields.conferenceUrl !== undefined
                ? { conferenceUrl: fields.conferenceUrl }
                : {}),
              ...(fields.isPrivate !== undefined ? { isPrivate: fields.isPrivate } : {}),
              ...(fields.attendees !== undefined
                ? {
                    attendees: fields.attendees.map((a) => ({
                      email: a.email,
                      name: a.name ?? "",
                      status: a.status ?? "needsAction",
                    })),
                  }
                : {}),
            },
          ]
        : [],
    );
    // Google has saved it; the next sync catches up if storing here fails.
    await webCalendar
      .mirrorEvents({ workspaceId, accountId: account.id, events })
      .catch(() => undefined);
  },
  async removeGoogleSeries({ workspaceId, account, instance, instances }) {
    const { removeGoogleWebEvent } = await import("../features/calendar/google-web");
    await removeGoogleWebEvent({
      externalAccountId: account.externalId,
      calendarId: instance.calendarId,
      eventId: googleSeriesId(instance),
    });
    await webCalendar
      .mirrorEvents({
        workspaceId,
        accountId: account.id,
        events: [],
        deletedExternalIds: instances.flatMap((e) =>
          e.externalEventId ? [e.externalEventId] : [],
        ),
      })
      .catch(() => undefined);
  },
  async removeGoogleEvent({ workspaceId, event, account }) {
    const { removeGoogleWebEvent } = await import("../features/calendar/google-web");
    const externalEventId = event.externalEventId ?? "";
    await removeGoogleWebEvent({
      externalAccountId: account.externalId,
      calendarId: event.calendarId,
      eventId: externalEventId,
    });
    // Gone in Google; a failed tombstone here is caught up by the next sync.
    await webCalendar
      .mirrorEvents({
        workspaceId,
        accountId: account.id,
        events: [],
        deletedExternalIds: [externalEventId],
      })
      .catch(() => undefined);
  },
};
