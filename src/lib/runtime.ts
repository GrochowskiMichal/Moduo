import { invoke } from "@tauri-apps/api/core";

export type RuntimeSession = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number;
  user: {
    id: string;
    email?: string | null;
  };
};

type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";
type AuthListener = (event: AuthChangeEvent, session: RuntimeSession | null) => void;

type RuntimeResult<T> = Promise<{ data: T; error: { message: string } | null }>;

export type LocalAuthState = {
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
};

export type AuthMnemonic = {
  words: string[];
  phrase: string;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

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

export type ModuoRuntime = {
  auth: {
    getLocalAuthState(): RuntimeResult<LocalAuthState>;
    generateMnemonic(): RuntimeResult<AuthMnemonic>;
    registerLocalMnemonic(args: {
      displayName: string;
      mnemonicPhrase: string;
      inviteToken?: string;
    }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    unlockWithMnemonic(args: {
      mnemonicPhrase: string;
      inviteToken?: string;
    }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    forgotResetLocal(): Promise<{ error: { message: string } | null }>;
    tryAutoUnlock(): RuntimeResult<{ session: RuntimeSession | null }>;
    setPin(pin: string): Promise<{ error: { message: string } | null }>;
    unlockWithPin(pin: string): RuntimeResult<{ session: RuntimeSession | null }>;
    removePin(): Promise<{ error: { message: string } | null }>;
    updateDisplayName(displayName: string): RuntimeResult<{ displayName: string }>;
    getStoredMnemonic(): RuntimeResult<{ phrase: string | null }>;
    getSession(): RuntimeResult<{ session: RuntimeSession | null }>;
    refreshSession(): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    onAuthStateChange(cb: AuthListener): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<{ error: { message: string } | null }>;
  };
  workspace: {
    list(): Promise<any[]>;
    create(name: string): Promise<any>;
    rename(workspaceId: string, name: string): Promise<any>;
    leave(workspaceId: string): Promise<void>;
    softDelete(workspaceId: string): Promise<void>;
    issueInvite(
      workspaceId: string,
      email: string,
      role: string,
      modulePermissions?: { notes?: string; tasks?: string }
    ): Promise<any>;
    joinInvite(token: string): Promise<any>;
    listMembers(workspaceId: string): Promise<any[]>;
    listInvites(workspaceId: string): Promise<any[]>;
    updateInvite(
      inviteId: string,
      role: string,
      modulePermissions?: { notes?: string; tasks?: string }
    ): Promise<void>;
    revokeInvite(inviteId: string): Promise<void>;
    updateMemberPermissions(
      memberId: string,
      role: string,
      modulePermissions?: { notes?: string; tasks?: string }
    ): Promise<void>;
    listNotifications(): Promise<any[]>;
    markNotificationRead(notificationId: string): Promise<void>;
    markAllNotificationsRead(): Promise<void>;
  };
  notes: {
    list(workspaceId: string): Promise<any[]>;
    upsert(note: any): Promise<any>;
    move(input: {
      workspaceId: string;
      noteId: string;
      newParentId: string | null;
      newPosition: string;
    }): Promise<any>;
    remove(input: { workspaceId: string; noteId: string; deletedAt?: string }): Promise<any>;
    getDocState(workspaceId: string, noteId: string): Promise<any>;
    applyCrdtUpdates(
      workspaceId: string,
      noteId: string,
      clientId: string,
      updates: Array<{ idempotencyKey?: string; clientSeq: number; updateB64: string }>
    ): Promise<any>;
    subscribeLocal(workspaceId: string, noteId?: string | null): Promise<string>;
  };
  tasks: {
    list(workspaceId: string): Promise<any>;
    upsert(input: { project?: any; workflowState?: any; task?: any }): Promise<any>;
    upsertProject(project: any): Promise<any>;
    upsertState(workflowState: any): Promise<any>;
    upsertItem(task: any): Promise<any>;
    move(input: {
      workspaceId: string;
      taskId: string;
      newParentTaskId: string | null;
      newStateId: string;
      newPosition: string;
    }): Promise<any>;
    deleteItem(input: { workspaceId: string; taskId: string; deletedAt?: string }): Promise<any>;
    addComment(comment: any): Promise<any>;
    upsertComment(comment: any): Promise<any>;
    deleteComment(commentId: string): Promise<void>;
    subscribeLocal(workspaceId: string): Promise<string>;
  };
  graph: {
    upsertNodesEdges(request: any): Promise<void>;
    queryRelated(workspaceId: string, nodeId: string, limit?: number): Promise<any>;
    queryHybrid(query: any): Promise<any[]>;
    getFullGraph(workspaceId: string): Promise<any>;
  };
  p2p: {
    start(): Promise<void>;
    peerStatus(): Promise<any>;
    syncNow(workspaceId: string): Promise<any>;
  };
  migration: {
    importLegacy(payload: any): Promise<any>;
  };
  localStore: {
    get(namespace: string, key: string): Promise<any>;
    set(namespace: string, key: string, value: unknown): Promise<void>;
    remove(namespace: string, key: string): Promise<void>;
  };
  email: {
    listAccounts(): Promise<any[]>;
    connectAndSave(input: any): Promise<any>;
    disconnect(accountId: string): Promise<void>;
    listEnvelopes(input: {
      accountId?: string | null;
      folder: string;
      limit?: number;
      forceSync?: boolean;
    }): Promise<any>;
    getMessageBody(input: { accountId: string; folder: string; uid: number }): Promise<any>;
    prefetchBodies(input: {
      accountId: string;
      folder: string;
      uids: number[];
      limit?: number;
    }): Promise<any>;
    syncNow(input: { accountId?: string | null; folder?: string | null }): Promise<any>;
    setActivityState(input: {
      mode: "mailForeground" | "appForegroundNonMail" | "appBackground";
      activeAccountId?: string | null;
      activeFolder?: string | null;
    }): Promise<void>;
    applyFlag(input: {
      accountId: string;
      folder: string;
      uid: number;
      flag: "seen" | "starred";
      value: boolean;
    }): Promise<any>;
    getMailboxStatus(input?: { accountId?: string | null }): Promise<any[]>;
    sendSaved(input: {
      accountId: string;
      to: string;
      subject: string;
      body: string;
    }): Promise<boolean>;
  };
};

const runtimeClient: ModuoRuntime = {
  auth: {
    async getLocalAuthState() {
      try {
        const raw = await invoke<any>("auth_get_local_auth_state");
        return {
          data: {
            profileExists: !!(raw?.profileExists ?? raw?.profile_exists),
            displayName: raw?.displayName ?? raw?.display_name ?? null,
            userId: raw?.userId ?? raw?.user_id ?? null,
            hasPin: !!(raw?.hasPin ?? raw?.has_pin),
            hasKeychainMnemonic: !!(raw?.hasKeychainMnemonic ?? raw?.has_keychain_mnemonic),
          },
          error: null,
        };
      } catch (error) {
        return {
          data: {
            profileExists: false,
            displayName: null,
            userId: null,
            hasPin: false,
            hasKeychainMnemonic: false,
          },
          error: toError(error),
        };
      }
    },
    async generateMnemonic() {
      try {
        const raw = await invoke<any>("auth_generate_mnemonic");
        return {
          data: {
            words: Array.isArray(raw?.words) ? raw.words : [],
            phrase: raw?.phrase ?? "",
          },
          error: null,
        };
      } catch (error) {
        return { data: { words: [], phrase: "" }, error: toError(error) };
      }
    },
    async registerLocalMnemonic({ displayName, mnemonicPhrase, inviteToken }) {
      try {
        const raw = await invoke<any>("auth_register_local_mnemonic", {
          input: {
            displayName,
            mnemonicPhrase,
            inviteToken: inviteToken ?? null,
          },
        });
        const session = normalizeSession(raw?.session);
        emitAuth("SIGNED_IN", session);
        return {
          data: {
            user: session?.user ?? null,
            session,
          },
          error: null,
        };
      } catch (error) {
        return { data: { user: null, session: null }, error: toError(error) };
      }
    },
    async unlockWithMnemonic({ mnemonicPhrase, inviteToken }) {
      try {
        await invoke("auth_unlock_with_mnemonic", {
          input: {
            mnemonicPhrase,
            inviteToken: inviteToken ?? null,
          },
        });
        const next = await runtimeClient.auth.getSession();
        emitAuth("SIGNED_IN", next.data.session ?? null);
        return {
          data: {
            user: next.data.session?.user ?? null,
            session: next.data.session ?? null,
          },
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
      void runtimeClient.auth.getSession().then((result: any) => {
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
  },
  workspace: {
    list() {
      return invoke<any[]>("workspace_list_local");
    },
    create(name) {
      return invoke<any>("workspace_create_local", { name });
    },
    rename(workspaceId, name) {
      return invoke<any>("workspace_rename_local", { workspaceId, name });
    },
    leave(workspaceId) {
      return invoke<void>("workspace_leave_local", { workspaceId });
    },
    softDelete(workspaceId) {
      return invoke<void>("workspace_soft_delete_local", { workspaceId });
    },
    issueInvite(workspaceId, email, role, modulePermissions) {
      return invoke<any>("workspace_issue_invite", {
        workspaceId,
        email,
        role,
        modulePermissions,
      });
    },
    joinInvite(token) {
      return invoke<any>("workspace_join_invite", { token });
    },
    listMembers(workspaceId) {
      return invoke<any[]>("workspace_list_members", { workspaceId });
    },
    listInvites(workspaceId) {
      return invoke<any[]>("workspace_list_invites", { workspaceId });
    },
    updateInvite(inviteId, role, modulePermissions) {
      return invoke<void>("workspace_update_invite", {
        input: { inviteId, role, modulePermissions },
      });
    },
    revokeInvite(inviteId) {
      return invoke<void>("workspace_revoke_invite", { inviteId });
    },
    updateMemberPermissions(memberId, role, modulePermissions) {
      return invoke<void>("workspace_update_member_permissions", {
        input: { memberId, role, modulePermissions },
      });
    },
    listNotifications() {
      return invoke<any[]>("workspace_list_notifications");
    },
    markNotificationRead(notificationId) {
      return invoke<void>("workspace_mark_notification_read", { notificationId });
    },
    markAllNotificationsRead() {
      return invoke<void>("workspace_mark_all_notifications_read");
    },
  },
  notes: {
    list(workspaceId) {
      return invoke<any[]>("notes_list", { workspaceId });
    },
    upsert(note) {
      return invoke<any>("notes_upsert", { note });
    },
    move(input) {
      return invoke<any>("notes_move", { input });
    },
    remove(input) {
      return invoke<any>("notes_delete", { input });
    },
    getDocState(workspaceId, noteId) {
      return invoke<any>("notes_get_doc_state", { workspaceId, noteId });
    },
    applyCrdtUpdates(workspaceId, noteId, clientId, updates) {
      return invoke<any>("notes_apply_crdt_updates", {
        workspaceId,
        noteId,
        clientId,
        updates,
      });
    },
    subscribeLocal(workspaceId, noteId) {
      return invoke<string>("notes_subscribe_local", {
        workspaceId,
        noteId: noteId ?? null,
      });
    },
  },
  tasks: {
    list(workspaceId) {
      return invoke<any>("tasks_list", { workspaceId });
    },
    upsert(input) {
      return invoke<any>("tasks_upsert", { input });
    },
    upsertProject(project) {
      return runtimeClient.tasks
        .upsert({ project })
        .then((result: any) => result?.project ?? result);
    },
    upsertState(workflowState) {
      return runtimeClient.tasks
        .upsert({ workflowState })
        .then((result: any) => result?.workflowState ?? result);
    },
    upsertItem(task) {
      return runtimeClient.tasks.upsert({ task }).then((result: any) => result?.task ?? result);
    },
    move(input) {
      return invoke<any>("tasks_move", { input });
    },
    deleteItem(input) {
      return invoke<any>("tasks_delete_item", { input });
    },
    addComment(comment) {
      return invoke<any>("tasks_add_comment", { comment });
    },
    upsertComment(comment) {
      return runtimeClient.tasks.addComment(comment);
    },
    deleteComment(commentId) {
      return invoke<void>("tasks_delete_comment", { commentId });
    },
    subscribeLocal(workspaceId) {
      return invoke<string>("tasks_subscribe_local", { workspaceId });
    },
  },
  graph: {
    upsertNodesEdges(request) {
      return invoke<void>("graph_upsert_nodes_edges", { request });
    },
    queryRelated(workspaceId, nodeId, limit) {
      return invoke<any>("graph_query_related", { workspaceId, nodeId, limit });
    },
    queryHybrid(query) {
      return invoke<any[]>("graph_query_hybrid", { query });
    },
    getFullGraph(workspaceId) {
      return invoke<any>("graph_get_full", { workspaceId });
    }
  },
  p2p: {
    start() {
      return invoke<void>("p2p_start");
    },
    peerStatus() {
      return invoke<any>("p2p_peer_status");
    },
    syncNow(workspaceId) {
      return invoke<any>("p2p_sync_now", { workspaceId });
    },
  },
  migration: {
    importLegacy(payload) {
      return invoke<any>("migration_import_legacy", { payload });
    },
  },
  localStore: {
    get(namespace, key) {
      return invoke("local_store_get", { namespace, key });
    },
    set(namespace, key, value) {
      return invoke("local_store_set", { namespace, key, value });
    },
    remove(namespace, key) {
      return invoke("local_store_remove", { namespace, key });
    },
  },
  email: {
    listAccounts() {
      return invoke<any[]>("email_accounts_list");
    },
    connectAndSave(input) {
      return invoke<any>("email_account_connect_and_save", { input });
    },
    disconnect(accountId) {
      return invoke<void>("email_account_disconnect", { accountId });
    },
    listEnvelopes(input) {
      return invoke<any>("email_list_envelopes", { input });
    },
    getMessageBody(input) {
      return invoke<any>("email_get_message_body", { input });
    },
    prefetchBodies(input) {
      return invoke<any>("email_prefetch_bodies", { input });
    },
    syncNow(input) {
      return invoke<any>("email_sync_now", { input });
    },
    setActivityState(input) {
      return invoke<void>("email_set_activity_state", { input });
    },
    applyFlag(input) {
      return invoke<any>("email_apply_flag", { input });
    },
    getMailboxStatus(input) {
      return invoke<any[]>("email_get_mailbox_status", { input: input ?? {} });
    },
    sendSaved(input) {
      return invoke<boolean>("email_send_saved", input);
    },
  },
};

export const runtimeConfigError = isTauriRuntime()
  ? null
  : "Rust desktop runtime is required. Run inside Tauri (dev:desktop/build:desktop).";

export const runtime: ModuoRuntime | null = isTauriRuntime() ? runtimeClient : null;
