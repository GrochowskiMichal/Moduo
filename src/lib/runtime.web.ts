/**
 * Web (browser) implementation of ModuoRuntime.
 * All data operations go through @supabase/supabase-js against the moduohyb project.
 *
 * Desktop-only features (email, time-tracking, calendar OAuth, P2P, local mnemonic)
 * return { error: { message: "Desktop only" } } — the UI hides them via capabilities.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../features/notes/utils/base64";
import { generatePosition } from "../features/notes/utils/position";
import type {
  AuthChangeEvent,
  AuthListener,
  IntegrationStatusItem,
  LocalAuthState,
  ModuoRuntime,
  RuntimeCapabilities,
  RuntimeSession,
} from "./runtime.types";

// ── Supabase client ────────────────────────────────────────────────────────────

const SUPABASE_URL: string =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";
const SUPABASE_ANON_KEY: string =
  (import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined) ||
  "sb_publishable_NAVl-rzFzPOi5ZU84aC3pA_SOIR00so";

export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// LocalStore backed by localStorage for web
const LS_PREFIX = "moduo:ls:";

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

  auth: {
    async getLocalAuthState() {
      const data: LocalAuthState = {
        profileExists: false,
        displayName: null,
        userId: null,
        hasPin: false,
        hasKeychainMnemonic: false,
      };
      return { data, error: null };
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
        const { data: { user }, error } = await supabaseClient.auth.updateUser({
          data: { display_name: displayName },
        });
        if (error) return { data: { displayName }, error: toError(error) };
        // Also update profiles table
        const uid = user?.id;
        if (uid) {
          await supabaseClient.from("profiles").update({ display_name: displayName }).eq("id", uid);
        }
        return { data: { displayName }, error: null };
      } catch (error) {
        return { data: { displayName }, error: toError(error) };
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
      const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, supaSession) => {
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
        return { data: { user: session?.user ?? data.user ? { id: data.user!.id, email: data.user!.email ?? null } : null, session }, error: null };
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
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("plan_tier, display_name, avatar_url")
        .eq("id", userId)
        .single();
      return { data: data ?? null, error };
    },
    async list() {
      const { data, error } = await supabaseClient.from("workspaces").select("*, workspace_members(*)").is("deleted_at", null);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async create(name) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabaseClient.from("workspaces").insert({ name, owner_id: user.id }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async rename(workspaceId, name) {
      const { data, error } = await supabaseClient.from("workspaces").update({ name }).eq("id", workspaceId).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async leave(workspaceId) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabaseClient.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", user.id);
      if (error) throw new Error(error.message);
    },
    async softDelete(workspaceId) {
      const { error } = await supabaseClient.from("workspaces").update({ deleted_at: new Date().toISOString() }).eq("id", workspaceId);
      if (error) throw new Error(error.message);
    },
    async issueInvite(workspaceId, email, role, modulePermissions) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      const { data, error } = await supabaseClient.from("workspace_invites").insert({
        workspace_id: workspaceId,
        created_by: user?.id,
        email,
        role,
        permissions_notes: modulePermissions?.notes ?? "write",
        permissions_tasks: modulePermissions?.tasks ?? "write",
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async joinInvite(token) {
      const { data: invite, error: inviteError } = await supabaseClient.from("workspace_invites").select("*").eq("token", token).eq("status", "pending").single();
      if (inviteError || !invite) throw new Error("Invalid or expired invite");
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error: memberError } = await supabaseClient.from("workspace_members").insert({
        workspace_id: invite.workspace_id,
        user_id: user.id,
        role: invite.role,
        permissions_notes: invite.permissions_notes,
        permissions_tasks: invite.permissions_tasks,
      });
      if (memberError) throw new Error(memberError.message);
      await supabaseClient.from("workspace_invites").update({ status: "accepted" }).eq("id", invite.id);
      return invite;
    },
    async listMembers(workspaceId) {
      const { data, error } = await supabaseClient.from("workspace_members").select("*, profiles(*)").eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async listInvites(workspaceId) {
      const { data, error } = await supabaseClient.from("workspace_invites").select("*").eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async updateInvite(inviteId, role, modulePermissions) {
      const { error } = await supabaseClient.from("workspace_invites").update({
        role,
        permissions_notes: modulePermissions?.notes ?? "write",
        permissions_tasks: modulePermissions?.tasks ?? "write",
      }).eq("id", inviteId);
      if (error) throw new Error(error.message);
    },
    async revokeInvite(inviteId) {
      const { error } = await supabaseClient.from("workspace_invites").update({ status: "revoked" }).eq("id", inviteId);
      if (error) throw new Error(error.message);
    },
    async updateMemberPermissions(memberId, role, modulePermissions) {
      const { error } = await supabaseClient.from("workspace_members").update({
        role,
        permissions_notes: modulePermissions?.notes ?? "write",
        permissions_tasks: modulePermissions?.tasks ?? "write",
      }).eq("id", memberId);
      if (error) throw new Error(error.message);
    },
    async listNotifications() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return [];
      const { data } = await supabaseClient.from("workspace_notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    async markNotificationRead(notificationId) {
      await supabaseClient.from("workspace_notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId);
    },
    async markAllNotificationsRead() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;
      await supabaseClient.from("workspace_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
    },
  },

  notes: {
    async list(workspaceId) {
      const { data, error } = await supabaseClient.from("notes").select("*, note_shares(*)").eq("workspace_id", workspaceId).is("deleted_at", null).order("position");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async upsert(note: any) {
      // Map camelCase NoteMeta fields to snake_case DB columns
      const row = {
        id: note.id,
        workspace_id: note.workspaceId ?? note.workspace_id,
        created_by: note.ownerId ?? note.owner_id ?? note.created_by,
        title: note.title,
        parent_id: note.parentId ?? note.parent_id ?? null,
        icon: note.icon ?? null,
        kind: note.kind === "section" ? "section" : "note",
        tags: Array.isArray(note.tags) ? note.tags : [],
        is_pinned: !!(note.isPinned ?? note.is_pinned),
        share_scope: note.shareScope ?? note.share_scope ?? "private",
        share_permission: note.sharePermission ?? note.share_permission ?? "view",
        position: note.position,
        is_archived: !!(note.isArchived ?? note.is_archived),
        created_at: note.createdAt ?? note.created_at,
        updated_at: note.updatedAt ?? note.updated_at,
        deleted_at: note.deletedAt ?? note.deleted_at ?? null,
      };
      const { data, error } = await supabaseClient.from("notes").upsert(row, { onConflict: "id" }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async duplicate({ workspaceId, sourceNoteId }) {
      const { data: source, error: srcErr } = await supabaseClient.from("notes").select("*").eq("id", sourceNoteId).single();
      if (srcErr || !source) throw new Error("Source note not found");
      const { data, error } = await supabaseClient.from("notes").insert({
        workspace_id: workspaceId,
        title: `${source.title} (copy)`,
        parent_id: source.parent_id,
        icon: source.icon,
        kind: source.kind === "section" ? "section" : "note",
        tags: source.tags ?? [],
        is_pinned: false,
        share_scope: "private",
        share_permission: "view",
        is_archived: source.is_archived ?? false,
        position: generatePosition(source.position ?? null, null),
        doc_state: source.doc_state,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateSharing({ workspaceId, noteId, shareScope, sharePermission, selectedUsers }) {
      const { data: note, error: noteError } = await supabaseClient
        .from("notes")
        .update({
          share_scope: shareScope,
          share_permission: sharePermission,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", noteId)
        .select("*, note_shares(*)")
        .single();
      if (noteError) throw new Error(noteError.message);

      const { error: deleteError } = await supabaseClient
        .from("note_shares")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("note_id", noteId);
      if (deleteError) throw new Error(deleteError.message);

      if (shareScope === "selected" && selectedUsers.length > 0) {
        const rows = selectedUsers.map((share) => ({
          workspace_id: workspaceId,
          note_id: noteId,
          user_id: share.userId,
          permission: share.permission,
        }));
        const { error: insertError } = await supabaseClient.from("note_shares").insert(rows);
        if (insertError) throw new Error(insertError.message);
      }

      const { data: updated, error: readError } = await supabaseClient
        .from("notes")
        .select("*, note_shares(*)")
        .eq("workspace_id", workspaceId)
        .eq("id", noteId)
        .single();
      if (readError) throw new Error(readError.message);
      return updated ?? note;
    },
    async move({ workspaceId, noteId, newParentId, newPosition }) {
      const { data, error } = await supabaseClient.from("notes").update({
        parent_id: newParentId,
        position: newPosition,
        workspace_id: workspaceId,
      }).eq("id", noteId).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async remove({ workspaceId: _w, noteId, deletedAt }) {
      const { data, error } = await supabaseClient
        .from("notes")
        .update({ deleted_at: deletedAt ?? new Date().toISOString() })
        .eq("id", noteId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async getDocState(_workspaceId, noteId) {
      const { data, error } = await supabaseClient.from("notes").select("doc_state").eq("id", noteId).single();
      const b64len = data?.doc_state?.length ?? 0;
      console.log(`%c[NOTES:getDocState] noteId=${noteId} b64len=${b64len} error=${error?.message ?? null}`, "color:#4af;font-weight:bold");
      if (error || !data) return null;
      return {
        snapshotB64: data.doc_state ?? "",
        lastCompactedUpdateId: 0,
        updates: [],
      };
    },
    async applyCrdtUpdates(workspaceId, noteId, _clientId, updates) {
      // Load existing snapshot so concurrent edits from other clients are merged in.
      const existing = await webRuntime.notes.getDocState(workspaceId, noteId);
      console.log(`%c[NOTES:applyCrdtUpdates] noteId=${noteId} existingB64len=${existing?.snapshotB64?.length ?? 0} incomingUpdates=${updates.length}`, "color:#fa4;font-weight:bold");

      const doc = new Y.Doc();
      // Pre-register root-v2 as YXmlElement BEFORE applying any updates so that
      // child items (paragraph XmlElements, XmlText nodes) are correctly integrated
      // into the typed structure. Without this, doc.get("root-v2") returns AbstractType
      // which can't properly host XML children, causing text content to be lost on merge.
      doc.get("root-v2", Y.XmlElement);

      if (existing?.snapshotB64) {
        try {
          Y.applyUpdate(doc, decodeBase64ToUint8(existing.snapshotB64));
          const root = doc.get("root-v2", Y.XmlElement);
          const children = root.toArray();
          console.log(`%c[NOTES:applyCrdtUpdates] after applying existing snapshot: rootType=${root.constructor.name} rootChildren=${children.length} firstChild=${children[0]?.constructor?.name ?? "none"} firstChildLen=${(children[0] as any)?._length ?? "n/a"}`, "color:#fa4");
        } catch (e) {
          console.error(`[NOTES:applyCrdtUpdates] failed to apply existing snapshot:`, e);
        }
      }

      for (const u of updates) {
        if (u.updateB64) {
          Y.applyUpdate(doc, decodeBase64ToUint8(u.updateB64));
        }
      }
      const root = doc.get("root-v2", Y.XmlElement);
      const children = root.toArray();
      const mergedText = children[0] ? (children[0] as any).toArray?.().map((t: any) => t.toString?.() ?? "").join("") : "";
      console.log(`%c[NOTES:applyCrdtUpdates] MERGED before save: rootType=${root.constructor.name} rootChildren=${children.length} firstChild=${children[0]?.constructor?.name ?? "none"} firstChildLen=${(children[0] as any)?._length ?? "n/a"} textPreview="${mergedText.slice(0, 60)}"`, "color:#4fa;font-weight:bold");

      // Guard: the incoming updates are now full Y.Doc snapshots (see flush() in
      // sync-engine.ts). If the merge result produced an empty body but the client's
      // own snapshot contains text, the merge went wrong — use the client snapshot
      // directly as the source of truth to prevent note body erasure.
      let snapshotToSave: string;
      if (!mergedText && updates.length > 0) {
        const clientDoc = new Y.Doc();
        clientDoc.get("root-v2", Y.XmlElement);
        for (const u of updates) {
          if (u.updateB64) {
            try { Y.applyUpdate(clientDoc, decodeBase64ToUint8(u.updateB64)); } catch { /* ignore */ }
          }
        }
        const clientRoot = clientDoc.get("root-v2", Y.XmlElement);
        const clientChildren = clientRoot.toArray();
        const clientText = clientChildren[0]
          ? (clientChildren[0] as any).toArray?.().map((t: any) => t.toString?.() ?? "").join("")
          : "";
        if (clientText) {
          console.warn(`[NOTES:applyCrdtUpdates] merge produced empty body but client snapshot has text — using client snapshot for ${noteId}`);
          snapshotToSave = encodeUint8ToBase64(Y.encodeStateAsUpdate(clientDoc));
        } else {
          snapshotToSave = encodeUint8ToBase64(Y.encodeStateAsUpdate(doc));
        }
      } else {
        snapshotToSave = encodeUint8ToBase64(Y.encodeStateAsUpdate(doc));
      }

      console.log(`%c[NOTES:applyCrdtUpdates] saving snapshot len=${snapshotToSave.length} to DB`, "color:#fa4");
      const { error } = await supabaseClient.from("notes")
        .update({ doc_state: snapshotToSave, updated_at: new Date().toISOString() })
        .eq("id", noteId);
      if (error) {
        console.error(`[NOTES:applyCrdtUpdates] DB save FAILED:`, error.message);
        throw new Error(error.message);
      }
      console.log(`%c[NOTES:applyCrdtUpdates] DB save OK`, "color:#4fa;font-weight:bold");
      return { noteId, updates: [], existing: null };
    },
    async subscribeLocal(_workspaceId, noteId) {
      return noteId ? `note:${noteId}` : "notes:all";
    },
  },

  tasks: {
    async list(workspaceId) {
      const [projectsRes, statesRes, itemsRes, commentsRes] = await Promise.all([
        supabaseClient.from("tasks_projects").select("*").eq("workspace_id", workspaceId).is("deleted_at", null),
        supabaseClient.from("tasks_states").select("*"),
        supabaseClient.from("tasks_items").select("*").is("deleted_at", null),
        supabaseClient.from("tasks_comments").select("*").is("deleted_at", null),
      ]);
      return {
        projects: projectsRes.data ?? [],
        states: statesRes.data ?? [],
        tasks: itemsRes.data ?? [],
        comments: commentsRes.data ?? [],
      };
    },
    async upsert(input) {
      if (input.project) {
        const { data, error } = await supabaseClient.from("tasks_projects").upsert(input.project, { onConflict: "id" }).select().single();
        if (error) throw new Error(error.message);
        return { project: data };
      }
      if (input.workflowState) {
        const { data, error } = await supabaseClient.from("tasks_states").upsert(input.workflowState, { onConflict: "id" }).select().single();
        if (error) throw new Error(error.message);
        return { workflowState: data };
      }
      if (input.task) {
        const { data, error } = await supabaseClient.from("tasks_items").upsert(input.task, { onConflict: "id" }).select().single();
        if (error) throw new Error(error.message);
        return { task: data };
      }
      return null;
    },
    upsertProject(project) { return webRuntime.tasks.upsert({ project }).then((r: any) => r?.project ?? r); },
    upsertState(workflowState) { return webRuntime.tasks.upsert({ workflowState }).then((r: any) => r?.workflowState ?? r); },
    upsertItem(task) { return webRuntime.tasks.upsert({ task }).then((r: any) => r?.task ?? r); },
    async move({ taskId, newStateId, newPosition }) {
      const { data, error } = await supabaseClient.from("tasks_items").update({ state_id: newStateId, position: parseInt(newPosition) || 0 }).eq("id", taskId).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async deleteItem({ taskId, deletedAt }) {
      const { error } = await supabaseClient.from("tasks_items").update({ deleted_at: deletedAt ?? new Date().toISOString() }).eq("id", taskId);
      if (error) throw new Error(error.message);
      return { taskId };
    },
    async addComment(comment) {
      const { data, error } = await supabaseClient.from("tasks_comments").insert(comment).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    upsertComment(comment) { return webRuntime.tasks.addComment(comment); },
    async deleteComment(commentId) {
      await supabaseClient.from("tasks_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
    },
    async subscribeLocal(workspaceId) {
      return `tasks:${workspaceId}`;
    },
  },

  graph: {
    async upsertNodesEdges() { /* Graph search not available on web in v1 */ },
    async queryRelated() { return []; },
    async queryHybrid() { return []; },
    async getFullGraph() { return { nodes: [], edges: [] }; },
  },

  migration: {
    async importLegacy() { throw new Error(desktopOnly().message); },
  },

  localStore: {
    async get(namespace, key) {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(`${LS_PREFIX}${namespace}:${key}`);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
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
    async list() { return { entries: [], categories: [], rules: [], projects: [] }; },
    async upsertEntry() { throw new Error(desktopOnly().message); },
    async deleteEntry() { throw new Error(desktopOnly().message); },
    async upsertCategory() { throw new Error(desktopOnly().message); },
    async deleteCategory() { throw new Error(desktopOnly().message); },
    async upsertRule() { throw new Error(desktopOnly().message); },
    async deleteRule() { throw new Error(desktopOnly().message); },
    async upsertProject() { throw new Error(desktopOnly().message); },
    async deleteProject() { throw new Error(desktopOnly().message); },
    async upsertFocusSession() { throw new Error(desktopOnly().message); },
    async getActiveWindow() { return null; },
    async startTracking() { throw new Error(desktopOnly().message); },
    async stopTracking() { throw new Error(desktopOnly().message); },
    async getTrackingStatus() { return { isTracking: false }; },
  },

  email: {
    async listAccounts() { return []; },
    async connectAndSave() { throw new Error(desktopOnly().message); },
    async disconnect() { throw new Error(desktopOnly().message); },
    async listEnvelopes() { throw new Error(desktopOnly().message); },
    async getMessageBody() { throw new Error(desktopOnly().message); },
    async prefetchBodies() { throw new Error(desktopOnly().message); },
    async syncNow() { throw new Error(desktopOnly().message); },
    async setActivityState() { /* no-op on web */ },
    async applyFlag() { throw new Error(desktopOnly().message); },
    async getMailboxStatus() { return []; },
    async sendSaved() { throw new Error(desktopOnly().message); },
  },

  integrations: {
    async getStatus(): Promise<IntegrationStatusItem[]> { return []; },
    async connectZoom(): Promise<IntegrationStatusItem> { throw new Error(desktopOnly().message); },
    async connectGoogleMeet(): Promise<IntegrationStatusItem> { throw new Error(desktopOnly().message); },
    async disconnect(): Promise<void> { throw new Error(desktopOnly().message); },
  },

  calendar: {
    async listEvents() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return [];
      const { data } = await supabaseClient.from("calendar_events").select("*").eq("owner_id", user.id).is("deleted_at", null);
      return data ?? [];
    },
    async upsertEvent(event) {
      const { error } = await supabaseClient.from("calendar_events").upsert(event, { onConflict: "id" });
      return !error;
    },
    async deleteEvent(eventId) {
      const { error } = await supabaseClient.from("calendar_events").update({ deleted_at: new Date().toISOString() }).eq("id", eventId);
      return !error;
    },
    async upsertGoogleEvent() { return null; },
    async deleteGoogleEvent() { return false; },
    async syncGoogleEvents() { return false; },
    async startGoogleOAuth() { throw new Error(desktopOnly().message); },
    async startOutlookOAuth() { throw new Error(desktopOnly().message); },
    async startAppleOAuth() { throw new Error(desktopOnly().message); },
  },
};
