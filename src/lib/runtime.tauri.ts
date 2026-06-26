/**
 * Tauri desktop implementation of ModuoRuntime.
 *
 * Cloud-first composition (improvement-plan Session 2): auth, workspaces and
 * tasks reuse the Supabase-backed web runtime — the exact same code path as
 * the web app. Everything else (notes, email, time-tracking, calendar OAuth,
 * integrations, graph) stays on Tauri `invoke()` to the Rust core; those
 * modules have no Supabase path yet.
 *
 * The future free/offline "lite" version re-introduces a local-first runtime
 * behind this same ModuoRuntime interface — that seam is why nothing outside
 * runtime.* may import supabase or invoke() directly for these modules.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  IntegrationStatusItem,
  ModuoRuntime,
  RuntimeCapabilities,
  RuntimeSession,
} from "./runtime.types";
import { webRuntime } from "./runtime.web";

// ── Cloud session → Rust core ─────────────────────────────────────────────────
// Invoke-backed modules attribute writes via the Rust-side session. Mirror the
// Supabase session into AppState on every auth change (INITIAL_SESSION fires
// on subscribe, covering boot restore).

function pushSessionToRust(session: RuntimeSession | null): void {
  void invoke("auth_set_cloud_session", {
    session: session
      ? {
          accessToken: session.access_token,
          refreshToken: session.refresh_token ?? null,
          expiresAt: session.expires_at ?? null,
          user: { id: session.user.id, email: session.user.email ?? null },
        }
      : null,
  }).catch((error) => {
    console.warn("[runtime.tauri] auth_set_cloud_session failed:", error);
  });
}

webRuntime.auth.onAuthStateChange((_event, session) => pushSessionToRust(session));

// ── Capabilities ──────────────────────────────────────────────────────────────

export const tauriCapabilities: RuntimeCapabilities = {
  isDesktop: true,
  isWeb: false,
  hasEmail: true,
  hasTimeTracking: true,
  hasCalendarOAuth: true,
  // Cloud-first: the local mnemonic vault and offline mode are paused until
  // the lite version lands (Rust commands kept).
  hasLocalMnemonic: false,
  hasOfflineMode: false,
};

// ── Runtime implementation ────────────────────────────────────────────────────

export const tauriRuntime: ModuoRuntime = {
  capabilities: tauriCapabilities,

  // Cloud-first: same Supabase session and queries as the web app. The local
  // vault flows (mnemonic / PIN) return "desktop only" errors from the web
  // implementation — their Rust commands stay registered for the lite version.
  auth: webRuntime.auth,
  workspace: webRuntime.workspace,

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

  // Cloud-first: Supabase-direct, same code path as web. The redb-backed
  // tasks_module_* commands stay registered for the lite version.
  tasks: webRuntime.tasks,

  // Cloud-first: the connective-tissue spine is Supabase-direct on both
  // surfaces (entity_links FK'd into the entities registry). Same code path.
  spine: webRuntime.spine,

  // Cloud-first per-user settings. Delegates to the web runtime today; the
  // future offline-lite build can wrap this with a local queue + replay.
  preferences: webRuntime.preferences,
};
