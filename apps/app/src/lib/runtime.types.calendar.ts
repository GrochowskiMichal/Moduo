/** The runtime port's calendar (implemented in runtime.web.calendar.ts). */

import type { CalendarItemKind, ConferenceProvider } from "@contracts/vocabularies";

import type {
  CalendarAccountModel,
  CalendarAttendeeInput,
  CalendarEventModel,
  CalendarEventPatch,
  CalendarLiveEvent,
  CalendarMirrorEventInput,
  CalendarModuleBundle,
} from "../features/calendar/events";
import type { CalendarWindow } from "../features/calendar/window";
import type { SharedCalendar } from "./calendar-busy";

export type CalendarRuntime = {
  // ── Wave-2 module surface (workspace-scoped, Supabase-first) ──────────
  // (Bundle/patch shapes live below the ModuoRuntime type.)
  // Writes go through calendar_op_* RPCs (guard + write + entities upsert
  // + attributed activity in one txn); reads are indexed SELECTs.
  /**
   * Events + accounts bundle. Reads DEGRADE to empty pre-migration.
   *
   * `window` bounds the events read to a date range (SCALE-1 — it used to
   * fetch all history); omitted = {@link defaultCalendarWindow}. Recurring
   * series always come through regardless of the window, since their stored
   * start is the first occurrence, not the one you're looking at.
   */
  listModule(workspaceId: string, window?: CalendarWindow): Promise<CalendarModuleBundle>;
  /**
   * Preview as (CALR-16): the masked read and busy blocks run for `as`, cut to
   * your own events, and `as`'s level on each of your calendars. A failed read
   * is `failed`, never an empty week. Optional: web only.
   */
  preview?(q: { workspaceId: string; as: string; window: CalendarWindow }): Promise<{
    rows: CalendarEventModel[];
    busy: CalendarEventModel[];
    levels: { calendarId: string; level: "view" | "freebusy" | "none" }[];
    failed: boolean;
  }>;
  /** Teammates' calendars you can see, at their level (CALR-16); `[]` when the read fails. */
  sharedWithMe?(workspaceId: string): Promise<SharedCalendar[]>;
  createEvent(input: {
    workspaceId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    allDay?: boolean;
    rrule?: string | null;
    description?: string;
    // Event data v2 (CALR-6): each is sent only when set, so this build still
    // creates events against a database with the old 7-argument op.
    /** The calendars row id; omitted = your Moduo calendar. */
    calendarId?: string;
    location?: string;
    attendees?: CalendarAttendeeInput[];
    conferenceUrl?: string;
    /** Omit to read it from the link. */
    conferenceProvider?: ConferenceProvider;
    isPrivate?: boolean;
    kind?: CalendarItemKind;
    /** Only with kind "focus". */
    focusTaskId?: string;
  }): Promise<CalendarEventModel>;
  updateEvent(input: {
    workspaceId: string;
    eventId: string;
    patch: CalendarEventPatch;
  }): Promise<CalendarEventModel>;
  removeEvent(input: { workspaceId: string; eventId: string }): Promise<void>;
  /** Un-delete a soft-deleted native event (the delete toast's Undo, DF-5). */
  restoreEvent(input: { workspaceId: string; eventId: string }): Promise<CalendarEventModel>;
  // ── One occurrence (CALR-11): This event on a Moduo repeat. `originalStart` is
  // the occurrence's start as the series draws it (an ISO instant).
  /** Change one occurrence: its override, made the first time. Resolves with the override. */
  updateOccurrence(input: {
    workspaceId: string;
    seriesId: string;
    originalStart: string;
    patch: CalendarEventPatch;
  }): Promise<CalendarEventModel>;
  /** Delete one occurrence: an exdate on the series, and its override if it has one. */
  removeOccurrence(input: {
    workspaceId: string;
    seriesId: string;
    originalStart: string;
  }): Promise<void>;
  /** The occurrence delete's Undo. Resolves with the series. */
  restoreOccurrence(input: {
    workspaceId: string;
    seriesId: string;
    originalStart: string;
  }): Promise<CalendarEventModel>;
  upsertAccount(input: {
    workspaceId: string;
    provider: string;
    externalId: string;
    displayLabel: string;
    color?: string | null;
    status?: string | null;
    lastSyncAt?: string | null;
    /**
     * CAL-8: the CalDAV/ICS connection descriptor JSON. OMIT (undefined) to
     * keep the stored value — the RPC param is only sent when provided, so
     * OAuth callers keep working against a pre-CAL-8 database.
     */
    syncToken?: string | null;
    /** CALR-20: sent only when defined, like syncToken. */
    readOnly?: boolean;
    busyDefault?: boolean;
  }): Promise<CalendarAccountModel>;
  removeAccount(input: { workspaceId: string; accountId: string }): Promise<void>;
  /** CALR-20: Remove's Undo; brings back the account and the events that Remove took. */
  restoreAccount(input: { workspaceId: string; accountId: string }): Promise<CalendarAccountModel>;
  /** CALR-20: Counts as busy for booking links. */
  setAccountBusy(input: {
    workspaceId: string;
    accountId: string;
    busy: boolean;
  }): Promise<CalendarAccountModel>;
  /**
   * Live events (CALR-7): follow inserts, updates and deletes of the
   * workspace's calendar events as they happen, plus a `resync` whenever
   * changes may have been missed (a rejoin, the network coming back) or you
   * come back to the window. One channel per workspace and person is shared
   * by every listener. Returns the stop function (safe to call twice).
   */
  listenLive(
    input: { workspaceId: string; selfId: string },
    listener: (event: CalendarLiveEvent) => void,
  ): () => void;
  /** Batched idempotent mirror upsert (the desktop sync engine's write). */
  mirrorEvents(input: {
    workspaceId: string;
    accountId: string;
    events: CalendarMirrorEventInput[];
    deletedExternalIds?: string[];
  }): Promise<{ upserted: number; removed: number }>;

  /**
   * Save a change to a mirrored Google event on Google first (CALR-8), then
   * mirror Google's answer. Resolves with the event as saved; throws Google's
   * reason when it refuses, and nothing is stored.
   */
  updateGoogleEvent(input: {
    workspaceId: string;
    event: CalendarEventModel;
    account: CalendarAccountModel;
    patch: CalendarEventPatch;
  }): Promise<CalendarEventModel>;
  /**
   * All events on a Google repeat (CALR-11): patch the series (`instance.externalSeriesId`)
   * on Google, without times, then store the change on `instances`, the ones shown.
   */
  updateGoogleSeries(input: {
    workspaceId: string;
    account: CalendarAccountModel;
    instance: CalendarEventModel;
    instances: CalendarEventModel[];
    patch: CalendarEventPatch;
  }): Promise<void>;
  /** Delete a Google repeat's series on Google, then tombstone `instances` (CALR-11). */
  removeGoogleSeries(input: {
    workspaceId: string;
    account: CalendarAccountModel;
    instance: CalendarEventModel;
    instances: CalendarEventModel[];
  }): Promise<void>;
  /** Delete a mirrored Google event on Google (guests are told), then tombstone the mirror (CALR-8). */
  removeGoogleEvent(input: {
    workspaceId: string;
    event: CalendarEventModel;
    account: CalendarAccountModel;
  }): Promise<void>;

  /**
   * What the Event view shows beyond the row (CALR-10): the calendar it is on
   * (name, kind, owner), that calendar's sharing as `share_op_state` reports
   * it, and the booking link it was booked through. Each part is null when it
   * can't be read; this never throws for a missing piece.
   */
  eventContext(input: { eventId: string; calendarRef: string | null }): Promise<{
    calendar: { name: string; kind: string; ownerId: string } | null;
    share: {
      workspaceLevel: string | null;
      people: { userId: string; level: string }[];
    } | null;
    booking: { linkName: string | null; bookedAt: string } | null;
  }>;

  /**
   * Fetch a connected account's RAW provider events for a window. Desktop
   * uses the Tauri OAuth engine. Web fetches Google through the stored
   * refresh token and throws for providers it cannot read (so the sync
   * loop does not treat "unsupported" as "this calendar is empty").
   * `externalAccountId` is the provider account id.
   */
  fetchExternalEvents(input: {
    provider: "google" | "microsoft" | "caldav" | "ics";
    externalAccountId: string;
    timeMin: string;
    timeMax: string;
    /** CAL-8: the account row's connection descriptor (caldav needs server+username; ignored by OAuth providers). */
    syncToken?: string | null;
  }): Promise<Record<string, unknown>[]>;
};
