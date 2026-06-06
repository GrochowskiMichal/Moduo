/**
 * Tauri desktop implementation of ModuoRuntime.
 * All data operations go through Tauri `invoke()` to the Rust core.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AuthChangeEvent,
  AuthListener,
  IntegrationStatusItem,
  LocalAuthState,
  ModuoRuntime,
  RuntimeCapabilities,
  RuntimeSession,
} from "./runtime.types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function toError(error: unknown): { message: string } {
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

function normalizeSession(raw: any): RuntimeSession | null {
  if (!raw) return null;
  const accessToken = raw.accessToken ?? raw.access_token;
  const userRaw = raw.user ?? {};
  const userId = userRaw.id;
  if (!accessToken || !userId) return null;
  return {
    access_token: accessToken,
    refresh_token: raw.refreshToken ?? raw.refresh_token ?? null,
    expires_at: raw.expiresAt ?? raw.expires_at ?? undefined,
    user: {
      id: userId,
      email: userRaw.email ?? null,
    },
  };
}

const authListeners = new Set<AuthListener>();

function emitAuth(event: AuthChangeEvent, session: RuntimeSession | null) {
  for (const listener of authListeners) listener(event, session);
}

// ── Capabilities ──────────────────────────────────────────────────────────────

export const tauriCapabilities: RuntimeCapabilities = {
  isDesktop: true,
  isWeb: false,
  hasEmail: true,
  hasTimeTracking: true,
  hasCalendarOAuth: true,
  hasLocalMnemonic: true,
  hasOfflineMode: true,
};

// ── Runtime implementation ────────────────────────────────────────────────────

export const tauriRuntime: ModuoRuntime = {
  capabilities: tauriCapabilities,

  auth: {
    async getLocalAuthState() {
      try {
        const raw = await invoke<any>("auth_get_local_auth_state");
        const data: LocalAuthState = {
          profileExists: !!(raw?.profileExists ?? raw?.profile_exists),
          displayName: raw?.displayName ?? raw?.display_name ?? null,
          userId: raw?.userId ?? raw?.user_id ?? null,
          hasPin: !!(raw?.hasPin ?? raw?.has_pin),
          hasKeychainMnemonic: !!(raw?.hasKeychainMnemonic ?? raw?.has_keychain_mnemonic),
        };
        return { data, error: null };
      } catch (error) {
        return {
          data: { profileExists: false, displayName: null, userId: null, hasPin: false, hasKeychainMnemonic: false },
          error: toError(error),
        };
      }
    },

    async generateMnemonic() {
      try {
        const raw = await invoke<any>("auth_generate_mnemonic");
        return { data: { words: Array.isArray(raw?.words) ? raw.words : [], phrase: raw?.phrase ?? "" }, error: null };
      } catch (error) {
        return { data: { words: [], phrase: "" }, error: toError(error) };
      }
    },

    async registerLocalMnemonic({ displayName, mnemonicPhrase, inviteToken }) {
      try {
        const raw = await invoke<any>("auth_register_local_mnemonic", {
          input: { displayName, mnemonicPhrase, inviteToken: inviteToken ?? null },
        });
        const session = normalizeSession(raw?.session);
        emitAuth("SIGNED_IN", session);
        return { data: { user: session?.user ?? null, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    async unlockWithMnemonic({ mnemonicPhrase, inviteToken }) {
      try {
        await invoke("auth_unlock_with_mnemonic", {
          input: { mnemonicPhrase, inviteToken: inviteToken ?? null },
        });
        const next = await tauriRuntime.auth.getSession();
        emitAuth("SIGNED_IN", next.data.session ?? null);
        return {
          data: { user: next.data.session?.user ?? null, session: next.data.session ?? null },
          error: null,
        };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    async forgotResetLocal() {
      try {
        await invoke("auth_forgot_reset_local");
        emitAuth("SIGNED_OUT", null);
        return { error: null };
      } catch (error) {
        return { error: toError(error) };
      }
    },

    async tryAutoUnlock() {
      try {
        const raw = await invoke<any>("auth_try_auto_unlock");
        const session = normalizeSession(raw);
        if (session) emitAuth("SIGNED_IN", session);
        return { data: { session }, error: null };
      } catch (error) {
        return { data: { session: null }, error: toError(error) };
      }
    },

    async setPin(pin: string) {
      try {
        await invoke("auth_set_pin", { pin });
        return { error: null };
      } catch (error) {
        return { error: toError(error) };
      }
    },

    async unlockWithPin(pin: string) {
      try {
        const raw = await invoke<any>("auth_unlock_with_pin", { pin });
        const session = normalizeSession(raw);
        if (session) emitAuth("SIGNED_IN", session);
        return { data: { session }, error: null };
      } catch (error) {
        return { data: { session: null }, error: toError(error) };
      }
    },

    async removePin() {
      try {
        await invoke("auth_remove_pin");
        return { error: null };
      } catch (error) {
        return { error: toError(error) };
      }
    },

    async updateDisplayName(displayName: string) {
      try {
        const raw = await invoke<any>("auth_update_display_name", { input: { displayName } });
        return { data: { displayName: raw?.displayName ?? raw?.display_name ?? displayName }, error: null };
      } catch (error) {
        return { data: { displayName }, error: toError(error) };
      }
    },

    async getStoredMnemonic() {
      try {
        const phrase = await invoke<string | null>("auth_get_stored_mnemonic");
        return { data: { phrase: typeof phrase === "string" ? phrase : null }, error: null };
      } catch (error) {
        return { data: { phrase: null }, error: toError(error) };
      }
    },

    async getSession() {
      try {
        const raw = await invoke<any>("auth_get_session");
        return { data: { session: normalizeSession(raw) }, error: null };
      } catch (error) {
        return { data: { session: null }, error: toError(error) };
      }
    },

    async refreshSession() {
      try {
        const raw = await invoke<any>("auth_refresh_session");
        const session = normalizeSession(raw);
        emitAuth("TOKEN_REFRESHED", session);
        return { data: { user: session?.user ?? null, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    onAuthStateChange(callback) {
      authListeners.add(callback);
      void tauriRuntime.auth.getSession().then((result: any) => {
        callback("INITIAL_SESSION", result?.data?.session ?? null);
      });
      return {
        data: {
          subscription: {
            unsubscribe() {
              authListeners.delete(callback);
            },
          },
        },
      };
    },

    async signOut() {
      try {
        await invoke("auth_sign_out");
        emitAuth("SIGNED_OUT", null);
        return { error: null };
      } catch (error) {
        return { error: toError(error) };
      }
    },

    async signUpWithEmail({ email, password, displayName }) {
      // Desktop: proxies to the Rust auth_link_to_cloud command
      try {
        const raw = await invoke<any>("auth_link_to_cloud", {
          input: { email, password, displayName: displayName ?? null },
        });
        const session = normalizeSession(raw?.session);
        if (session) emitAuth("SIGNED_IN", session);
        return { data: { user: session?.user ?? null, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    async signInWithEmail({ email, password }) {
      try {
        const raw = await invoke<any>("auth_sign_in_cloud", { input: { email, password } });
        const session = normalizeSession(raw?.session);
        if (session) emitAuth("SIGNED_IN", session);
        return { data: { user: session?.user ?? null, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },

    async sendOtp() {
      return { data: {}, error: { message: "OTP auth is only available on web." } };
    },

    async verifyOtp() {
      return { data: { user: null, session: null, isNewUser: false }, error: { message: "OTP auth is only available on web." } };
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
