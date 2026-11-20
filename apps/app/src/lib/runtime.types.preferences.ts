/** The runtime port's preferences, dashboard (implemented in runtime.web.preferences.ts). */

import type { DashboardLayout } from "../features/dashboard/engine/types";
import type { TimeRegion, TimeRegionPatch } from "./time-region";

/**
 * Per-user UI / workflow settings that follow the user across devices
 * (cloud-first via Supabase; backed by the `user_preferences` table). Two
 * opaque JSONB domains, each with its own client-set `updatedAt` so they
 * reconcile independently (per-domain last-write-wins). The client owns the
 * field shapes and decides which fields are syncable — the runtime is dumb
 * transport. See src/lib/prefs-sync.ts and the appearance / focus-prefs hooks.
 */
export type UserPreferences = {
  appearance: Record<string, unknown> | null;
  appearanceUpdatedAt: string | null;
  focus: Record<string, unknown> | null;
  focusUpdatedAt: string | null;
  calendar: Record<string, unknown> | null;
  calendarUpdatedAt: string | null;
  email: Record<string, unknown> | null;
  emailUpdatedAt: string | null;
  preferences: Record<string, unknown> | null;
  preferencesUpdatedAt: string | null;
};

/** One synced domain of `UserPreferences` (a column + its `_updated_at`). */
export type PreferenceDomain = "appearance" | "focus" | "calendar" | "email" | "preferences";

/** A stored dashboard layout + its client-set LWW timestamp (DB-4). */
export type StoredDashboardLayout = {
  layout: DashboardLayout;
  updatedAt: string;
};

/**
 * Cross-device user settings (appearance + focus). Cloud-first: web hits
 * Supabase directly; desktop delegates to the web runtime. Both return null
 * when signed out. `set` upserts only the domains present in the patch.
 */
export type PreferencesRuntime = {
  get(): Promise<UserPreferences | null>;
  set(patch: Partial<UserPreferences>): Promise<UserPreferences | null>;
  /**
   * Save one domain, last write wins on the server (`prefs_op_set`): it is
   * written only when `updatedAt` is newer than the saved copy. Answers the
   * row as saved afterwards, so a caller whose copy lost sees the newer one.
   */
  setDomain(
    domain: PreferenceDomain,
    value: Record<string, unknown>,
    updatedAt: string,
  ): Promise<UserPreferences | null>;
  /**
   * Save the device's time zone for the signed-in person (TV-D8): repeats
   * come back at their midnight. Sent at every sign-in; an unknown zone is
   * refused by the server.
   */
  setTimeZone(timeZone: string): Promise<void>;
  /**
   * Time & region (TV-D14): the person's zone, week start, clock, date
   * order and "Share your tracked time with the workspace owner". Null when
   * signed out or before the migration.
   */
  getTimeRegion(): Promise<TimeRegion | null>;
  /** Change some of them (`user_op_set_time_region`); answers the whole setting. */
  setTimeRegion(patch: TimeRegionPatch): Promise<TimeRegion | null>;
  /**
   * The oldest app version that may still save (`app_settings.min_build`,
   * TV-D8), or null when it can't be read (the app then runs as normal).
   */
  getMinBuild(): Promise<string | null>;
};

/**
 * The Home dashboard layout for one user+workspace (DB-4). Preference-class:
 * a direct RLS upsert (no intent op, no activity, no registry) into the
 * `dashboard_layouts` table keyed by (user_id, workspace_id, 'home'). The whole
 * `{version, pages}` composition is one atomic JSONB blob; `updatedAt` is
 * client-set so the local cache and cloud reconcile last-write-wins. Returns
 * null when signed out or when no row exists yet (fresh user → curated default).
 */
export type DashboardRuntime = {
  get(workspaceId: string): Promise<StoredDashboardLayout | null>;
  save(input: { workspaceId: string; layout: DashboardLayout; updatedAt: string }): Promise<void>;
};
