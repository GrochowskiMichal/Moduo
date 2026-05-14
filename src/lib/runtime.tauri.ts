/**
 * Tauri desktop implementation of ModuoRuntime.
 * Auth is handled via Supabase JS (same as web). After a successful sign-in the
 * session is forwarded to the Rust core via `auth_accept_supabase_session` so
 * workspace / data commands can resolve the current user identity.
 * All workspace / notes / tasks / graph operations go through Tauri `invoke()`.
 */

import { invoke } from "@tauri-apps/api/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AuthChangeEvent,
  AuthListener,
  IntegrationStatusItem,
  ModuoRuntime,
  RuntimeCapabilities,
  RuntimeSession,
} from "./runtime.types";

// ── Supabase client (shared with the web runtime) ─────────────────────────────

const SUPABASE_URL: string =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";
const SUPABASE_ANON_KEY: string =
  (import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined) ||
  "sb_publishable_NAVl-rzFzPOi5ZU84aC3pA_SOIR00so";

const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function toError(error: unknown): { message: string } {
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
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

/** Forward a JS Supabase session to the Rust data layer so workspace ops work. */
async function syncSessionToRust(session: RuntimeSession, displayName?: string | null) {
  await invoke("auth_accept_supabase_session", {
    input: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? null,
      userId: session.user.id,
      email: session.user.email ?? null,
      expiresAt: session.expires_at ?? null,
      displayName: displayName ?? null,
    },
  }).catch(() => {});
}

// ── Capabilities ──────────────────────────────────────────────────────────────

export const tauriCapabilities: RuntimeCapabilities = {
  isDesktop: true,
  isWeb: false,
  hasEmail: true,
  hasTimeTracking: true,
  hasCalendarOAuth: true,
  hasOfflineMode: true,
};

// ── Runtime implementation ────────────────────────────────────────────────────

export const tauriRuntime: ModuoRuntime = {
  capabilities: tauriCapabilities,

  auth: {
    async tryAutoUnlock() {
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error || !data.session) return { data: { session: null }, error: null };
        const session = sessionFromSupabase(data.session);
        if (session) await syncSessionToRust(session);
        return { data: { session }, error: null };
      } catch (error) {
        return { data: { session: null }, error: toError(error) };
      }
    },

    async updateDisplayName(displayName: string) {
      try {
        const { error } = await supabaseClient.auth.updateUser({
          data: { display_name: displayName },
        });
        if (error) return { data: { displayName }, error: toError(error) };
        return { data: { displayName }, error: null };
      } catch (error) {
        return { data: { displayName }, error: toError(error) };
      }
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
        if (session) await syncSessionToRust(session);
        return { data: { user: session?.user ?? null, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    onAuthStateChange(callback: AuthListener) {
      const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(async (event, supaSession) => {
        const eventMap: Record<string, AuthChangeEvent> = {
          INITIAL_SESSION: "INITIAL_SESSION",
          SIGNED_IN: "SIGNED_IN",
          SIGNED_OUT: "SIGNED_OUT",
          TOKEN_REFRESHED: "TOKEN_REFRESHED",
          USER_UPDATED: "TOKEN_REFRESHED",
        };
        const mapped = eventMap[event] ?? "TOKEN_REFRESHED";
        const session = sessionFromSupabase(supaSession);
        if (session && (mapped === "SIGNED_IN" || mapped === "TOKEN_REFRESHED")) {
          await syncSessionToRust(session);
        }
        if (mapped === "SIGNED_OUT") {
          await invoke("auth_sign_out").catch(() => {});
        }
        callback(mapped, session);
      });
      return { data: { subscription: { unsubscribe: () => subscription.unsubscribe() } } };
    },

    async signOut() {
      try {
        await invoke("auth_sign_out").catch(() => {});
        const { error } = await supabaseClient.auth.signOut();
        if (error) return { error: toError(error) };
        return { error: null };
      } catch (error) {
        return { error: toError(error) };
      }
    },

    async sendOtp({ email }) {
      try {
        const { error } = await supabaseClient.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
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
        if (session) {
          const displayName = data.user?.user_metadata?.display_name ?? null;
          await syncSessionToRust(session, displayName);
        }
        const createdAt = data.user?.created_at ? new Date(data.user.created_at).getTime() : 0;
        const isNewUser = !!sentAt && !!createdAt && createdAt >= sentAt - 30_000;
        return { data: { user: session?.user ?? null, session, isNewUser }, error: null };
      } catch (error) {
        return { data: { user: null, session: null, isNewUser: false }, error: toError(error) };
      }
    },
  },

  workspace: {
    async getProfile(userId: string) {
      try {
        const data = await invoke<{ plan_tier?: string; display_name?: string; avatar_url?: string } | null>(
          "profile_get", { userId }
        );
        return { data: data ?? null, error: null };
      } catch (e: any) {
        return { data: null, error: e };
      }
    },
    list() { return invoke<any[]>("workspace_list_local"); },
    create(name) { return invoke<any>("workspace_create_local", { name }); },
    rename(workspaceId, name) { return invoke<any>("workspace_rename_local", { workspaceId, name }); },
    leave(workspaceId) { return invoke<void>("workspace_leave_local", { workspaceId }); },
    softDelete(workspaceId) { return invoke<void>("workspace_soft_delete_local", { workspaceId }); },
    issueInvite(workspaceId, email, role, modulePermissions) {
      return invoke<any>("workspace_issue_invite", { workspaceId, email, role, modulePermissions });
    },
    joinInvite(token) { return invoke<any>("workspace_join_invite", { token }); },
    listMembers(workspaceId) { return invoke<any[]>("workspace_list_members", { workspaceId }); },
    listInvites(workspaceId) { return invoke<any[]>("workspace_list_invites", { workspaceId }); },
    updateInvite(inviteId, role, modulePermissions) {
      return invoke<void>("workspace_update_invite", { input: { inviteId, role, modulePermissions } });
    },
    revokeInvite(inviteId) { return invoke<void>("workspace_revoke_invite", { inviteId }); },
    updateMemberPermissions(memberId, role, modulePermissions) {
      return invoke<void>("workspace_update_member_permissions", { input: { memberId, role, modulePermissions } });
    },
    listNotifications() { return invoke<any[]>("workspace_list_notifications"); },
    markNotificationRead(notificationId) { return invoke<void>("workspace_mark_notification_read", { notificationId }); },
    markAllNotificationsRead() { return invoke<void>("workspace_mark_all_notifications_read"); },
  },

  notes: {
    list(workspaceId) { return invoke<any[]>("notes_list", { workspaceId }); },
    upsert(note) { return invoke<any>("notes_upsert", { note }); },
    duplicate(input) { return invoke<any>("notes_duplicate", { input }); },
    move(input) { return invoke<any>("notes_move", { input }); },
    remove(input) { return invoke<any>("notes_delete", { input }); },
    getDocState(workspaceId, noteId) { return invoke<any>("notes_get_doc_state", { workspaceId, noteId }); },
    applyCrdtUpdates(workspaceId, noteId, clientId, updates) {
      return invoke<any>("notes_apply_crdt_updates", { workspaceId, noteId, clientId, updates });
    },
    subscribeLocal(workspaceId, noteId) {
      return invoke<string>("notes_subscribe_local", { workspaceId, noteId: noteId ?? null });
    },
  },

  tasks: {
    list(workspaceId) { return invoke<any>("tasks_list", { workspaceId }); },
    upsert(input) { return invoke<any>("tasks_upsert", { input }); },
    upsertProject(project) {
      return tauriRuntime.tasks.upsert({ project }).then((r: any) => r?.project ?? r);
    },
    upsertState(workflowState) {
      return tauriRuntime.tasks.upsert({ workflowState }).then((r: any) => r?.workflowState ?? r);
    },
    upsertItem(task) {
      return tauriRuntime.tasks.upsert({ task }).then((r: any) => r?.task ?? r);
    },
    move(input) { return invoke<any>("tasks_move", { input }); },
    deleteItem(input) { return invoke<any>("tasks_delete_item", { input }); },
    addComment(comment) { return invoke<any>("tasks_add_comment", { comment }); },
    upsertComment(comment) { return tauriRuntime.tasks.addComment(comment); },
    deleteComment(commentId) { return invoke<void>("tasks_delete_comment", { commentId }); },
    subscribeLocal(workspaceId) { return invoke<string>("tasks_subscribe_local", { workspaceId }); },
  },

  graph: {
    upsertNodesEdges(request) { return invoke<void>("graph_upsert_nodes_edges", { request }); },
    queryRelated(workspaceId, nodeId, limit) { return invoke<any>("graph_query_related", { workspaceId, nodeId, limit }); },
    queryHybrid(query) { return invoke<any[]>("graph_query_hybrid", { query }); },
    getFullGraph(workspaceId) { return invoke<any>("graph_get_full", { workspaceId }); },
  },

  migration: {
    importLegacy(payload) { return invoke<any>("migration_import_legacy", { payload }); },
  },

  localStore: {
    get(namespace, key) { return invoke("local_store_get", { namespace, key }); },
    set(namespace, key, value) { return invoke("local_store_set", { namespace, key, value }); },
    remove(namespace, key) { return invoke("local_store_remove", { namespace, key }); },
  },

  window: {
    toggleFullscreen() { return invoke<boolean>("window_toggle_fullscreen"); },
    openExternalUrl(url) { return invoke<void>("open_external_url", { url }); },
  },

  timetracking: {
    list(workspaceId) { return invoke<any>("tt_list", { workspaceId }); },
    upsertEntry(entry) { return invoke<any>("tt_upsert_entry", { entry }); },
    deleteEntry(entryId) { return invoke<void>("tt_delete_entry", { entryId }); },
    upsertCategory(category) { return invoke<any>("tt_upsert_category", { category }); },
    deleteCategory(categoryId) { return invoke<void>("tt_delete_category", { categoryId }); },
    upsertRule(rule) { return invoke<any>("tt_upsert_rule", { rule }); },
    deleteRule(ruleId) { return invoke<void>("tt_delete_rule", { ruleId }); },
    upsertProject(project) { return invoke<any>("tt_upsert_project", { project }); },
    deleteProject(projectId) { return invoke<void>("tt_delete_project", { projectId }); },
    upsertFocusSession(session) { return invoke<any>("tt_upsert_focus_session", { session }); },
    getActiveWindow() { return invoke<any | null>("tt_get_active_window"); },
    startTracking(workspaceId) { return invoke<void>("tt_start_tracking", { workspaceId }); },
    stopTracking() { return invoke<void>("tt_stop_tracking"); },
    getTrackingStatus() { return invoke<{ isTracking: boolean }>("tt_get_tracking_status"); },
  },

  email: {
    listAccounts() { return invoke<any[]>("email_accounts_list"); },
    connectAndSave(input) { return invoke<any>("email_account_connect_and_save", { input }); },
    disconnect(accountId) { return invoke<void>("email_account_disconnect", { accountId }); },
    listEnvelopes(input) { return invoke<any>("email_list_envelopes", { input }); },
    getMessageBody(input) { return invoke<any>("email_get_message_body", { input }); },
    prefetchBodies(input) { return invoke<any>("email_prefetch_bodies", { input }); },
    syncNow(input) { return invoke<any>("email_sync_now", { input }); },
    setActivityState(input) { return invoke<void>("email_set_activity_state", { input }); },
    applyFlag(input) { return invoke<any>("email_apply_flag", { input }); },
    getMailboxStatus(input) { return invoke<any[]>("email_get_mailbox_status", { input: input ?? {} }); },
    sendSaved(input) { return invoke<boolean>("email_send_saved", input); },
  },

  integrations: {
    async getStatus() {
      return invoke<IntegrationStatusItem[]>("integration_get_status");
    },
    async connectZoom() {
      return invoke<IntegrationStatusItem>("integration_connect_zoom");
    },
    async connectGoogleMeet() {
      return invoke<IntegrationStatusItem>("integration_connect_google_meet");
    },
    async disconnect(provider: string) {
      return invoke<void>("integration_disconnect", { provider });
    },
  },

  calendar: {
    async listEvents() {
      return invoke<any[]>("calendar_events_list");
    },
    async upsertEvent(event) {
      try {
        await invoke("calendar_events_upsert", { event });
        return true;
      } catch {
        return false;
      }
    },
    async deleteEvent(eventId) {
      try {
        await invoke("calendar_events_delete", { eventId });
        return true;
      } catch {
        return false;
      }
    },
    async upsertGoogleEvent(accountId, event) {
      try {
        return await invoke<any>("calendar_google_event_upsert", { accountId, event });
      } catch {
        return null;
      }
    },
    async deleteGoogleEvent(accountId, eventId) {
      try {
        await invoke("calendar_google_event_delete", { accountId, eventId });
        return true;
      } catch {
        return false;
      }
    },
    async syncGoogleEvents(accountId) {
      try {
        await invoke("calendar_google_events_sync", { accountId });
        return true;
      } catch {
        return false;
      }
    },
    async startGoogleOAuth() {
      return invoke<any>("calendar_google_oauth_start");
    },
    async startOutlookOAuth() {
      return invoke<any>("calendar_outlook_oauth_start");
    },
    async startAppleOAuth() {
      return invoke<any>("calendar_apple_oauth_start");
    },
  },
};
