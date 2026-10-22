import { prefsRowSchema, requireRow } from "@contracts/rows";

import type { DashboardLayout } from "../features/dashboard/engine/types";
import {
  missingOptionalPrefsDomain,
  optionalPrefsAvailable,
  prefsSelectCols,
} from "./prefs-columns";
import { DbError, type Json, runQuery, runRpc, type TableInsert, untypedDb } from "./runtime.db";
import type {
  DashboardRuntime,
  PreferenceDomain,
  PreferencesRuntime,
  UserPreferences,
} from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { getAuthedUser } from "./runtime.web.shared";
import { isMissingFunctionError } from "./task-rows";
import { timeRegionPatchToRow, timeRegionRowToModel } from "./time-region";

/** The `preferences.set` patch that writes one domain and its stamp. */
function prefsDomainPatch(
  domain: PreferenceDomain,
  value: Record<string, unknown>,
  updatedAt: string,
): Partial<UserPreferences> {
  switch (domain) {
    case "appearance":
      return { appearance: value, appearanceUpdatedAt: updatedAt };
    case "focus":
      return { focus: value, focusUpdatedAt: updatedAt };
    case "calendar":
      return { calendar: value, calendarUpdatedAt: updatedAt };
    case "email":
      return { email: value, emailUpdatedAt: updatedAt };
    case "preferences":
      return { preferences: value, preferencesUpdatedAt: updatedAt };
  }
}

/** The single dashboard's `layout_key` in the (legacy, reused) dashboard_layouts
 * table — one Home layout per user+workspace (DB-4). */
const DASHBOARD_LAYOUT_KEY = "home";

// The optional-prefs deploy-gap machinery (column lists + missing-column
// attribution + the retry-drop availability flags) lives in ./prefs-columns so it
// can be unit-tested in isolation; prefsRowToModel tolerates any optional column
// being absent at runtime.

function prefsRowToModel(raw: unknown): UserPreferences {
  const row = requireRow(prefsRowSchema, raw ?? {}, "preferences");
  return {
    appearance: (row.appearance as Record<string, unknown> | null) ?? null,
    appearanceUpdatedAt: row.appearance_updated_at ?? null,
    focus: (row.focus as Record<string, unknown> | null) ?? null,
    focusUpdatedAt: row.focus_updated_at ?? null,
    calendar: (row.calendar as Record<string, unknown> | null) ?? null,
    calendarUpdatedAt: row.calendar_updated_at ?? null,
    email: (row.email as Record<string, unknown> | null) ?? null,
    emailUpdatedAt: row.email_updated_at ?? null,
    preferences: (row.preferences as Record<string, unknown> | null) ?? null,
    preferencesUpdatedAt: row.preferences_updated_at ?? null,
  };
}

export const webPreferences: { preferences: PreferencesRuntime; dashboard: DashboardRuntime } = {
  preferences: {
    async get() {
      const user = await getAuthedUser();
      if (!user) return null;
      // Retry-drop optional columns one at a time as their missing-column errors
      // surface (deploy gap). At most two optional domains → three attempts.
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await supabaseClient
          .from("user_preferences")
          .select(prefsSelectCols())
          .eq("user_id", user.id)
          .maybeSingle();
        if (!res.error) return res.data ? prefsRowToModel(res.data) : null;
        const missing = missingOptionalPrefsDomain(res.error);
        if (!missing) throw new DbError(res.error);
        optionalPrefsAvailable[missing] = false; // deploy gap — column not applied yet
      }
      return null;
    },
    async set(patch) {
      const user = await getAuthedUser();
      if (!user) return null;
      // Upsert only the domains present in the patch; columns omitted here keep
      // their existing value on conflict (and their table default on insert). The
      // row is rebuilt each attempt so a dropped optional domain leaves it out.
      const buildRow = (): Record<string, unknown> => {
        const row: Record<string, unknown> = { user_id: user.id };
        if (patch.appearance !== undefined) row.appearance = patch.appearance ?? {};
        if (patch.appearanceUpdatedAt !== undefined)
          row.appearance_updated_at = patch.appearanceUpdatedAt;
        if (patch.focus !== undefined) row.focus = patch.focus ?? {};
        if (patch.focusUpdatedAt !== undefined) row.focus_updated_at = patch.focusUpdatedAt;
        if (patch.calendar !== undefined) row.calendar = patch.calendar ?? {};
        if (patch.calendarUpdatedAt !== undefined)
          row.calendar_updated_at = patch.calendarUpdatedAt;
        if (optionalPrefsAvailable.email) {
          if (patch.email !== undefined) row.email = patch.email ?? {};
          if (patch.emailUpdatedAt !== undefined) row.email_updated_at = patch.emailUpdatedAt;
        }
        if (optionalPrefsAvailable.preferences) {
          if (patch.preferences !== undefined) row.preferences = patch.preferences ?? {};
          if (patch.preferencesUpdatedAt !== undefined)
            row.preferences_updated_at = patch.preferencesUpdatedAt;
        }
        return row;
      };
      // NB: an optional-only push pre-migration then succeeds as a `{user_id}`
      // no-op, so prefs-sync clears its dirty flag though nothing synced. Benign —
      // the override stays in localStorage; it re-pushes on the next local edit
      // once the column exists. (Other domains in the same row are never dropped.)
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await supabaseClient
          .from("user_preferences")
          .upsert(buildRow() as TableInsert<"user_preferences">, { onConflict: "user_id" })
          .select(prefsSelectCols())
          .single();
        if (!res.error) return prefsRowToModel(res.data);
        const missing = missingOptionalPrefsDomain(res.error);
        if (!missing) throw new DbError(res.error);
        optionalPrefsAvailable[missing] = false; // deploy gap — retry without that domain
      }
      return null;
    },
    async setDomain(domain, value, updatedAt) {
      const user = await getAuthedUser();
      if (!user) return null;
      // Not in prod's types until 20261020140000 ships: untyped until then,
      // then `bun run db:types` and drop untypedDb.
      const { data, error } = await untypedDb(supabaseClient).rpc("prefs_op_set", {
        p_domain: domain,
        p_value: value ?? {},
        p_updated_at: updatedAt,
      });
      if (!error) return data ? prefsRowToModel(data) : null;
      // Before the migration: the plain upsert (an older copy can still win).
      if (isMissingFunctionError(error, "prefs_op_set")) {
        return webPreferences.preferences.set(prefsDomainPatch(domain, value, updatedAt));
      }
      throw new DbError(error);
    },
    async setTimeZone(timeZone) {
      await runRpc(supabaseClient.rpc("user_op_set_time_zone", { p_time_zone: timeZone }));
    },
    async getTimeRegion() {
      const data = await runRpc(supabaseClient.rpc("user_time_region"));
      return data ? timeRegionRowToModel(data) : null;
    },
    async setTimeRegion(patch) {
      const data = await runRpc(
        supabaseClient.rpc("user_op_set_time_region", {
          p_patch: timeRegionPatchToRow(patch) as Json,
        }),
      );
      return data ? timeRegionRowToModel(data) : null;
    },
    async getMinBuild() {
      const { data, error } = await supabaseClient
        .from("app_settings")
        .select("value")
        .eq("key", "min_build")
        .maybeSingle();
      if (error) return null;
      return typeof data?.value === "string" ? data.value : null;
    },
  },
  dashboard: {
    async get(workspaceId) {
      const user = await getAuthedUser();
      if (!user) return null;
      const data = await runQuery(
        supabaseClient
          .from("dashboard_layouts")
          .select("layout_data, updated_at")
          .eq("user_id", user.id)
          .eq("workspace_id", workspaceId)
          .eq("layout_key", DASHBOARD_LAYOUT_KEY)
          .maybeSingle(),
      );
      if (!data) return null;
      const row = data as unknown as { layout_data: DashboardLayout; updated_at: string };
      return { layout: row.layout_data, updatedAt: row.updated_at };
    },
    async save({ workspaceId, layout, updatedAt }) {
      const user = await getAuthedUser();
      if (!user) return;
      await runQuery(
        supabaseClient.from("dashboard_layouts").upsert(
          {
            user_id: user.id,
            workspace_id: workspaceId,
            layout_key: DASHBOARD_LAYOUT_KEY,
            layout_data: layout as unknown as Json,
            updated_at: updatedAt,
          },
          { onConflict: "user_id,workspace_id,layout_key" },
        ),
      );
    },
  },
};
