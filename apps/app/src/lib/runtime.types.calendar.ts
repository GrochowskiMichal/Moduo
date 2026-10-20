/** The runtime port's calendar (implemented in runtime.web.calendar.ts). */

import type {
  CalendarAccountModel,
  CalendarEventModel,
  CalendarEventPatch,
  CalendarMirrorEventInput,
  CalendarModuleBundle,
} from "../features/calendar/events";
import type { CalendarWindow } from "../features/calendar/window";

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
  createEvent(input: {
    workspaceId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    allDay?: boolean;
    rrule?: string | null;
    description?: string;
  }): Promise<CalendarEventModel>;
  updateEvent(input: {
    workspaceId: string;
    eventId: string;
    patch: CalendarEventPatch;
  }): Promise<CalendarEventModel>;
  removeEvent(input: { workspaceId: string; eventId: string }): Promise<void>;
  /** Un-delete a soft-deleted native event (the delete toast's Undo, DF-5). */
  restoreEvent(input: { workspaceId: string; eventId: string }): Promise<CalendarEventModel>;
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
  }): Promise<CalendarAccountModel>;
  removeAccount(input: { workspaceId: string; accountId: string }): Promise<void>;
  /** Batched idempotent mirror upsert (the desktop sync engine's write). */
  mirrorEvents(input: {
    workspaceId: string;
    accountId: string;
    events: CalendarMirrorEventInput[];
    deletedExternalIds?: string[];
  }): Promise<{ upserted: number; removed: number }>;

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
