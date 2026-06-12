/**
 * Shared types and the ModuoRuntime interface.
 * Implementations live in runtime.tauri.ts (desktop) and runtime.web.ts (web).
 */

import type {
  Bucket,
  Tag,
  TagLink,
  Task,
  TaskRelation,
  TasksModuleBundle,
  TimeBlockMap,
} from "../features/tasks/model";

export type RuntimeSession = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number;
  user: {
    id: string;
    email?: string | null;
  };
};

export type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";
export type AuthListener = (event: AuthChangeEvent, session: RuntimeSession | null) => void;

export type RuntimeResult<T> = Promise<{ data: T; error: { message: string } | null }>;

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

/** Per-platform capability flags. Components read this to hide desktop-only UI on web. */
export type RuntimeCapabilities = {
  isDesktop: boolean;
  isWeb: boolean;
  hasEmail: boolean;
  hasTimeTracking: boolean;
  hasCalendarOAuth: boolean;
  hasLocalMnemonic: boolean;
  hasOfflineMode: boolean;
};

export type IntegrationStatusItem = {
  provider: string;
  connected: boolean;
};

export type ModuoRuntime = {
  capabilities: RuntimeCapabilities;

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
    refreshSession(): RuntimeResult<{
      user: RuntimeSession["user"] | null;
      session: RuntimeSession | null;
    }>;
    onAuthStateChange(cb: AuthListener): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<{ error: { message: string } | null }>;
    /** Cloud (Supabase) signup — desktop: links local identity to Supabase; web: primary signup. */
    signUpWithEmail(args: {
      email: string;
      password: string;
      displayName?: string;
    }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    /** Cloud sign-in with email + password. */
    signInWithEmail(args: {
      email: string;
      password: string;
    }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    /** Send a magic OTP code to the given email (web primary auth). */
    sendOtp(args: { email: string }): RuntimeResult<{}>;
    /** Verify the OTP code received by email and sign the user in. */
    verifyOtp(args: {
      email: string;
      token: string;
      sentAt?: number;
    }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null; isNewUser?: boolean }>;
  };

  workspace: {
    getProfile(userId: string): Promise<{ data: { plan_tier?: string; display_name?: string; avatar_url?: string } | null; error: any }>;
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
    duplicate(input: { workspaceId: string; sourceNoteId: string }): Promise<any>;
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

  graph: {
    upsertNodesEdges(request: any): Promise<void>;
    queryRelated(workspaceId: string, nodeId: string, limit?: number): Promise<any>;
    queryHybrid(query: any): Promise<any[]>;
    getFullGraph(workspaceId: string): Promise<any>;
  };

  migration: {
    importLegacy(payload: any): Promise<any>;
  };

  localStore: {
    get(namespace: string, key: string): Promise<any>;
    set(namespace: string, key: string, value: unknown): Promise<void>;
    remove(namespace: string, key: string): Promise<void>;
  };

  window: {
    toggleFullscreen(): Promise<boolean>;
    openExternalUrl(url: string): Promise<void>;
  };

  timetracking: {
    list(workspaceId: string): Promise<any>;
    upsertEntry(entry: any): Promise<any>;
    deleteEntry(entryId: string): Promise<void>;
    upsertCategory(category: any): Promise<any>;
    deleteCategory(categoryId: string): Promise<void>;
    upsertRule(rule: any): Promise<any>;
    deleteRule(ruleId: string): Promise<void>;
    upsertProject(project: any): Promise<any>;
    deleteProject(projectId: string): Promise<void>;
    upsertFocusSession(session: any): Promise<any>;
    getActiveWindow(): Promise<any | null>;
    startTracking(workspaceId: string): Promise<void>;
    stopTracking(): Promise<void>;
    getTrackingStatus(): Promise<{ isTracking: boolean }>;
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

  integrations: {
    getStatus(): Promise<IntegrationStatusItem[]>;
    connectZoom(): Promise<IntegrationStatusItem>;
    connectGoogleMeet(): Promise<IntegrationStatusItem>;
    disconnect(provider: string): Promise<void>;
  };

  calendar: {
    listEvents(): Promise<any[]>;
    upsertEvent(event: any): Promise<boolean>;
    deleteEvent(eventId: string): Promise<boolean>;
    upsertGoogleEvent(accountId: string, event: any): Promise<any | null>;
    deleteGoogleEvent(accountId: string, eventId: string): Promise<boolean>;
    syncGoogleEvents(accountId: string): Promise<boolean>;
    startGoogleOAuth(): Promise<any>;
    startOutlookOAuth(): Promise<any>;
    startAppleOAuth(): Promise<any>;
  };

  /**
   * Tasks module v1 — buckets / tasks / tags. Desktop reads/writes the
   * local-first redb store via Tauri commands; web talks to Supabase directly.
   * Both seed the reserved Inbox bucket lazily on first `list`.
   */
  tasks: {
    list(workspaceId: string): Promise<TasksModuleBundle>;
    seedInbox(workspaceId: string): Promise<Bucket>;
    upsertBucket(bucket: Bucket): Promise<Bucket>;
    deleteBucket(input: { workspaceId: string; bucketId: string }): Promise<void>;
    upsertTask(task: Task): Promise<Task>;
    deleteTask(input: { workspaceId: string; taskId: string }): Promise<Task>;
    upsertTag(tag: Tag): Promise<Tag>;
    deleteTag(input: { workspaceId: string; tagId: string }): Promise<void>;
    attachTag(input: {
      workspaceId: string;
      tagId: string;
      entityType: string;
      entityId: string;
    }): Promise<TagLink>;
    detachTag(input: {
      workspaceId: string;
      tagId: string;
      entityType: string;
      entityId: string;
    }): Promise<void>;
    /** Blocked-by dependency edge (blocker → blocked, spec §5c). Idempotent. */
    createTaskRelation(input: {
      workspaceId: string;
      blockerTaskId: string;
      blockedTaskId: string;
    }): Promise<TaskRelation>;
    deleteTaskRelation(input: { workspaceId: string; relationId: string }): Promise<void>;
    /** Workspace-scoped time-of-day slot → bucket map (one row per workspace). */
    getTimeBlocks(workspaceId: string): Promise<TimeBlockMap>;
    setTimeBlocks(input: { workspaceId: string; blocks: TimeBlockMap }): Promise<TimeBlockMap>;
  };
};
