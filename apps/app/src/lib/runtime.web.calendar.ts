/** The web runtime's calendar (Supabase). */

import {
  calendarAccountRowSchema,
  calendarEventRowSchema,
  mapKnownRows,
  parsedCalendarProvider,
  requireRow,
} from "@contracts/rows";

import type { CalendarAccountModel, CalendarEventModel } from "../features/calendar/events";
import { defaultCalendarWindow } from "../features/calendar/window";
import { collectTruncations, READ_CAPS } from "./paged-select";
import { jsonObject, type RpcArgs, runRpc } from "./runtime.db";
import type { CalendarRuntime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { firstRow, selectCapped } from "./runtime.web.shared";

// ── Calendar module row⇄model mappers (Wave 2) ───────────────────────────────
// snake_case legacy column names (start_time/end_time/recurrence_rule) stay in
// the DB; the model speaks the Wave-2 vocabulary (startsAt/endsAt/rrule).

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
  };
}

export const webCalendar: CalendarRuntime = {
  // ── Wave-2 module surface. Writes = calendar_op_* RPCs (guard + write +
  // entities upsert + attributed activity); reads = indexed SELECTs that
  // DEGRADE to empty pre-migration (the deploy-gap posture — the page still
  // works as a task-lens calendar with zero calendar tables).
  async listModule(workspaceId, window) {
    try {
      // SCALE-1: the events read used to pull ALL history. It now rides a
      // date window (the hook widens it as you navigate). Two rows always
      // come through regardless of the window: none — but a RECURRING series
      // must, because its stored start_time is the FIRST occurrence (often
      // years back) while its occurrences run into the window. Hence the
      // `recurrence_rule.not.is.null` arm; the other arm is the standard
      // overlap test, so multi-day events spanning the edge survive too.
      const { fromIso, toIso } = window ?? defaultCalendarWindow();
      const [eventsRes, accountsRes] = await Promise.all([
        selectCapped<any>({
          scope: "events",
          cap: READ_CAPS.calendarEvents,
          build: (opts) =>
            supabaseClient
              .from("calendar_events")
              .select("*", opts)
              .eq("workspace_id", workspaceId)
              .is("deleted_at", null)
              .or(
                `recurrence_rule.not.is.null,and(start_time.lte.${toIso},end_time.gte.${fromIso})`,
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
  async createEvent({ workspaceId, title, startsAt, endsAt, allDay, rrule, description }) {
    const data = await runRpc(
      supabaseClient.rpc("calendar_op_event_create", {
        p_workspace_id: workspaceId,
        p_title: title,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_all_day: allDay ?? false,
        p_rrule: rrule ?? null,
        p_description: description ?? "",
      }),
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
  async upsertAccount({
    workspaceId,
    provider,
    externalId,
    displayLabel,
    color,
    status,
    lastSyncAt,
    syncToken,
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
};
