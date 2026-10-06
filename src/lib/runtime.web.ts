/**
 * Web (browser) implementation of ModuoRuntime.
 * All data operations go through @supabase/supabase-js against the moduohyb project.
 *
 * Desktop-only features (email, time-tracking, calendar OAuth, P2P, local mnemonic)
 * return { error: { message: "Desktop only" } } — the UI hides them via capabilities.
 */

import {
  activityRowSchema,
  bucketRowSchema,
  calendarAccountRowSchema,
  calendarEventRowSchema,
  commentRowSchema,
  companyRowSchema,
  contactFieldDefRowSchema,
  contactRowSchema,
  emailAccountRowSchema,
  emailRefRowSchema,
  entityLinkRowSchema,
  entityRecordRowSchema,
  habitRowSchema,
  linkSuggestionRowSchema,
  mapKnownRows,
  noteRowSchema,
  noteUpdateRowSchema,
  notificationRowSchema,
  parsedCalendarProvider,
  parsedMailboxProvider,
  parsedRelationKind,
  prefsRowSchema,
  requireRow,
  tagLinkRowSchema,
  tagRowSchema,
  taskRelationRowSchema,
  taskRowSchema,
} from "@contracts/rows";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import type { CalendarAccountModel, CalendarEventModel } from "../features/calendar/events";
import { defaultCalendarWindow } from "../features/calendar/window";
import type {
  Company,
  Contact,
  ContactChannel,
  ContactCustomValue,
  ContactDateEntry,
  ContactFieldDef,
} from "../features/contacts/model";
import { type OverdueFollowup, selectNeedsAttention } from "../features/contacts/needs-attention";
import { selectReconnect } from "../features/contacts/reconnect";
import type { DashboardLayout } from "../features/dashboard/engine/types";
import {
  type Note,
  type NoteUpdateRow,
  noteRowToModel,
  noteUpdateRowToModel,
  trashWindowCutoffIso,
} from "../features/notes/model";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../features/notes/utils/base64";
import type { NotificationItem } from "../features/spine/notifications";
import { type RecentLinkItem, shapeRecentLinks } from "../features/spine/recent";
import type { RawLinkSuggestion } from "../features/spine/suggest";
import {
  type ActivityEntry,
  type Bucket,
  sanitizeTimeBlocks,
  type Tag,
  type TagLink,
  type Task,
  type TaskRelation,
} from "../features/tasks/model";
import { toMemberPerm, toMemberRole } from "../features/workspaces/workspace-mappers";
import type { EntityLink, EntityRecord } from "./entity-links";
import { collectTruncations, READ_CAPS, readPaged, type Truncation } from "./paged-select";
import {
  missingOptionalPrefsDomain,
  optionalPrefsAvailable,
  prefsSelectCols,
} from "./prefs-columns";
import { createRequestCache } from "./request-cache";
import { webChatRuntime } from "./runtime.chat.web";
import type {
  AuthChangeEvent,
  AuthListener,
  EmailAccountRef,
  EmailThreadRef,
  HabitRow,
  IntegrationStatusItem,
  LocalAuthState,
  ModuoRuntime,
  RuntimeCapabilities,
  RuntimeSession,
  SpineComment,
  UserPreferences,
} from "./runtime.types";

// ── Supabase client ────────────────────────────────────────────────────────────

export const SUPABASE_URL: string =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: string =
  (import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  "sb_publishable_NAVl-rzFzPOi5ZU84aC3pA_SOIR00so";

export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ── Boot-time read coalescer (DF-12) ─────────────────────────────────────────────
// One cold launch used to fire `/auth/v1/user` ×8 (every user-scoped runtime method
// called `getUser()` on its own) and the profile read ×4 (the auth provider fetched
// it on both bootstrap and INITIAL_SESSION). This shares those reads: one auth/user
// + one profile per boot, deduped across every caller.
const bootReads = createRequestCache();
const AUTH_USER_KEY = "auth:user";
/** The profile's plan_tier can change (upgrade), but only via a user action long
 *  after boot; a short window collapses the launch double-read without pinning
 *  stale data (`refreshPlanTier` and friends run well past this). */
const PROFILE_TTL_MS = 5_000;

/**
 * The current authenticated user, deduped across the boot storm. Cached until an
 * identity transition invalidates it (below), so repeated boot reads share one
 * `/auth/v1/user` round-trip instead of ~16. Returns null when signed out.
 */
async function getAuthedUser() {
  try {
    // Cache ONLY a real authenticated user. A signed-out state and a transient
    // failure (offline / a mid-refresh 401 / a 5xx) both surface as `getUser()`
    // returning an error + null user — we throw on either so the request-cache
    // does NOT retain it. Otherwise one boot blip would pin `null` forever (Infinity
    // TTL, cleared only on a real sign-in/out) and brick every user-scoped read +
    // write for the whole session. `getAuthedUser` still resolves to `null` for the
    // caller (the old `getUser()` graceful-null contract), it just isn't cached, so
    // the next call retries — exactly the per-call self-heal the old code had.
    return await bootReads.read(
      AUTH_USER_KEY,
      async () => {
        const { data, error } = await supabaseClient.auth.getUser();
        if (error) throw error;
        if (!data.user) throw new Error("no authenticated user");
        return data.user;
      },
      Number.POSITIVE_INFINITY,
    );
  } catch {
    return null;
  }
}

// Drop the whole boot cache (user + profiles) on any identity transition. We keep
// it through INITIAL_SESSION and TOKEN_REFRESHED (same user), so those never
// re-trigger the storm — only a real sign-in/out / user-update clears it.
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
    bootReads.clear();
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

// ── Bounded module reads (SCALE-1) ────────────────────────────────────────────
// PostgREST caps EVERY select at `db-max-rows` (1000 here) and says nothing —
// and `.limit(5000)` does not lift it, it's a hard per-request ceiling. So the
// list reads page with `.range()` up to an explicit cap and report what they
// had to cut. See [paged-select.ts](./paged-select.ts) for the full rule.

type SelectOpts = { count: "exact"; head: true };
/** Rebuilds the *same* filtered query each call — a supabase builder is single-use. */
type QueryBuilderFn = (opts?: SelectOpts) => any;

type CappedRead<T> = { rows: T[]; error: any; truncation: Truncation | null };

/**
 * Page a filtered query up to `cap` rows.
 *
 * `build` must apply the select + every filter; `order` adds the sort to the
 * ROW query only (a head-count doesn't need one). Paging is only correct under
 * a total order, so `order` must end in a unique tiebreaker — `id`.
 */
async function selectCapped<T>(args: {
  scope: string;
  cap: number;
  build: QueryBuilderFn;
  order: (q: any) => any;
}): Promise<CappedRead<T>> {
  const res = await readPaged<T, any>({
    scope: args.scope,
    cap: args.cap,
    page: async (offset, limit) => {
      const { data, error } = await args.order(args.build()).range(offset, offset + limit - 1);
      return { data: (data ?? null) as T[] | null, error };
    },
    countTotal: async () => {
      const { count, error } = await args.build({ count: "exact", head: true });
      return error ? null : (count ?? null);
    },
    // Every table here is keyed by `id` — dedupe guards the offset-paging
    // window against concurrent inserts shifting rows across a page edge.
    keyOf: (row: any) => String(row?.id),
  });
  return { rows: res.rows, error: res.error, truncation: res.truncation };
}

function toError(error: unknown): { message: string } {
  if (error instanceof Error) return { message: error.message };
  if (error && typeof error === "object" && "message" in error)
    return { message: String((error as any).message) };
  return { message: String(error) };
}

function desktopOnly(): { message: string } {
  return { message: "This feature is only available on the desktop app." };
}

function sessionFromSupabase(supaSession: any): RuntimeSession | null {
  if (!supaSession?.access_token || !supaSession?.user?.id) return null;
  return {
    access_token: supaSession.access_token,
    refresh_token: supaSession.refresh_token ?? null,
    expires_at: supaSession.expires_at ?? undefined,
    user: {
      id: supaSession.user.id,
      email: supaSession.user.email ?? null,
    },
  };
}

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

// The optional-prefs deploy-gap machinery (column lists + missing-column
// attribution + the retry-drop availability flags) lives in ./prefs-columns so it
// can be unit-tested in isolation; prefsRowToModel tolerates any optional column
// being absent at runtime.

// LocalStore backed by localStorage for web
const LS_PREFIX = "moduo:ls:";

/** The single dashboard's `layout_key` in the (legacy, reused) dashboard_layouts
 * table — one Home layout per user+workspace (DB-4). */
const DASHBOARD_LAYOUT_KEY = "home";

/** Map a raw `habits` row to the HabitRow model (DB-7). The client is untyped,
 * so column renames are silent — keep this in lockstep with the migration. */
function mapHabitRow(raw: unknown): HabitRow {
  const r = requireRow(habitRowSchema, raw, "habit");
  return {
    id: r.id as string,
    workspaceId: (r.workspace_id as string) ?? "",
    name: (r.name as string) ?? "",
    emoji: (r.emoji as string) ?? "",
    position: (r.position as string) ?? "",
    checks: Array.isArray(r.checks) ? (r.checks as string[]) : [],
    createdAt: (r.created_at as string) ?? "",
    updatedAt: (r.updated_at as string) ?? "",
  };
}

// ── Capabilities ──────────────────────────────────────────────────────────────

export const webCapabilities: RuntimeCapabilities = {
  isDesktop: false,
  isWeb: true,
  hasEmail: false,
  hasTimeTracking: false,
  hasCalendarOAuth: false,
  hasLocalMnemonic: false,
  hasOfflineMode: false,
};

// ── Runtime implementation ────────────────────────────────────────────────────

export const webRuntime: ModuoRuntime = {
  capabilities: webCapabilities,

  // Chat (specs/chat.md): ops + RLS reads live in runtime.chat.web.ts. Only this
  // file imports it — importing it first elsewhere would hit the module cycle.
  chat: webChatRuntime,

  auth: {
    async getLocalAuthState() {
      // Cloud-auth equivalent of the desktop vault state: derived from the
      // Supabase session so display-name consumers work on every platform.
      const empty: LocalAuthState = {
        profileExists: false,
        displayName: null,
        userId: null,
        hasPin: false,
        hasKeychainMnemonic: false,
      };
      try {
        const { data } = await supabaseClient.auth.getSession();
        const user = data.session?.user;
        if (!user) return { data: empty, error: null };
        return {
          data: {
            profileExists: true,
            displayName: (user.user_metadata?.display_name as string | undefined) ?? null,
            userId: user.id,
            hasPin: false,
            hasKeychainMnemonic: false,
          },
          error: null,
        };
      } catch {
        return { data: empty, error: null };
      }
    },

    async generateMnemonic() {
      return { data: { words: [], phrase: "" }, error: desktopOnly() };
    },

    async registerLocalMnemonic() {
      return { data: { user: null, session: null }, error: desktopOnly() };
    },

    async unlockWithMnemonic() {
      return { data: { user: null, session: null }, error: desktopOnly() };
    },

    async forgotResetLocal() {
      return { error: desktopOnly() };
    },

    async tryAutoUnlock() {
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error || !data.session) return { data: { session: null }, error: null };
        return { data: { session: sessionFromSupabase(data.session) }, error: null };
      } catch (error) {
        return { data: { session: null }, error: toError(error) };
      }
    },

    async setPin() {
      return { error: desktopOnly() };
    },

    async unlockWithPin() {
      return { data: { session: null }, error: desktopOnly() };
    },

    async removePin() {
      return { error: desktopOnly() };
    },

    async updateDisplayName(displayName: string) {
      try {
        const {
          data: { user },
          error,
        } = await supabaseClient.auth.updateUser({
          data: { display_name: displayName },
        });
        if (error) return { data: { displayName }, error: toError(error) };
        // Also update profiles table
        const uid = user?.id;
        if (uid) {
          await supabaseClient.from("profiles").update({ display_name: displayName }).eq("id", uid);
          bootReads.invalidate(`profile:${uid}`); // the cached row now has a stale name
        }
        return { data: { displayName }, error: null };
      } catch (error) {
        return { data: { displayName }, error: toError(error) };
      }
    },

    async updateAvatarUrl(avatarUrl: string | null) {
      try {
        const user = await getAuthedUser();
        if (!user) return { data: { avatarUrl }, error: { message: "Not authenticated" } };
        const { error } = await supabaseClient
          .from("profiles")
          .update({ avatar_url: avatarUrl })
          .eq("id", user.id)
          .select("avatar_url")
          .single();
        if (error) return { data: { avatarUrl }, error: toError(error) };
        bootReads.invalidate(`profile:${user.id}`);
        return { data: { avatarUrl }, error: null };
      } catch (error) {
        return { data: { avatarUrl }, error: toError(error) };
      }
    },

    async getStoredMnemonic() {
      return { data: { phrase: null }, error: desktopOnly() };
    },

    async getSession() {
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) return { data: { session: null }, error: toError(error) };
        return { data: { session: sessionFromSupabase(data.session) }, error: null };
      } catch (error) {
        return { data: { session: null }, error: toError(error) };
      }
    },

    async refreshSession() {
      try {
        const { data, error } = await supabaseClient.auth.refreshSession();
        if (error) return { data: { user: null, session: null }, error: toError(error) };
        const session = sessionFromSupabase(data.session);
        return { data: { user: session?.user ?? null, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    onAuthStateChange(callback: AuthListener) {
      const {
        data: { subscription },
      } = supabaseClient.auth.onAuthStateChange((event, supaSession) => {
        const eventMap: Record<string, AuthChangeEvent> = {
          INITIAL_SESSION: "INITIAL_SESSION",
          SIGNED_IN: "SIGNED_IN",
          SIGNED_OUT: "SIGNED_OUT",
          TOKEN_REFRESHED: "TOKEN_REFRESHED",
          USER_UPDATED: "TOKEN_REFRESHED",
        };
        const mapped = eventMap[event] ?? "TOKEN_REFRESHED";
        callback(mapped, sessionFromSupabase(supaSession));
      });
      return { data: { subscription: { unsubscribe: () => subscription.unsubscribe() } } };
    },

    async signOut() {
      try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) return { error: toError(error) };
        return { error: null };
      } catch (error) {
        return { error: toError(error) };
      }
    },

    async signUpWithEmail({ email, password, displayName }) {
      try {
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName ?? "" } },
        });
        if (error) return { data: { user: null, session: null }, error: toError(error) };
        const session = sessionFromSupabase(data.session);
        return {
          data: {
            user:
              (session?.user ?? data.user)
                ? { id: data.user!.id, email: data.user!.email ?? null }
                : null,
            session,
          },
          error: null,
        };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    async signInWithEmail({ email, password }) {
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) return { data: { user: null, session: null }, error: toError(error) };
        const session = sessionFromSupabase(data.session);
        return { data: { user: session?.user ?? null, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    async sendOtp({ email }) {
      try {
        const { error } = await supabaseClient.auth.signInWithOtp({
          email,
          // Invite-only: sign-ups are off on the Supabase project, so only existing
          // or dashboard-invited users get a code. Never create a user from here.
          options: { shouldCreateUser: false },
        });
        if (error) return { data: {}, error: toError(error) };
        return { data: {}, error: null };
      } catch (error) {
        return { data: {}, error: toError(error) };
      }
    },

    async verifyOtp({ email, token, sentAt }) {
      try {
        const { data, error } = await supabaseClient.auth.verifyOtp({
          email,
          token,
          type: "email",
        });
        if (error) return { data: { user: null, session: null }, error: toError(error) };
        const session = sessionFromSupabase(data.session);
        // An invited user exists from invite time but is only confirmed on their first
        // sign-in, so "first confirmed" (not "first created") marks a new user.
        const firstSeenAt = data.user?.email_confirmed_at
          ? new Date(data.user.email_confirmed_at).getTime()
          : 0;
        const isNewUser = !!sentAt && !!firstSeenAt && firstSeenAt >= sentAt - 30_000;
        return { data: { user: session?.user ?? null, session, isNewUser }, error: null };
      } catch (error) {
        return { data: { user: null, session: null, isNewUser: false }, error: toError(error) };
      }
    },
  },

  workspace: {
    async getProfile(userId: string) {
      // Deduped across the boot double-read (bootstrap + INITIAL_SESSION) via a
      // short TTL. Only a successful row is cached — an error throws through so
      // it's retried, and the caller still gets the `{ data, error }` shape.
      try {
        const row = await bootReads.read(
          `profile:${userId}`,
          async () => {
            const { data, error } = await supabaseClient
              .from("profiles")
              .select("plan_tier, display_name, avatar_url")
              .eq("id", userId)
              .single();
            if (error) throw error;
            return data ?? null;
          },
          PROFILE_TTL_MS,
        );
        return { data: row, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    async list() {
      const { data, error } = await supabaseClient
        .from("workspaces")
        .select("*, workspace_members(*)")
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async create(name) {
      const user = await getAuthedUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabaseClient
        .from("workspaces")
        .insert({ name, owner_id: user.id })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async rename(workspaceId, name) {
      const { data, error } = await supabaseClient
        .from("workspaces")
        .update({ name })
        .eq("id", workspaceId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateBranding(workspaceId, branding) {
      const { data, error } = await supabaseClient
        .from("workspaces")
        .update({ icon: branding.icon, logo_url: branding.logoUrl })
        .eq("id", workspaceId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async leave(workspaceId) {
      const user = await getAuthedUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabaseClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
    },
    async softDelete(workspaceId) {
      const { error } = await supabaseClient
        .from("workspaces")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", workspaceId);
      if (error) throw new Error(error.message);
    },
    async issueInvite(workspaceId, email, role, modulePermissions, roleId) {
      const user = await getAuthedUser();
      const { data, error } = await supabaseClient
        .from("workspace_invites")
        .insert({
          workspace_id: workspaceId,
          created_by: user?.id,
          email,
          role,
          // PERM-1: the role id wins; the DB trigger rewrites `role` to its tier.
          ...(roleId ? { role_id: roleId } : {}),
          permissions_notes: modulePermissions?.notes ?? "write",
          permissions_tasks: modulePermissions?.tasks ?? "write",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async joinInvite(token) {
      // The invite row is invisible to the recipient (SELECT is owner/admin
      // only). Redemption goes through a definer function that checks the token.
      const { data, error } = await supabaseClient.rpc("workspace_op_accept_invite", {
        p_token: token.trim(),
      });
      if (error) {
        const message = error.message ?? "";
        if (/already a member/i.test(message)) {
          throw new Error("You're already a member of this workspace.");
        }
        if (/invalid or expired|not authenticated/i.test(message)) {
          throw new Error("Invalid or expired invite");
        }
        throw new Error(message);
      }
      return data;
    },
    async listMembers(workspaceId) {
      const { data, error } = await supabaseClient
        .from("workspace_members")
        .select("*, profiles(*)")
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async listInvites(workspaceId) {
      const { data, error } = await supabaseClient
        .from("workspace_invites")
        .select("*")
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async updateInvite(inviteId, role, modulePermissions, roleId) {
      const { error } = await supabaseClient
        .from("workspace_invites")
        .update({
          role,
          ...(roleId ? { role_id: roleId } : {}),
          permissions_notes: modulePermissions?.notes ?? "write",
          permissions_tasks: modulePermissions?.tasks ?? "write",
        })
        .eq("id", inviteId);
      if (error) throw new Error(error.message);
    },
    async revokeInvite(inviteId) {
      const { error } = await supabaseClient
        .from("workspace_invites")
        .update({ status: "revoked" })
        .eq("id", inviteId);
      if (error) throw new Error(error.message);
    },
    async updateMemberPermissions(memberId, role, modulePermissions) {
      // Managing ANOTHER member's row can't be a client-direct write (the base
      // workspace_members RLS is own-row) — route through the hierarchy-enforcing
      // op, which also blocks an admin from managing admins. Send the DB
      // vocabulary (editor→member, view/edit/admin→read/write).
      const { error } = await supabaseClient.rpc("workspace_op_set_member_role", {
        p_member_id: memberId,
        p_role: toMemberRole(role),
        p_perm_notes: toMemberPerm(modulePermissions?.notes),
        p_perm_tasks: toMemberPerm(modulePermissions?.tasks),
      });
      if (error) throw new Error(error.message);
    },
    async transferOwnership(memberId) {
      // Owner-only; promotes the target to owner and demotes the caller to admin
      // (SECURITY DEFINER, since it rewrites workspaces.owner_id). Needed by the
      // account-deletion flow — an owner hands off before deleting.
      const { error } = await supabaseClient.rpc("workspace_op_transfer_ownership", {
        p_member_id: memberId,
      });
      if (error) throw new Error(error.message);
    },
    async listRoles(workspaceId) {
      const { data, error } = await supabaseClient
        .from("workspace_roles")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("position")
        .order("id");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async upsertRole(input) {
      const { data, error } = await supabaseClient.rpc("workspace_op_role_upsert", {
        p_workspace_id: input.workspaceId,
        p_role_id: input.roleId,
        p_name: input.name,
        p_description: input.description,
        p_permissions: input.permissions,
        p_read_only: input.readOnly,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data[0] : data;
    },
    async deleteRole(roleId, reassignTo) {
      const { error } = await supabaseClient.rpc("workspace_op_role_delete", {
        p_role_id: roleId,
        p_reassign_to: reassignTo,
      });
      if (error) throw new Error(error.message);
    },
    async setMemberAccess(memberId, roleId, overrides) {
      const { data, error } = await supabaseClient.rpc("workspace_op_set_member_access", {
        p_member_id: memberId,
        p_role_id: roleId,
        p_overrides: overrides,
      });
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data[0] : data;
    },
    async removeMember(memberId) {
      // The base workspace_members write-RLS is own-row (only `leave` self-deletes),
      // so ejecting another member needs a SECURITY DEFINER op that checks the
      // caller is owner/admin and refuses to remove an owner or yourself. DF-24.
      const { error } = await supabaseClient.rpc("workspace_op_remove_member", {
        p_member_id: memberId,
      });
      if (error) throw new Error(error.message);
    },
    inviteUrl(token) {
      // Mirror notesV2.publishedUrl: web origin is correct wherever served;
      // desktop (tauri://) needs PUBLIC_WEB_ORIGIN. encodeURIComponent is
      // load-bearing — invite tokens are base64 (`+` `/` `=`), which are
      // path/query-hostile raw. DF-24.
      const configured = (import.meta.env.PUBLIC_WEB_ORIGIN as string | undefined)?.replace(
        /\/+$/,
        "",
      );
      const origin = configured || (typeof window !== "undefined" ? window.location.origin : "");
      return `${origin}/join?invite=${encodeURIComponent(token)}`;
    },
    async listNotifications() {
      const user = await getAuthedUser();
      if (!user) return [];
      const { data } = await supabaseClient
        .from("workspace_notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    async markNotificationRead(notificationId) {
      await supabaseClient
        .from("workspace_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId);
    },
    async markAllNotificationsRead() {
      const user = await getAuthedUser();
      if (!user) return;
      await supabaseClient
        .from("workspace_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("read_at", null);
    },

    // MCP connector keys (docs/moduo-mcp-connector.md). Explicit column list —
    // key_hash is never client-readable (column-level grant excludes it).
    async listApiKeys(workspaceId) {
      const { data, error } = await supabaseClient
        .from("workspace_api_keys")
        .select("id, workspace_id, name, key_prefix, scopes, created_at, last_used_at")
        .eq("workspace_id", workspaceId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        keyPrefix: row.key_prefix,
        scopes: (row.scopes ?? {}) as Record<string, string>,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at ?? null,
      }));
    },
    async createApiKey({ workspaceId, name, scopes }) {
      const { data, error } = await supabaseClient.rpc("workspace_api_keys_create", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_scopes: scopes,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("Key creation returned nothing.");
      return {
        id: row.id,
        workspaceId,
        name: row.name,
        keyPrefix: row.key_prefix,
        scopes: (row.scopes ?? {}) as Record<string, string>,
        createdAt: row.created_at,
        lastUsedAt: null,
        secret: row.secret,
      };
    },
    async revokeApiKey(keyId) {
      const { error } = await supabaseClient.rpc("workspace_api_keys_revoke", { p_key_id: keyId });
      if (error) throw new Error(error.message);
    },
    getMcpEndpoint() {
      return `${SUPABASE_URL}/functions/v1/moduo-mcp`;
    },
  },

  // LEGACY read-only surface (see runtime.types.ts) — the dashboard preview
  // widget on web; the redb import reads through the tauri implementation.
  notes: {
    async list(workspaceId) {
      const { data, error } = await supabaseClient
        .from("notes")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("position");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async getDocState(_workspaceId, noteId) {
      const { data, error } = await supabaseClient
        .from("notes")
        .select("doc_state")
        .eq("id", noteId)
        .single();
      if (error || !data) return null;
      return {
        snapshotB64: data.doc_state ?? "",
        lastCompactedUpdateId: 0,
        updates: [],
      };
    },
  },

  notesV2: {
    // ── Wave-3 rebuild surface (NO-1). Writes = notes_op_* RPCs (guard +
    // write + registry upsert + attributed activity); reads = indexed
    // SELECTs that DEGRADE pre-migration: the v2 column list 42703s until
    // the migration lands, so we fall back to the legacy columns and flag
    // the bundle degraded. Explicit mutations throw honest errors instead.
    async listMeta(workspaceId) {
      const V2_COLS =
        "id, workspace_id, created_by, parent_id, title, icon, is_pinned, position, is_archived, published_at, publish_token, doc_version, created_at, updated_at, deleted_at";
      const LEGACY_COLS =
        "id, workspace_id, created_by, parent_id, title, icon, is_pinned, position, is_archived, created_at, updated_at, deleted_at";
      const cutoff = trashWindowCutoffIso(new Date());
      const query = (cols: string) =>
        selectCapped<any>({
          scope: "notes",
          cap: READ_CAPS.notes,
          build: (opts) =>
            supabaseClient
              .from("notes")
              .select(cols, opts)
              .eq("workspace_id", workspaceId)
              .or(`deleted_at.is.null,deleted_at.gt.${cutoff}`),
          order: (q) => q.order("position").order("id"),
        });
      const res = await query(V2_COLS);
      if (!res.error) {
        return {
          notes: mapKnownRows(res.rows, mapNoteRow),
          degraded: false,
          truncated: collectTruncations(res.truncation),
        };
      }
      // Degrade ONLY on the deploy gap (missing v2 columns = 42703). An
      // outage/auth error must surface as an error, not an empty module.
      if (res.error.code !== "42703") throw new Error(res.error.message);
      const legacy = await query(LEGACY_COLS);
      if (legacy.error) throw new Error(legacy.error.message);
      return {
        notes: mapKnownRows(legacy.rows, mapNoteRow),
        degraded: true,
        truncated: collectTruncations(legacy.truncation),
      };
    },

    async pullDoc({ workspaceId, noteId, sinceUpdateId }) {
      // Log FIRST, snapshot SECOND. A concurrent compaction between the two
      // reads then only ever makes the snapshot NEWER than the log we hold —
      // applying both stays lossless (Yjs is idempotent). The reverse order
      // could pair a stale snapshot with a log missing its folded tail.
      const updRes = await supabaseClient
        .from("note_updates")
        .select("id, client_id, client_seq, update_b64")
        .eq("note_id", noteId)
        .gt("id", sinceUpdateId ?? 0)
        .order("id", { ascending: true });
      const updates = updRes.error ? [] : mapKnownRows(updRes.data ?? [], mapNoteUpdateRow);

      const noteRes = await supabaseClient
        .from("notes")
        .select("doc_state, doc_version")
        .eq("id", noteId)
        .eq("workspace_id", workspaceId)
        .single();
      if (noteRes.error) {
        if (noteRes.error.code !== "42703") throw new Error(noteRes.error.message);
        // Pre-migration there is no doc_version column — degrade to the
        // legacy snapshot-only shape rather than breaking the open note.
        const legacy = await supabaseClient
          .from("notes")
          .select("doc_state")
          .eq("id", noteId)
          .eq("workspace_id", workspaceId)
          .single();
        if (legacy.error) throw new Error(legacy.error.message);
        return { snapshotB64: legacy.data?.doc_state ?? null, docVersion: 0, updates: [] };
      }
      return {
        snapshotB64: noteRes.data?.doc_state ?? null,
        docVersion: noteRes.data?.doc_version ?? 0,
        updates,
      };
    },

    async create({ workspaceId, id, parentId, title, position, icon }) {
      const { data, error } = await supabaseClient.rpc("notes_op_create", {
        p_workspace_id: workspaceId,
        p_id: id ?? null,
        p_parent_id: parentId ?? null,
        p_title: title ?? "",
        p_position: position ?? "",
        p_icon: icon ?? null,
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_create"));
    },

    async rename({ workspaceId, noteId, title }) {
      const { data, error } = await supabaseClient.rpc("notes_op_rename", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_title: title,
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_rename"));
    },

    async move({ workspaceId, noteId, parentId, position }) {
      const { data, error } = await supabaseClient.rpc("notes_op_move", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_parent_id: parentId ?? null,
        p_position: position ?? "",
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_move"));
    },

    async setMeta({ workspaceId, noteId, patch }) {
      const { data, error } = await supabaseClient.rpc("notes_op_set_meta", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_patch: patch,
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_set_meta"));
    },

    async duplicate({ workspaceId, sourceNoteId, position }) {
      const { data, error } = await supabaseClient.rpc("notes_op_duplicate", {
        p_workspace_id: workspaceId,
        p_source_note_id: sourceNoteId,
        p_position: position ?? "",
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_duplicate"));
    },

    async archive({ workspaceId, noteId }) {
      const { data, error } = await supabaseClient.rpc("notes_op_archive", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_archive"));
    },

    async unarchive({ workspaceId, noteId }) {
      const { data, error } = await supabaseClient.rpc("notes_op_unarchive", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_unarchive"));
    },

    async trash({ workspaceId, noteId }) {
      const { data, error } = await supabaseClient.rpc("notes_op_trash", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
      });
      if (error) throw new Error(error.message);
      return {
        trashedIds: (data?.trashed_ids ?? []) as string[],
        count: Number(data?.count ?? 0),
      };
    },

    async restore({ workspaceId, noteId }) {
      const { data, error } = await supabaseClient.rpc("notes_op_restore", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
      });
      if (error) throw new Error(error.message);
      return {
        restoredIds: (data?.restored_ids ?? []) as string[],
        count: Number(data?.count ?? 0),
      };
    },

    async purge({ workspaceId, noteId }) {
      const { data, error } = await supabaseClient.rpc("notes_op_purge", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
      });
      if (error) throw new Error(error.message);
      return { count: Number(data?.count ?? 0) };
    },

    async purgeExpired(workspaceId) {
      // Module-load sweep (like tasks catch_up): degrade quietly pre-deploy —
      // a missing RPC must never break opening /notes.
      try {
        const { data, error } = await supabaseClient.rpc("notes_op_purge_expired", {
          p_workspace_id: workspaceId,
        });
        if (error) return { count: 0 };
        return { count: Number(data?.count ?? 0) };
      } catch {
        return { count: 0 };
      }
    },

    async publish({ workspaceId, noteId }) {
      const { data, error } = await supabaseClient.rpc("notes_op_publish", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_publish"));
    },

    async unpublish({ workspaceId, noteId }) {
      const { data, error } = await supabaseClient.rpc("notes_op_unpublish", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
      });
      if (error) throw new Error(error.message);
      return mapNoteRow(firstRow(data, "notes_op_unpublish"));
    },

    // The public read URL for a published note (NO-9b): the app's own
    // `/p/<token>` route (a public SPA page that renders body_md client-side —
    // Supabase edge functions can't serve HTML). On web, window.location.origin
    // is correct wherever served; desktop (tauri://) needs PUBLIC_WEB_ORIGIN set
    // to the deployed web origin.
    publishedUrl(token) {
      const configured = (import.meta.env.PUBLIC_WEB_ORIGIN as string | undefined)?.replace(
        /\/+$/,
        "",
      );
      const origin = configured || (typeof window !== "undefined" ? window.location.origin : "");
      return `${origin}/p/${encodeURIComponent(token)}`;
    },

    async recent({ workspaceId, limit }) {
      const { data, error } = await supabaseClient
        .from("notes")
        .select("id, title, body_text, updated_at, is_archived, published_at, deleted_at")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit ?? 8);
      // Pre-migration the v2 columns 42703 — degrade to no rows (a widget must
      // never wall), like listMeta/search.
      if (error) {
        if (error.code === "42703") return [];
        throw new Error(error.message);
      }
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id as string,
        title: (r.title as string) ?? "",
        bodyText: (r.body_text as string) ?? "",
        updatedAt: (r.updated_at as string) ?? "",
        isArchived: Boolean(r.is_archived),
        publishedAt: (r.published_at as string | null) ?? null,
      }));
    },

    async pushUpdates({ workspaceId, noteId, clientId, updates, bodyText, bodyMd }) {
      const { data, error } = await supabaseClient.rpc("notes_op_apply_updates", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_client_id: clientId,
        p_updates: updates,
        p_body_text: bodyText ?? null,
        p_body_md: bodyMd ?? null,
      });
      if (error) throw new Error(error.message);
      return {
        inserted: Number(data?.inserted ?? 0),
        duplicates: Number(data?.duplicates ?? 0),
        maxUpdateId: data?.max_update_id == null ? null : Number(data.max_update_id),
      };
    },

    async saveSnapshot({ workspaceId, noteId, snapshotB64, uptoUpdateId, bodyText, bodyMd }) {
      const { data, error } = await supabaseClient.rpc("notes_op_save_snapshot", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_snapshot_b64: snapshotB64,
        p_upto_update_id: uptoUpdateId,
        p_body_text: bodyText ?? null,
        p_body_md: bodyMd ?? null,
      });
      if (error) throw new Error(error.message);
      return {
        folded: Number(data?.folded ?? 0),
        docVersion: Number(data?.doc_version ?? 0),
      };
    },

    async seedDoc({ workspaceId, noteId, docStateB64, bodyText, bodyMd }) {
      const { data, error } = await supabaseClient.rpc("notes_op_seed_doc", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_doc_state_b64: docStateB64,
        p_body_text: bodyText ?? null,
        p_body_md: bodyMd ?? null,
      });
      if (error) throw new Error(error.message);
      return {
        seeded: Boolean(data?.seeded),
        reason: (data?.reason as string | undefined) ?? null,
        docVersion: data?.doc_version == null ? null : Number(data.doc_version),
      };
    },

    async listUnmaterialized({ workspaceId, limit }) {
      const { data, error } = await supabaseClient.rpc("notes_list_unmaterialized", {
        p_workspace_id: workspaceId,
        p_limit: limit ?? 200,
      });
      // The repair sweep is opportunistic — it must never wall the module
      // between merging this code and deploying the migration (the recorded
      // new-RPC deploy-gap trap). But degrade LOUDLY for anything that is not
      // that gap: a silent [] on, say, a renamed param would make the whole
      // backfill a permanent no-op nobody ever notices.
      if (error) {
        const undeployed = error.code === "42883" || error.code === "PGRST202";
        if (!undeployed) {
          console.warn("[notes] listUnmaterialized failed", error.code, error.message);
        }
        return [];
      }
      return (data ?? []).map((r: any) => ({
        id: String(r.o_id),
        bodyMd: String(r.o_body_md ?? ""),
      }));
    },

    async importNotes({ workspaceId, rows }) {
      const payload = rows.map((r) => ({
        id: r.id ?? null,
        parentId: r.parentId ?? null,
        title: r.title ?? "",
        icon: r.icon ?? null,
        position: r.position ?? "",
        docStateB64: r.docStateB64 ?? null,
        bodyText: r.bodyText ?? "",
        bodyMd: r.bodyMd ?? "",
      }));
      const { data, error } = await supabaseClient.rpc("notes_op_import", {
        p_workspace_id: workspaceId,
        p_rows: payload,
      });
      if (error) throw new Error(error.message);
      return {
        imported: Number(data?.imported ?? 0),
        skipped: Number(data?.skipped ?? 0),
      };
    },

    async mention({ workspaceId, noteId, mentionedUserIds }) {
      const { error } = await supabaseClient.rpc("notes_op_mention", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_mentioned_user_ids: mentionedUserIds,
      });
      if (error) throw new Error(error.message);
    },

    async search({ workspaceId, query, limit }) {
      const q = query.trim();
      if (!q) return [];
      const { data, error } = await supabaseClient
        .from("notes")
        .select("id, title, body_text, is_archived, deleted_at")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .textSearch("search_tsv", q, { type: "websearch", config: "simple" })
        .limit(limit ?? 30);
      // Pre-migration the v2 columns (search_tsv/body_text/is_archived) 42703 —
      // degrade to no results rather than an error, like listMeta.
      if (error) {
        if (error.code === "42703") return [];
        throw new Error(error.message);
      }
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id as string,
        title: (r.title as string) ?? "",
        bodyText: (r.body_text as string) ?? "",
        isArchived: Boolean(r.is_archived),
        deletedAt: (r.deleted_at as string | null) ?? null,
      }));
    },

    async fetchExportDocs({ workspaceId, ids }) {
      if (ids.length === 0) return [];
      const { data, error } = await supabaseClient
        .from("notes")
        .select("id, title, body_md")
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      if (error) {
        if (error.code === "42703") return [];
        throw new Error(error.message);
      }
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id as string,
        title: (r.title as string) ?? "",
        bodyMd: (r.body_md as string) ?? "",
      }));
    },
  },

  migration: {
    async importLegacy() {
      throw new Error(desktopOnly().message);
    },
  },

  localStore: {
    async get(namespace, key) {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(`${LS_PREFIX}${namespace}:${key}`);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async set(namespace, key, value) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(`${LS_PREFIX}${namespace}:${key}`, JSON.stringify(value));
    },
    async remove(namespace, key) {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(`${LS_PREFIX}${namespace}:${key}`);
    },
  },

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
        if (!missing) throw new Error(res.error.message);
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
          .upsert(buildRow(), { onConflict: "user_id" })
          .select(prefsSelectCols())
          .single();
        if (!res.error) return prefsRowToModel(res.data);
        const missing = missingOptionalPrefsDomain(res.error);
        if (!missing) throw new Error(res.error.message);
        optionalPrefsAvailable[missing] = false; // deploy gap — retry without that domain
      }
      return null;
    },
  },

  dashboard: {
    async get(workspaceId) {
      const user = await getAuthedUser();
      if (!user) return null;
      const { data, error } = await supabaseClient
        .from("dashboard_layouts")
        .select("layout_data, updated_at")
        .eq("user_id", user.id)
        .eq("workspace_id", workspaceId)
        .eq("layout_key", DASHBOARD_LAYOUT_KEY)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const row = data as { layout_data: DashboardLayout; updated_at: string };
      return { layout: row.layout_data, updatedAt: row.updated_at };
    },
    async save({ workspaceId, layout, updatedAt }) {
      const user = await getAuthedUser();
      if (!user) return;
      const { error } = await supabaseClient.from("dashboard_layouts").upsert(
        {
          user_id: user.id,
          workspace_id: workspaceId,
          layout_key: DASHBOARD_LAYOUT_KEY,
          layout_data: layout,
          updated_at: updatedAt,
        },
        { onConflict: "user_id,workspace_id,layout_key" },
      );
      if (error) throw new Error(error.message);
    },
  },

  habits: {
    async list(workspaceId) {
      const user = await getAuthedUser();
      if (!user) return [];
      const { data, error } = await supabaseClient
        .from("habits")
        .select("id, workspace_id, name, emoji, position, checks, created_at, updated_at")
        .eq("user_id", user.id)
        .eq("workspace_id", workspaceId)
        .order("position", { ascending: true });
      // The habits table is deploy-gated — a missing relation degrades to [] (a
      // widget must never wall), like notesV2.recent's 42703 guard.
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw new Error(error.message);
      }
      return mapKnownRows(data, mapHabitRow);
    },
    async upsert({ id, workspaceId, name, emoji, position }) {
      const user = await getAuthedUser();
      if (!user) throw new Error("Not signed in");
      const row = {
        ...(id ? { id } : {}),
        user_id: user.id,
        workspace_id: workspaceId,
        name,
        emoji,
        position,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabaseClient
        .from("habits")
        .upsert(row)
        .select("id, workspace_id, name, emoji, position, checks, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return mapHabitRow(data);
    },
    async setChecks({ id, checks }) {
      const { error } = await supabaseClient
        .from("habits")
        .update({ checks, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    async remove(id) {
      const { error } = await supabaseClient.from("habits").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
  },

  window: {
    async toggleFullscreen() {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return false;
      } else {
        await document.documentElement.requestFullscreen();
        return true;
      }
    },
    async openExternalUrl(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  },

  timetracking: {
    async list() {
      return { entries: [], categories: [], rules: [], projects: [] };
    },
    async upsertEntry() {
      throw new Error(desktopOnly().message);
    },
    async deleteEntry() {
      throw new Error(desktopOnly().message);
    },
    async upsertCategory() {
      throw new Error(desktopOnly().message);
    },
    async deleteCategory() {
      throw new Error(desktopOnly().message);
    },
    async upsertRule() {
      throw new Error(desktopOnly().message);
    },
    async deleteRule() {
      throw new Error(desktopOnly().message);
    },
    async upsertProject() {
      throw new Error(desktopOnly().message);
    },
    async deleteProject() {
      throw new Error(desktopOnly().message);
    },
    async upsertFocusSession() {
      throw new Error(desktopOnly().message);
    },
    async getActiveWindow() {
      return null;
    },
    async startTracking() {
      throw new Error(desktopOnly().message);
    },
    async stopTracking() {
      throw new Error(desktopOnly().message);
    },
    async getTrackingStatus() {
      return { isTracking: false };
    },
  },

  email: {
    async listAccounts() {
      return [];
    },
    async connectAndSave() {
      throw new Error(desktopOnly().message);
    },
    async disconnect() {
      throw new Error(desktopOnly().message);
    },
    async listEnvelopes() {
      throw new Error(desktopOnly().message);
    },
    async getMessageBody() {
      throw new Error(desktopOnly().message);
    },
    async prefetchBodies() {
      throw new Error(desktopOnly().message);
    },
    async syncNow() {
      throw new Error(desktopOnly().message);
    },
    async setActivityState() {
      /* no-op on web */
    },
    async applyFlag() {
      throw new Error(desktopOnly().message);
    },
    async getMailboxStatus() {
      return [];
    },
    async setHistoryDepth() {
      throw new Error(desktopOnly().message);
    },
    async sendSaved() {
      throw new Error(desktopOnly().message);
    },
    async startGoogleOAuth() {
      throw new Error(desktopOnly().message);
    },
    async getThread() {
      throw new Error(desktopOnly().message);
    },
    async listFolders() {
      return [];
    },
    async applyMessageOp() {
      throw new Error(desktopOnly().message);
    },
    async snoozeThread() {
      throw new Error(desktopOnly().message);
    },
    async snoozeRestore() {
      throw new Error(desktopOnly().message);
    },
    async sendMessage() {
      throw new Error(desktopOnly().message);
    },
    async listAttachments() {
      return [];
    },
    async saveAttachment() {
      throw new Error(desktopOnly().message);
    },
    async pickAttachments() {
      return [];
    },
    async getInlineImages() {
      return [];
    },
    // Local search rides the desktop engine cache — web has no envelopes to scan.
    async searchBodies() {
      return [];
    },
    async searchServer() {
      return { status: "unsupported", message: null, envelopes: [] };
    },

    // ── EM-3 cloud tissue surface (Supabase-first; works on web + desktop) ──
    async listModule(workspaceId) {
      try {
        const live = (table: string) => (opts?: SelectOpts) =>
          supabaseClient
            .from(table)
            .select("*", opts)
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null);
        const [accountsRes, refsRes] = await Promise.all([
          selectCapped<any>({
            scope: "mailboxes",
            cap: READ_CAPS.emailAccounts,
            build: live("email_accounts"),
            order: (q) => q.order("created_at", { ascending: true }).order("id"),
          }),
          selectCapped<any>({
            scope: "threads",
            cap: READ_CAPS.emailRefs,
            build: live("email_refs"),
            order: (q) => q.order("updated_at", { ascending: false }).order("id"),
          }),
        ]);
        // Either table missing (pre-migration) → degrade to empty, never crash.
        if (accountsRes.error || refsRes.error) {
          return { accounts: [], refs: [], degraded: true, truncated: [] };
        }
        return {
          accounts: mapKnownRows(accountsRes.rows, emailAccountRowToModel),
          refs: mapKnownRows(refsRes.rows, emailRefRowToModel),
          degraded: false,
          truncated: collectTruncations(accountsRes.truncation, refsRes.truncation),
        };
      } catch {
        return { accounts: [], refs: [], degraded: true, truncated: [] };
      }
    },
    async upsertAccountRef({
      workspaceId,
      provider,
      address,
      signatureHtml,
      color,
      status,
      unreadCount,
    }) {
      const { data, error } = await supabaseClient.rpc("email_op_account_upsert", {
        p_workspace_id: workspaceId,
        p_provider: provider,
        p_address: address,
        p_signature_html: signatureHtml ?? null,
        p_color: color ?? null,
        p_status: status ?? null,
        p_unread_count: unreadCount ?? null,
      });
      if (error) throw new Error(error.message);
      return emailAccountRowToModel(firstRow(data, "email_op_account_upsert"));
    },
    async removeAccountRef({ workspaceId, accountId }) {
      const { error } = await supabaseClient.rpc("email_op_account_remove", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
      });
      if (error) throw new Error(error.message);
    },
    async upsertRef({
      workspaceId,
      threadKey,
      accountId,
      messageKey,
      fromAddr,
      fromName,
      subject,
      snippet,
      sentAt,
    }) {
      const { data, error } = await supabaseClient.rpc("email_op_ref_upsert", {
        p_workspace_id: workspaceId,
        p_thread_key: threadKey,
        p_account_id: accountId ?? null,
        p_message_key: messageKey ?? null,
        p_from_addr: fromAddr ?? null,
        p_from_name: fromName ?? null,
        p_subject: subject ?? "",
        p_snippet: snippet ?? "",
        p_sent_at: sentAt ?? null,
      });
      if (error) throw new Error(error.message);
      return emailRefRowToModel(firstRow(data, "email_op_ref_upsert"));
    },
    async snooze({ workspaceId, refId, snoozeUntil }) {
      const { data, error } = await supabaseClient.rpc("email_op_snooze", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
        p_snooze_until: snoozeUntil,
      });
      if (error) throw new Error(error.message);
      return emailRefRowToModel(firstRow(data, "email_op_snooze"));
    },
    async unsnooze({ workspaceId, refId }) {
      const { data, error } = await supabaseClient.rpc("email_op_unsnooze", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      });
      if (error) throw new Error(error.message);
      return emailRefRowToModel(firstRow(data, "email_op_unsnooze"));
    },
    async snoozeDue({ workspaceId, refId }) {
      const { data, error } = await supabaseClient.rpc("email_op_snooze_due", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      });
      if (error) throw new Error(error.message);
      return emailRefRowToModel(firstRow(data, "email_op_snooze_due"));
    },
    async followUp({ workspaceId, refId, followUpAt }) {
      const { data, error } = await supabaseClient.rpc("email_op_follow_up", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
        p_follow_up_at: followUpAt,
      });
      if (error) throw new Error(error.message);
      return emailRefRowToModel(firstRow(data, "email_op_follow_up"));
    },
    async clearFollowUp({ workspaceId, refId }) {
      const { data, error } = await supabaseClient.rpc("email_op_clear_follow_up", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      });
      if (error) throw new Error(error.message);
      return emailRefRowToModel(firstRow(data, "email_op_clear_follow_up"));
    },
    async followUpDue({ workspaceId, refId }) {
      const { data, error } = await supabaseClient.rpc("email_op_follow_up_due", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      });
      if (error) throw new Error(error.message);
      // Returns SQL NULL (→ no row) when there's nothing to do; not an error.
      // Guard on row.id too (the all-NULL-composite gotcha) like deleteLink does.
      const row = Array.isArray(data) ? data[0] : data;
      return row?.id ? emailRefRowToModel(row) : null;
    },
    async removeRef({ workspaceId, refId }) {
      const { error } = await supabaseClient.rpc("email_op_ref_remove", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      });
      if (error) throw new Error(error.message);
    },
    async linkThread({
      workspaceId,
      threadId,
      targetType,
      targetId,
      relationKind,
      origin,
      threadLabel,
      targetLabel,
      targetIcon,
    }) {
      const { data, error } = await supabaseClient.rpc("email_op_link", {
        p_workspace_id: workspaceId,
        p_thread_id: threadId,
        p_target_type: targetType,
        p_target_id: targetId,
        p_relation_kind: relationKind ?? "references",
        p_origin: origin ?? "manual",
        p_thread_label: threadLabel ?? null,
        p_target_label: targetLabel ?? null,
        p_target_icon: targetIcon ?? null,
      });
      if (error) throw new Error(error.message);
      return firstRow(data, "email_op_link");
    },
  },

  integrations: {
    async getStatus(): Promise<IntegrationStatusItem[]> {
      return [];
    },
    async connectZoom(): Promise<IntegrationStatusItem> {
      throw new Error(desktopOnly().message);
    },
    async connectGoogleMeet(): Promise<IntegrationStatusItem> {
      throw new Error(desktopOnly().message);
    },
    async disconnect(): Promise<void> {
      throw new Error(desktopOnly().message);
    },
  },

  calendar: {
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
      const { data, error } = await supabaseClient.rpc("calendar_op_event_create", {
        p_workspace_id: workspaceId,
        p_title: title,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_all_day: allDay ?? false,
        p_rrule: rrule ?? null,
        p_description: description ?? "",
      });
      if (error) throw new Error(error.message);
      return calendarEventRowToModel(firstRow(data, "calendar_op_event_create"));
    },
    async updateEvent({ workspaceId, eventId, patch }) {
      const { data, error } = await supabaseClient.rpc("calendar_op_event_update", {
        p_workspace_id: workspaceId,
        p_event_id: eventId,
        p_patch: patch,
      });
      if (error) throw new Error(error.message);
      return calendarEventRowToModel(firstRow(data, "calendar_op_event_update"));
    },
    async removeEvent({ workspaceId, eventId }) {
      const { error } = await supabaseClient.rpc("calendar_op_event_delete", {
        p_workspace_id: workspaceId,
        p_event_id: eventId,
      });
      if (error) throw new Error(error.message);
    },
    async restoreEvent({ workspaceId, eventId }) {
      const { data, error } = await supabaseClient.rpc("calendar_op_event_restore", {
        p_workspace_id: workspaceId,
        p_event_id: eventId,
      });
      if (error) throw new Error(error.message);
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
      const { data, error } = await supabaseClient.rpc("calendar_op_account_upsert", args);
      if (error) throw new Error(error.message);
      return calendarAccountRowToModel(firstRow(data, "calendar_op_account_upsert"));
    },
    async removeAccount({ workspaceId, accountId }) {
      const { error } = await supabaseClient.rpc("calendar_op_account_remove", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
      });
      if (error) throw new Error(error.message);
    },
    async mirrorEvents({ workspaceId, accountId, events, deletedExternalIds }) {
      const { data, error } = await supabaseClient.rpc("calendar_op_mirror_events", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
        p_events: events,
        p_deleted_external_ids: deletedExternalIds ?? [],
      });
      if (error) throw new Error(error.message);
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
  },

  // ── Tasks module ───────────────────────────────────────────────────────────
  // Supabase-backed mirror of the desktop redb path. RLS scopes every row to the
  // workspace; the Inbox bucket is seeded lazily here (no DB trigger). camelCase
  // model fields map to snake_case columns via the helpers at the bottom of this
  // file.
  tasks: {
    async list(workspaceId) {
      await ensureWebInbox(workspaceId);
      const live = (table: string) => (opts?: SelectOpts) =>
        supabaseClient
          .from(table)
          .select("*", opts)
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null);
      const all = (table: string) => (opts?: SelectOpts) =>
        supabaseClient.from(table).select("*", opts).eq("workspace_id", workspaceId);
      const [bucketsRes, tasksRes, tagsRes, linksRes, relationsRes] = await Promise.all([
        selectCapped<any>({
          scope: "buckets",
          cap: READ_CAPS.buckets,
          build: live("buckets"),
          order: (q) => q.order("position").order("id"),
        }),
        selectCapped<any>({
          scope: "tasks",
          cap: READ_CAPS.tasks,
          build: live("tasks"),
          order: (q) => q.order("position").order("id"),
        }),
        selectCapped<any>({
          scope: "tags",
          cap: READ_CAPS.tags,
          build: live("tags"),
          order: (q) => q.order("created_at").order("id"),
        }),
        selectCapped<any>({
          scope: "tag assignments",
          cap: READ_CAPS.tagLinks,
          build: all("tag_links"),
          order: (q) => q.order("id"),
        }),
        selectCapped<any>({
          scope: "task dependencies",
          cap: READ_CAPS.taskRelations,
          build: all("task_relations"),
          order: (q) => q.order("id"),
        }),
      ]);
      const firstError =
        bucketsRes.error || tasksRes.error || tagsRes.error || linksRes.error || relationsRes.error;
      if (firstError) throw new Error(firstError.message);
      return {
        buckets: mapKnownRows(bucketsRes.rows, bucketRowToModel),
        tasks: mapKnownRows(tasksRes.rows, taskRowToModel),
        tags: mapKnownRows(tagsRes.rows, tagRowToModel),
        tagLinks: mapKnownRows(linksRes.rows, tagLinkRowToModel),
        taskRelations: mapKnownRows(relationsRes.rows, taskRelationRowToModel),
        truncated: collectTruncations(
          bucketsRes.truncation,
          tasksRes.truncation,
          tagsRes.truncation,
          linksRes.truncation,
          relationsRes.truncation,
        ),
      };
    },

    async seedInbox(workspaceId) {
      return ensureWebInbox(workspaceId);
    },

    async upsertBucket(bucket) {
      const id = bucket.id?.trim() || crypto.randomUUID();
      const user = await getAuthedUser();
      const now = new Date().toISOString();
      const { data: prev } = await supabaseClient
        .from("buckets")
        .select("is_system, created_at")
        .eq("id", id)
        .maybeSingle();
      // is_system is owned by the seeding path only — never settable via upsert.
      const row = {
        id,
        workspace_id: bucket.workspaceId,
        owner_id: bucket.ownerId || user?.id || null,
        name: bucket.name,
        is_system: prev ? prev.is_system : false,
        group_label: bucket.group ?? null,
        position: bucket.position ?? "",
        created_at: prev ? prev.created_at : bucket.createdAt || now,
        updated_at: now,
        deleted_at: bucket.deletedAt ?? null,
      };
      const { data, error } = await supabaseClient
        .from("buckets")
        .upsert(row, { onConflict: "id" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return bucketRowToModel(data);
    },

    async deleteBucket({ workspaceId, bucketId }) {
      const { data: bucket } = await supabaseClient
        .from("buckets")
        .select("is_system")
        .eq("id", bucketId)
        .maybeSingle();
      if (!bucket) return;
      if (bucket.is_system) throw new Error("The Inbox bucket cannot be deleted");
      // Reassign live tasks to Inbox so none are orphaned, then soft-delete.
      const inbox = await ensureWebInbox(workspaceId);
      const now = new Date().toISOString();
      await supabaseClient
        .from("tasks")
        .update({ bucket_id: inbox.id, updated_at: now })
        .eq("bucket_id", bucketId)
        .is("deleted_at", null);
      const { error } = await supabaseClient
        .from("buckets")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", bucketId);
      if (error) throw new Error(error.message);
    },

    async upsertTask(task) {
      const id = task.id?.trim() || crypto.randomUUID();
      const user = await getAuthedUser();
      const now = new Date().toISOString();
      // Every task lives in exactly one bucket; an empty/unknown/deleted/cross-
      // workspace bucket falls back to Inbox (spec §6/§7).
      let bucketId = task.bucketId;
      let bucketOk = false;
      if (bucketId) {
        const { data: b } = await supabaseClient
          .from("buckets")
          .select("workspace_id, deleted_at")
          .eq("id", bucketId)
          .maybeSingle();
        bucketOk = !!b && b.workspace_id === task.workspaceId && !b.deleted_at;
      }
      if (!bucketOk) bucketId = (await ensureWebInbox(task.workspaceId)).id;
      const { data: prev } = await supabaseClient
        .from("tasks")
        .select("created_at")
        .eq("id", id)
        .maybeSingle();
      const row = taskModelToRow({
        ...task,
        id,
        bucketId,
        ownerId: task.ownerId || user?.id || "",
        createdAt: prev ? prev.created_at : task.createdAt || now,
        updatedAt: now,
      });
      const { data, error } = await supabaseClient
        .from("tasks")
        .upsert(row, { onConflict: "id" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return taskRowToModel(data);
    },

    async deleteTask({ taskId }) {
      const now = new Date().toISOString();
      const { data, error } = await supabaseClient
        .from("tasks")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", taskId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      // Deleting a parent promotes its subtasks to top-level (never lose work).
      await supabaseClient
        .from("tasks")
        .update({ parent_id: null, updated_at: now })
        .eq("parent_id", taskId)
        .is("deleted_at", null);
      return taskRowToModel(data);
    },

    async upsertTag(tag) {
      const id = tag.id?.trim() || crypto.randomUUID();
      const user = await getAuthedUser();
      const now = new Date().toISOString();
      const { data: prev } = await supabaseClient
        .from("tags")
        .select("created_at")
        .eq("id", id)
        .maybeSingle();
      const row = {
        id,
        workspace_id: tag.workspaceId,
        owner_id: tag.ownerId || user?.id || null,
        name: tag.name,
        color: tag.color ?? null,
        created_at: prev ? prev.created_at : tag.createdAt || now,
        updated_at: now,
        deleted_at: tag.deletedAt ?? null,
      };
      const { data, error } = await supabaseClient
        .from("tags")
        .upsert(row, { onConflict: "id" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return tagRowToModel(data);
    },

    async deleteTag({ tagId }) {
      const now = new Date().toISOString();
      // tag_links cascade on tag delete in the schema, but soft-delete the tag.
      await supabaseClient.from("tag_links").delete().eq("tag_id", tagId);
      const { error } = await supabaseClient
        .from("tags")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", tagId);
      if (error) throw new Error(error.message);
    },

    async attachTag({ workspaceId, tagId, entityType, entityId }) {
      const { data: existing } = await supabaseClient
        .from("tag_links")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("tag_id", tagId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .maybeSingle();
      if (existing) return tagLinkRowToModel(existing);
      const { data, error } = await supabaseClient
        .from("tag_links")
        .insert({
          workspace_id: workspaceId,
          tag_id: tagId,
          entity_type: entityType,
          entity_id: entityId,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return tagLinkRowToModel(data);
    },

    async detachTag({ workspaceId, tagId, entityType, entityId }) {
      const { error } = await supabaseClient
        .from("tag_links")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("tag_id", tagId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId);
      if (error) throw new Error(error.message);
    },

    async listEntityTags({ workspaceId, entityType, entityId }) {
      // The links half is one entity's rows (never near a page); the tags half
      // is workspace-wide, so it pages like every other list read (SCALE-1).
      const [tagsRes, linksRes] = await Promise.all([
        selectCapped<any>({
          scope: "tags",
          cap: READ_CAPS.tags,
          build: (opts) =>
            supabaseClient
              .from("tags")
              .select("*", opts)
              .eq("workspace_id", workspaceId)
              .is("deleted_at", null),
          order: (q) => q.order("created_at").order("id"),
        }),
        supabaseClient
          .from("tag_links")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .order("created_at"),
        supabaseClient
          .from("tag_links")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("entity_type", entityType)
          .eq("entity_id", entityId),
      ]);
      const firstError = tagsRes.error || linksRes.error;
      if (firstError) throw new Error(firstError.message);
      return {
        tags: mapKnownRows(tagsRes.rows, tagRowToModel),
        links: mapKnownRows(linksRes.data, tagLinkRowToModel),
      };
    },

    async listTagLinks({ workspaceId, entityTypes }) {
      // This used to read `.limit(5000)` with a comment claiming it lifted
      // PostgREST's cap. It did NOT — max-rows is a hard per-request ceiling,
      // so the read silently stopped at 1000 anyway (SCALE-1). Page instead.
      const [tagsRes, linksRes] = await Promise.all([
        selectCapped<any>({
          scope: "tags",
          cap: READ_CAPS.tags,
          build: (opts) =>
            supabaseClient
              .from("tags")
              .select("*", opts)
              .eq("workspace_id", workspaceId)
              .is("deleted_at", null),
          order: (q) => q.order("created_at").order("id"),
        }),
        selectCapped<any>({
          scope: "tag assignments",
          cap: READ_CAPS.tagLinks,
          build: (opts) => {
            const q = supabaseClient
              .from("tag_links")
              .select("*", opts)
              .eq("workspace_id", workspaceId);
            return entityTypes && entityTypes.length > 0 ? q.in("entity_type", entityTypes) : q;
          },
          order: (q) => q.order("id"),
        }),
      ]);
      const firstError = tagsRes.error || linksRes.error;
      if (firstError) throw new Error(firstError.message);
      return {
        tags: mapKnownRows(tagsRes.rows, tagRowToModel),
        links: mapKnownRows(linksRes.rows, tagLinkRowToModel),
        truncated: collectTruncations(tagsRes.truncation, linksRes.truncation),
      };
    },

    async createTaskRelation({ workspaceId, blockerTaskId, blockedTaskId }) {
      // Idempotent like attachTag — re-adding an existing edge returns it.
      const { data: existing } = await supabaseClient
        .from("task_relations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("blocker_task_id", blockerTaskId)
        .eq("blocked_task_id", blockedTaskId)
        .maybeSingle();
      if (existing) return taskRelationRowToModel(existing);
      const { data, error } = await supabaseClient
        .from("task_relations")
        .insert({
          workspace_id: workspaceId,
          blocker_task_id: blockerTaskId,
          blocked_task_id: blockedTaskId,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return taskRelationRowToModel(data);
    },

    async deleteTaskRelation({ workspaceId, relationId }) {
      const { error } = await supabaseClient
        .from("task_relations")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", relationId);
      if (error) throw new Error(error.message);
    },

    async getTimeBlocks(workspaceId) {
      const { data, error } = await supabaseClient
        .from("task_time_blocks")
        .select("blocks")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return sanitizeTimeBlocks(data?.blocks);
    },

    async setTimeBlocks({ workspaceId, blocks }) {
      const clean = sanitizeTimeBlocks(blocks);
      const { data, error } = await supabaseClient
        .from("task_time_blocks")
        .upsert(
          { workspace_id: workspaceId, blocks: clean, updated_at: new Date().toISOString() },
          { onConflict: "workspace_id" },
        )
        .select("blocks")
        .single();
      if (error) throw new Error(error.message);
      return sanitizeTimeBlocks(data?.blocks);
    },

    // ── intent ops (docs/moduo-module-contract.md) ─────────────────────────
    // Each RPC checks permission, enforces invariants, writes, and logs an
    // attributed module_activity row in one transaction.
    async opCommit({ workspaceId, taskId, forDate }) {
      return taskOpRpc("tasks_op_commit", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
        p_for: forDate,
      });
    },

    async opUncommit({ workspaceId, taskId }) {
      return taskOpRpc("tasks_op_uncommit", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
      });
    },

    async opSkipToday({ workspaceId, taskId }) {
      return taskOpRpc("tasks_op_skip_today", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
      });
    },

    async opSetStatus({ workspaceId, taskId, status, recurrence, position }) {
      return taskOpRpc("tasks_op_set_status", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
        p_status: status,
        p_recurrence: recurrence ?? null,
        p_position: position ?? null,
      });
    },

    async opReschedule({ workspaceId, taskId, scheduledAt, days }) {
      return taskOpRpc("tasks_op_reschedule", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
        p_scheduled_at: scheduledAt,
        p_days: days ?? null,
      });
    },

    async opUnschedule({ workspaceId, taskId }) {
      return taskOpRpc("tasks_op_unschedule", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
      });
    },

    async opSkipOccurrence({ workspaceId, taskId, scheduledAt, recurrence, releaseCommit }) {
      return taskOpRpc("tasks_op_skip_occurrence", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
        p_scheduled_at: scheduledAt,
        p_recurrence: recurrence,
        p_release_commit: releaseCommit,
      });
    },

    async opCatchUp({ workspaceId, items }) {
      const { data, error } = await supabaseClient.rpc("tasks_op_catch_up", {
        p_workspace_id: workspaceId,
        p_items: items.map((i) => ({
          task_id: i.taskId,
          kind: i.kind,
          status: i.status ?? null,
          scheduled_at: i.scheduledAt ?? null,
          recurrence: i.recurrence,
          clear_commit: i.clearCommit ?? false,
        })),
      });
      if (error) throw new Error(error.message);
      return mapKnownRows(data, taskRowToModel);
    },

    async listActivity({ workspaceId, entityType, entityId, limit, module }) {
      // `module` scopes the trail to one module (e.g. Tasks). Omit it to read the
      // entity's activity across ALL modules — what a spine entity (a contact /
      // company) wants, since its touches are logged under module='contacts' (and
      // links/comments on it under other modules), never 'tasks'.
      let q = supabaseClient
        .from("module_activity")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId);
      if (module) q = q.eq("module", module);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(limit ?? 50);
      if (error) throw new Error(error.message);
      return mapKnownRows(data, activityRowToModel);
    },
  },

  // ── Connective-tissue spine (specs/connective-tissue.md block CT-1) ─────────
  // Mutations go through links_op_* / entities_op_* RPCs (permission guard +
  // write + attributed activity row in one transaction); reads are direct,
  // indexed SELECTs over entity_links / entities.
  spine: {
    async listLinks({ workspaceId, entityType, entityId }) {
      // entityType/entityId are app-owned tokens (type slugs + uuids), not user
      // input — safe to interpolate into the PostgREST `.or()` filter below.
      const { data, error } = await supabaseClient
        .from("entity_links")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(
          `and(source_type.eq.${entityType},source_id.eq.${entityId}),` +
            `and(target_type.eq.${entityType},target_id.eq.${entityId})`,
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return mapKnownRows(data, entityLinkRowToModel);
    },

    async createLink({
      workspaceId,
      source,
      target,
      relationKind,
      origin,
      sourceLabel,
      sourceIcon,
      targetLabel,
      targetIcon,
    }) {
      const { data, error } = await supabaseClient.rpc("links_op_create", {
        p_workspace_id: workspaceId,
        p_source_type: source.type,
        p_source_id: source.id,
        p_target_type: target.type,
        p_target_id: target.id,
        p_relation_kind: relationKind ?? "references",
        p_origin: origin ?? "manual",
        p_source_label: sourceLabel ?? null,
        p_source_icon: sourceIcon ?? null,
        p_target_label: targetLabel ?? null,
        p_target_icon: targetIcon ?? null,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("The link operation returned nothing.");
      return entityLinkRowToModel(row);
    },

    async setLinkKind({ workspaceId, linkId, relationKind }) {
      const { data, error } = await supabaseClient.rpc("links_op_set_kind", {
        p_workspace_id: workspaceId,
        p_link_id: linkId,
        p_relation_kind: relationKind,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("The link operation returned nothing.");
      return entityLinkRowToModel(row);
    },

    async deleteLink({ workspaceId, linkId }) {
      const { data, error } = await supabaseClient.rpc("links_op_delete", {
        p_workspace_id: workspaceId,
        p_link_id: linkId,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      // The op returns SQL NULL when the link never existed; guard the id too
      // in case an all-NULL composite ever slips through serialization.
      return row?.id ? entityLinkRowToModel(row) : null;
    },

    async searchEntities({ workspaceId, query, types, limit }) {
      let q = supabaseClient
        .from("entities")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      const trimmed = query?.trim();
      if (trimmed) q = q.ilike("label", `%${trimmed}%`);
      if (types && types.length) q = q.in("entity_type", types);
      const { data, error } = await q.order("label").limit(limit ?? 20);
      if (error) throw new Error(error.message);
      return mapKnownRows(data, entityRecordRowToModel);
    },

    async getEntities({ workspaceId, refs }) {
      if (!refs.length) return [];
      // entity_id is a uuid (effectively unique across types) — query by id then
      // filter to the exact (type,id) pairs requested. Includes tombstones.
      const ids = Array.from(new Set(refs.map((r) => r.id)));
      const { data, error } = await supabaseClient
        .from("entities")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("entity_id", ids);
      if (error) throw new Error(error.message);
      const wanted = new Set(refs.map((r) => `${r.type}:${r.id}`));
      return mapKnownRows(data, entityRecordRowToModel).filter((rec) =>
        wanted.has(`${rec.type}:${rec.id}`),
      );
    },

    async tombstoneEntity({ workspaceId, entityType, entityId }) {
      const { error } = await supabaseClient.rpc("entities_op_tombstone", {
        p_workspace_id: workspaceId,
        p_entity_type: entityType,
        p_entity_id: entityId,
      });
      if (error) throw new Error(error.message);
    },

    // ── Comments + notifications (block CT-5) ────────────────────────────────
    async addComment({
      workspaceId,
      entityType,
      entityId,
      body,
      mentionedUserIds,
      entityLabel,
      entityIcon,
    }) {
      const { data, error } = await supabaseClient.rpc("comments_op_add", {
        p_workspace_id: workspaceId,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_body: body,
        p_mentioned_user_ids: mentionedUserIds ?? [],
        p_entity_label: entityLabel ?? null,
        p_entity_icon: entityIcon ?? null,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("The comment operation returned nothing.");
      return commentRowToModel(row);
    },

    async listComments({ workspaceId, entityType, entityId }) {
      const { data, error } = await supabaseClient
        .from("comments")
        .select(
          "id, workspace_id, entity_type, entity_id, body, created_by, created_at, updated_at, deleted_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return mapKnownRows(data, commentRowToModel);
    },

    async listNotifications({ workspaceId, limit }) {
      const { data, error } = await supabaseClient.rpc("notifications_list", {
        p_workspace_id: workspaceId,
        p_limit: limit ?? 50,
      });
      if (error) throw new Error(error.message);
      return mapKnownRows(data, notificationRowToModel);
    },

    async markNotificationRead({ workspaceId, activityId }) {
      const { error } = await supabaseClient.rpc("notifications_op_mark_read", {
        p_workspace_id: workspaceId,
        p_activity_id: activityId,
      });
      if (error) throw new Error(error.message);
    },

    async markAllNotificationsRead({ workspaceId }) {
      const { error } = await supabaseClient.rpc("notifications_op_mark_all_read", {
        p_workspace_id: workspaceId,
      });
      if (error) throw new Error(error.message);
    },

    async dismissNotification({ workspaceId, activityId }) {
      const { error } = await supabaseClient.rpc("notifications_op_dismiss", {
        p_workspace_id: workspaceId,
        p_activity_id: activityId,
      });
      if (error) throw new Error(error.message);
    },

    async undismissNotification({ workspaceId, activityId }) {
      const { error } = await supabaseClient.rpc("notifications_op_undismiss", {
        p_workspace_id: workspaceId,
        p_activity_id: activityId,
      });
      if (error) throw new Error(error.message);
    },

    // ── Deterministic auto-suggested links (block CT-6) ──────────────────────
    async suggestLinks({ workspaceId, entityType, entityId, limit }) {
      const { data, error } = await supabaseClient.rpc("links_suggest", {
        p_workspace_id: workspaceId,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_limit: limit ?? 25,
      });
      if (error) throw new Error(error.message);
      return mapKnownRows(data, linkSuggestionRowToModel);
    },

    async declineSuggestion({ workspaceId, source, target }) {
      const { error } = await supabaseClient.rpc("links_op_decline_suggestion", {
        p_workspace_id: workspaceId,
        p_source_type: source.type,
        p_source_id: source.id,
        p_target_type: target.type,
        p_target_id: target.id,
      });
      if (error) throw new Error(error.message);
    },

    async recentLinks({ workspaceId, limit }) {
      const { data, error } = await supabaseClient
        .from("entity_links")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit ?? 20);
      if (error) throw new Error(error.message);
      const links = mapKnownRows(data, entityLinkRowToModel);
      // One batched registry lookup for every endpoint (no N fan-out).
      const ids = Array.from(new Set(links.flatMap((l) => [l.sourceId, l.targetId])));
      let records: EntityRecord[] = [];
      if (ids.length) {
        const res = await supabaseClient
          .from("entities")
          .select("*")
          .eq("workspace_id", workspaceId)
          .in("entity_id", ids);
        if (res.error) throw new Error(res.error.message);
        records = mapKnownRows(res.data, entityRecordRowToModel);
      }
      const byKey = new Map(records.map((r) => [`${r.type}:${r.id}`, r]));
      return shapeRecentLinks(links, byKey);
    },
  },

  // ── Contacts module (specs/contacts.md block CO-1) ──────────────────────────
  // Writes go through contacts_op_* / companies_op_* RPCs (permission guard +
  // write + entities-registry upsert + attributed activity in one transaction);
  // reads are direct, indexed SELECTs over contacts / companies.
  contacts: {
    async list(workspaceId) {
      const [contactsRes, companiesRes, defsRes] = await Promise.all([
        selectCapped<any>({
          scope: "people",
          cap: READ_CAPS.contacts,
          build: (opts) =>
            supabaseClient
              .from("contacts")
              .select("*", opts)
              .eq("workspace_id", workspaceId)
              .is("deleted_at", null),
          order: (q) => q.order("name").order("id"),
        }),
        selectCapped<any>({
          scope: "companies",
          cap: READ_CAPS.companies,
          build: (opts) =>
            supabaseClient
              .from("companies")
              .select("*", opts)
              .eq("workspace_id", workspaceId)
              .is("deleted_at", null),
          order: (q) => q.order("name").order("id"),
        }),
        selectCapped<any>({
          scope: "fields",
          cap: READ_CAPS.contactFieldDefs,
          build: (opts) =>
            supabaseClient
              .from("contact_field_defs")
              .select("*", opts)
              .eq("workspace_id", workspaceId),
          order: (q) => q.order("position").order("id"),
        }),
      ]);
      if (contactsRes.error) throw new Error(contactsRes.error.message);
      if (companiesRes.error) throw new Error(companiesRes.error.message);
      // Field defs are additive — degrade to none if the v2 migration isn't deployed yet.
      const fieldDefs = defsRes.error ? [] : mapKnownRows(defsRes.rows, contactFieldDefRowToModel);
      return {
        contacts: mapKnownRows(contactsRes.rows, contactRowToModel),
        companies: mapKnownRows(companiesRes.rows, companyRowToModel),
        fieldDefs,
        truncated: collectTruncations(
          contactsRes.truncation,
          companiesRes.truncation,
          defsRes.error ? null : defsRes.truncation,
        ),
      };
    },

    async createContact({
      workspaceId,
      name,
      email,
      phone,
      title,
      companyId,
      status,
      notesInline,
    }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_create", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_email: email ?? null,
        p_phone: phone ?? null,
        p_title: title ?? null,
        p_company_id: companyId ?? null,
        p_status: status ?? "",
        p_notes_inline: notesInline ?? "",
      });
      if (error) throw new Error(error.message);
      return contactRowToModel(firstRow(data, "contacts_op_create"));
    },

    async setContactDetails({ workspaceId, contactId, patch }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_set_details", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_patch: patch,
      });
      if (error) throw new Error(error.message);
      return contactRowToModel(firstRow(data, "contacts_op_set_details"));
    },

    async setFavorite({ workspaceId, contactId, value }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_set_favorite", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_value: value,
      });
      if (error) throw new Error(error.message);
      return contactRowToModel(firstRow(data, "contacts_op_set_favorite"));
    },

    async setCompanyDetails({ workspaceId, companyId, patch }) {
      const { data, error } = await supabaseClient.rpc("companies_op_set_details", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
        p_patch: patch,
      });
      if (error) throw new Error(error.message);
      return companyRowToModel(firstRow(data, "companies_op_set_details"));
    },

    async addFieldDef({ workspaceId, key, label, type, options, position }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_add_field_def", {
        p_workspace_id: workspaceId,
        p_key: key,
        p_label: label ?? key,
        p_type: type ?? "text",
        p_options: options ?? [],
        p_position: position ?? 0,
      });
      if (error) throw new Error(error.message);
      return contactFieldDefRowToModel(firstRow(data, "contacts_op_add_field_def"));
    },

    async deleteFieldDef({ workspaceId, fieldId }) {
      const { error } = await supabaseClient.rpc("contacts_op_delete_field_def", {
        p_workspace_id: workspaceId,
        p_field_id: fieldId,
      });
      if (error) throw new Error(error.message);
    },

    async updateContact({
      workspaceId,
      contactId,
      name,
      email,
      phone,
      title,
      notesInline,
      setCompany,
    }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_update", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_name: name ?? null,
        p_email: email ?? null,
        p_phone: phone ?? null,
        p_title: title ?? null,
        p_notes_inline: notesInline ?? null,
        p_set_company: setCompany !== undefined,
        p_company_id: setCompany?.companyId ?? null,
      });
      if (error) throw new Error(error.message);
      return contactRowToModel(firstRow(data, "contacts_op_update"));
    },

    async setStatus({ workspaceId, contactId, status }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_set_status", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_status: status,
      });
      if (error) throw new Error(error.message);
      return contactRowToModel(firstRow(data, "contacts_op_set_status"));
    },

    async createCompany({ workspaceId, name, domains, website, notesInline }) {
      const { data, error } = await supabaseClient.rpc("companies_op_create", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_domains: domains ?? [],
        p_website: website ?? null,
        p_notes_inline: notesInline ?? "",
      });
      if (error) throw new Error(error.message);
      return companyRowToModel(firstRow(data, "companies_op_create"));
    },

    async updateCompany({ workspaceId, companyId, name, domains, website, notesInline }) {
      const { data, error } = await supabaseClient.rpc("companies_op_update", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
        p_name: name ?? null,
        p_domains: domains ?? null,
        p_website: website ?? null,
        p_notes_inline: notesInline ?? null,
      });
      if (error) throw new Error(error.message);
      return companyRowToModel(firstRow(data, "companies_op_update"));
    },

    async link({
      workspaceId,
      contact,
      target,
      relationKind,
      origin,
      contactLabel,
      targetLabel,
      targetIcon,
    }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_link", {
        p_workspace_id: workspaceId,
        p_contact_type: contact.type,
        p_contact_id: contact.id,
        p_target_type: target.type,
        p_target_id: target.id,
        p_relation_kind: relationKind ?? "references",
        p_origin: origin ?? "manual",
        p_contact_label: contactLabel ?? null,
        p_target_label: targetLabel ?? null,
        p_target_icon: targetIcon ?? null,
      });
      if (error) throw new Error(error.message);
      return entityLinkRowToModel(firstRow(data, "contacts_op_link"));
    },

    async unlink({ workspaceId, linkId }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_unlink", {
        p_workspace_id: workspaceId,
        p_link_id: linkId,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      return row?.id ? entityLinkRowToModel(row) : null;
    },

    async deleteContact({ workspaceId, contactId }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_delete", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
      });
      if (error) throw new Error(error.message);
      return contactRowToModel(firstRow(data, "contacts_op_delete"));
    },

    async restoreContact({ workspaceId, contactId }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_restore", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
      });
      if (error) throw new Error(error.message);
      return contactRowToModel(firstRow(data, "contacts_op_restore"));
    },

    async deleteCompany({ workspaceId, companyId }) {
      const { data, error } = await supabaseClient.rpc("companies_op_delete", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
      });
      if (error) throw new Error(error.message);
      return companyRowToModel(firstRow(data, "companies_op_delete"));
    },

    async importContacts({ workspaceId, rows }) {
      const { data, error } = await supabaseClient.rpc("contacts_op_import", {
        p_workspace_id: workspaceId,
        p_rows: rows,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as {
        created?: number;
        merged?: number;
        created_ids?: string[];
        merged_ids?: string[];
      };
      return {
        created: r.created ?? 0,
        merged: r.merged ?? 0,
        createdIds: r.created_ids ?? [],
        mergedIds: r.merged_ids ?? [],
      };
    },

    async needsAttention({ workspaceId }) {
      const { data, error } = await supabaseClient
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      const contacts = mapKnownRows(data, contactRowToModel);
      const overdue = await loadOverdueFollowups(workspaceId);
      return selectNeedsAttention({ contacts, overdue, now: new Date() });
    },

    async reconnect({ workspaceId }) {
      const { data, error } = await supabaseClient
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      const contacts = mapKnownRows(data, contactRowToModel);
      // Last-touch proxy = the contact's updated_at (the cheap signal; CO-2 deferral).
      const lastTouch: Record<string, string | null> = {};
      for (const c of contacts) lastTouch[c.id] = c.updatedAt;
      return selectReconnect({
        contacts,
        lastTouchByContactId: lastTouch,
        now: new Date(),
        limit: 6,
        minDays: 30,
      });
    },
  },
};

/** A Date as a local YYYY-MM-DD calendar date. */
function localDateOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local calendar date as YYYY-MM-DD. */
function localToday(): string {
  return localDateOf(new Date());
}

/**
 * Contacts with a follow-up task past its due date (AC11). One indexed read of
 * the workspace's follow-up links, then one batched read of their task endpoints
 * — no per-contact fan-out. Open tasks only (done/archived excluded).
 */
async function loadOverdueFollowups(workspaceId: string): Promise<OverdueFollowup[]> {
  const { data: links, error } = await supabaseClient
    .from("entity_links")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("relation_kind", "follow-up")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const taskToContact = new Map<string, string>();
  for (const l of links ?? []) {
    const contactId =
      l.source_type === "contact" ? l.source_id : l.target_type === "contact" ? l.target_id : null;
    const taskId =
      l.source_type === "task" ? l.source_id : l.target_type === "task" ? l.target_id : null;
    if (contactId && taskId) taskToContact.set(taskId, contactId);
  }
  const taskIds = [...taskToContact.keys()];
  if (taskIds.length === 0) return [];

  const { data: tasks, error: tErr } = await supabaseClient
    .from("tasks")
    .select("id, due_date, status")
    .eq("workspace_id", workspaceId)
    .in("id", taskIds)
    .is("deleted_at", null);
  if (tErr) throw new Error(tErr.message);

  // tasks.due_date is a timestamptz (stored from local midnight → UTC), so
  // normalize it back to a local calendar date before comparing / surfacing —
  // a raw lexical compare against "today" is off by a day for users east of UTC.
  const today = localToday();
  const overdue: OverdueFollowup[] = [];
  for (const t of tasks ?? []) {
    if (!t.due_date || t.status === "done" || t.status === "archived") continue;
    const dueLocal = localDateOf(new Date(t.due_date));
    if (dueLocal < today) {
      const contactId = taskToContact.get(t.id);
      if (contactId) overdue.push({ contactId, dueDate: dueLocal });
    }
  }
  return overdue;
}

/** First row of a single-object RPC result, with a clear error if empty. */
function firstRow(data: unknown, fn: string): any {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(`The ${fn} operation returned nothing.`);
  return row;
}

function mapNoteRow(raw: unknown): Note {
  return noteRowToModel(requireRow(noteRowSchema, raw, "note"));
}

function mapNoteUpdateRow(raw: unknown): NoteUpdateRow {
  return noteUpdateRowToModel(requireRow(noteUpdateRowSchema, raw, "note update"));
}

// ── Email module (EM-3) row → model mappers ───────────────────────────────────
function emailAccountRowToModel(raw: unknown): EmailAccountRef {
  const r = requireRow(emailAccountRowSchema, raw, "email account");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id,
    provider: parsedMailboxProvider(r.provider),
    address: r.address,
    status: r.status,
    signatureHtml: r.signature_html ?? "",
    unreadCount: r.unread_count ?? 0,
    color: r.color ?? null,
    lastSyncAt: r.last_sync_at ?? null,
    lastError: r.last_error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function emailRefRowToModel(raw: unknown): EmailThreadRef {
  const r = requireRow(emailRefRowSchema, raw, "email ref");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id,
    accountId: r.account_id ?? null,
    threadKey: r.thread_key,
    messageKey: r.message_key ?? null,
    fromAddr: r.from_addr ?? null,
    fromName: r.from_name ?? null,
    subject: r.subject ?? "",
    snippet: r.snippet ?? "",
    sentAt: r.sent_at ?? null,
    isSnoozed: Boolean(r.is_snoozed),
    snoozeUntil: r.snooze_until ?? null,
    followUpAt: r.follow_up_at ?? null,
    followUpClearedAt: r.follow_up_cleared_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Tasks module: Inbox seeding + row<->model mappers ─────────────────────────

/** Call a single-task intent-op RPC and map the returned row. */
async function taskOpRpc(fn: string, args: Record<string, unknown>): Promise<Task> {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The operation returned nothing.");
  return taskRowToModel(row);
}

function activityRowToModel(raw: unknown): ActivityEntry {
  const r = requireRow(activityRowSchema, raw, "activity");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    module: r.module,
    entityType: r.entity_type,
    entityId: r.entity_id,
    op: r.op,
    actorType: r.actor_type ?? "user",
    actorId: r.actor_id ?? null,
    actorLabel: r.actor_label ?? null,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

/** Ensure the workspace has its reserved Inbox bucket (idempotent). */
async function ensureWebInbox(workspaceId: string): Promise<Bucket> {
  const find = () =>
    supabaseClient
      .from("buckets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_system", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
  const { data: existing } = await find();
  if (existing) return bucketRowToModel(existing);
  const user = await getAuthedUser();
  const now = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from("buckets")
    .insert({
      workspace_id: workspaceId,
      owner_id: user?.id ?? null,
      name: "Inbox",
      is_system: true,
      position: "a0", // low lexorank anchor — sorts first
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) {
    // Lost a create race (unique partial index) — re-read the winner.
    const { data: again } = await find();
    if (again) return bucketRowToModel(again);
    throw new Error(error.message);
  }
  return bucketRowToModel(data);
}

function bucketRowToModel(raw: unknown): Bucket {
  const r = requireRow(bucketRowSchema, raw, "bucket");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name,
    isSystem: !!r.is_system,
    group: r.group_label ?? null,
    position: r.position ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function taskRowToModel(raw: unknown): Task {
  const r = requireRow(taskRowSchema, raw, "task");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    bucketId: r.bucket_id,
    parentId: r.parent_id ?? null,
    title: r.title ?? "",
    description: r.description ?? "",
    dueDate: r.due_date ?? null,
    scheduledAt: r.scheduled_at ?? null,
    durationMinutes: r.duration_minutes ?? null,
    timeSpentSeconds: r.time_spent_seconds ?? 0,
    recurrence: (r.recurrence as Task["recurrence"]) ?? null,
    energyLevel: r.energy_level ?? null,
    priority: r.priority ?? null,
    status: r.status ?? "todo",
    committedFor: r.committed_for ?? null,
    commitOrder: r.commit_order ?? null,
    rescheduleCount: r.reschedule_count ?? 0,
    position: r.position ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function taskModelToRow(t: Task): Record<string, unknown> {
  return {
    id: t.id,
    workspace_id: t.workspaceId,
    owner_id: t.ownerId || null,
    bucket_id: t.bucketId,
    parent_id: t.parentId ?? null,
    title: t.title,
    description: t.description ?? "",
    due_date: t.dueDate ?? null,
    scheduled_at: t.scheduledAt ?? null,
    duration_minutes: t.durationMinutes ?? null,
    time_spent_seconds: t.timeSpentSeconds ?? 0,
    recurrence: t.recurrence ?? null,
    energy_level: t.energyLevel ?? null,
    priority: t.priority ?? null,
    status: t.status,
    committed_for: t.committedFor ?? null,
    commit_order: t.commitOrder ?? null,
    reschedule_count: t.rescheduleCount ?? 0,
    position: t.position ?? "",
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    deleted_at: t.deletedAt ?? null,
  };
}

function tagRowToModel(raw: unknown): Tag {
  const r = requireRow(tagRowSchema, raw, "tag");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name,
    color: r.color ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function tagLinkRowToModel(raw: unknown): TagLink {
  const r = requireRow(tagLinkRowSchema, raw, "tag link");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    tagId: r.tag_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    createdAt: r.created_at,
  };
}

function taskRelationRowToModel(raw: unknown): TaskRelation {
  const r = requireRow(taskRelationRowSchema, raw, "task relation");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    blockerTaskId: r.blocker_task_id,
    blockedTaskId: r.blocked_task_id,
    createdAt: r.created_at,
  };
}

// ── Spine: entity_links / entities row<->model mappers ────────────────────────

function entityLinkRowToModel(raw: unknown): EntityLink {
  const r = requireRow(entityLinkRowSchema, raw, "entity link");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    targetType: r.target_type,
    targetId: r.target_id,
    relationKind: r.relation_kind,
    origin: r.origin,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function entityRecordRowToModel(raw: unknown): EntityRecord {
  const r = requireRow(entityRecordRowSchema, raw, "entity");
  return {
    workspaceId: r.workspace_id,
    type: r.entity_type,
    id: r.entity_id,
    label: r.label ?? "",
    icon: r.icon ?? null,
    deletedAt: r.deleted_at ?? null,
  };
}

/** A `links_suggest` row → a raw per-signal suggestion (scoreSuggestions ranks). */
function linkSuggestionRowToModel(raw: unknown): RawLinkSuggestion {
  const r = requireRow(linkSuggestionRowSchema, raw, "link suggestion");
  return {
    otherType: r.other_type,
    otherId: r.other_id,
    otherLabel: r.other_label ?? "",
    otherIcon: r.other_icon ?? null,
    signal: r.signal as RawLinkSuggestion["signal"],
    suggestedKind: parsedRelationKind(r.suggested_kind ?? "references"),
    strength: typeof r.strength === "number" ? r.strength : Number(r.strength) || 1,
  };
}

// ── Spine: comments / notifications row<->model mappers (block CT-5) ───────────

function commentRowToModel(raw: unknown): SpineComment {
  const r = requireRow(commentRowSchema, raw, "comment");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    body: r.body ?? "",
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/** A `notifications_list` row → the normalized NotificationItem the reducer groups. */
function notificationRowToModel(raw: unknown): NotificationItem {
  const r = requireRow(notificationRowSchema, raw, "notification");
  return {
    id: r.id,
    source: "spine",
    workspaceId: r.workspace_id ?? null,
    targetType: r.entity_type ?? null,
    targetId: r.entity_id ?? null,
    op: r.op,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    actorType: r.actor_type ?? "user",
    actorId: r.actor_id ?? null,
    actorLabel: r.actor_label ?? null,
    createdAt: r.created_at,
    readAt: r.read_at ?? null,
    // Absent pre-DF-21b migration → null → the row stays active (graceful).
    dismissedAt: r.dismissed_at ?? null,
  };
}

// ── Contacts module row<->model mappers (block CO-1) ──────────────────────────

/** Parse a jsonb labelled-channel list defensively. */
function channelList(v: unknown): ContactChannel[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => ({
      label: String(x?.label ?? ""),
      value: String(x?.value ?? ""),
      primary: Boolean(x?.primary),
    }))
    .filter((c) => c.value !== "");
}
function dateList(v: unknown): ContactDateEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => ({ label: String(x?.label ?? ""), value: String(x?.value ?? "") }))
    .filter((d) => d.value !== "");
}
function customMap(v: unknown): Record<string, ContactCustomValue> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, ContactCustomValue> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(val)) out[k] = val.map(String);
    else if (val != null) out[k] = String(val);
  }
  return out;
}

function contactRowToModel(raw: unknown): Contact {
  const r = requireRow(contactRowSchema, raw, "contact");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name ?? "",
    email: r.email ?? null,
    emails: channelList(r.emails),
    phone: r.phone ?? null,
    phones: channelList(r.phones),
    addresses: channelList(r.addresses),
    urls: channelList(r.urls),
    dates: dateList(r.dates),
    title: r.title ?? null,
    companyId: r.company_id ?? null,
    status: r.status ?? "",
    custom: customMap(r.custom),
    isFavorite: r.is_favorite === true,
    notesInline: r.notes_inline ?? "",
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function companyRowToModel(raw: unknown): Company {
  const r = requireRow(companyRowSchema, raw, "company");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name ?? "",
    domains: Array.isArray(r.domains) ? r.domains : [],
    website: r.website ?? null,
    custom: customMap(r.custom),
    notesInline: r.notes_inline ?? "",
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function contactFieldDefRowToModel(raw: unknown): ContactFieldDef {
  const r = requireRow(contactFieldDefRowSchema, raw, "contact field");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    key: r.key,
    label: r.label ?? r.key,
    type: r.type ?? "text",
    options: Array.isArray(r.options) ? r.options.map(String) : [],
    position: typeof r.position === "number" ? r.position : Number(r.position) || 0,
  };
}

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
