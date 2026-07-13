/**
 * Shared types and the ModuoRuntime interface.
 * Implementations live in runtime.tauri.ts (desktop) and runtime.web.ts (web).
 */

import type {
  ActivityEntry,
  Bucket,
  RecurrenceRule,
  Tag,
  TagLink,
  Task,
  TaskRelation,
  TasksCatchUpItem,
  TasksModuleBundle,
  TaskStatus,
  TimeBlockMap,
} from "../features/tasks/model";
import type {
  Company,
  Contact,
  ContactChannel,
  ContactCustomValue,
  ContactDateEntry,
  ContactFieldDef,
  ContactFieldType,
  ContactsModuleBundle,
} from "../features/contacts/model";
import type { ContactImportResult, ContactImportRow } from "../features/contacts/import";
import type {
  CalendarAccountModel,
  CalendarEventModel,
  CalendarEventPatch,
  CalendarMirrorEventInput,
  CalendarModuleBundle,
} from "../features/calendar/events";
import type {
  Note as NoteV2,
  NoteDocPull,
  NotesImportRow,
  NotesV2Bundle,
} from "../features/notes/model";
import type { DashboardLayout } from "../features/dashboard/engine/types";
import type { NeedsAttentionItem } from "../features/contacts/needs-attention";
import type { ReconnectItem } from "../features/contacts/reconnect";
import type { NotificationItem } from "../features/spine/notifications";
import type { RawLinkSuggestion } from "../features/spine/suggest";
import type { RecentLinkItem } from "../features/spine/recent";
import type {
  EntityLink,
  EntityRecord,
  EntityRef,
  LinkOrigin,
  RelationKind,
} from "./entity-links";

/** A comment on any registered entity (spine block CT-5). */
export type SpineComment = {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

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

/**
 * A workspace-scoped API key for the Moduo MCP connector
 * (docs/moduo-mcp-connector.md). The secret is returned exactly once from
 * `createApiKey` and never readable again — only the prefix is stored in
 * clear. `scopes` maps module → "none" | "view" | "edit" (view by default;
 * admin is never key-grantable).
 */
export type WorkspaceApiKey = {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  scopes: Record<string, string>;
  createdAt: string;
  lastUsedAt: string | null;
};

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

/** A stored dashboard layout + its client-set LWW timestamp (DB-4). */
export type StoredDashboardLayout = {
  layout: DashboardLayout;
  updatedAt: string;
};

/** One habit row (DB-7). Preference-class, user-scoped; `checks` are local-date
 * strings ('YYYY-MM-DD'). Streaks are computed client-side. */
export type HabitRow = {
  id: string;
  workspaceId: string;
  name: string;
  emoji: string;
  position: string;
  checks: string[];
  createdAt: string;
  updatedAt: string;
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
    /**
     * Remove another member from the workspace (owner/admin only, never an
     * owner or yourself — use `leave` for self-exit). Routes through the
     * `workspace_op_remove_member` SECURITY DEFINER RPC because the base
     * `workspace_members` write-RLS is own-row. DF-24.
     */
    removeMember(memberId: string): Promise<void>;
    /**
     * Hand workspace ownership to another member (owner-only): promotes them to
     * owner, demotes the caller to admin. SECURITY DEFINER RPC. Needed by the
     * account-deletion flow — an owner must hand off before deleting.
     */
    transferOwnership(memberId: string): Promise<void>;
    /** Shareable `/join?invite=<token>` accept link (web origin, tauri-safe). */
    inviteUrl(token: string): string;
    listNotifications(): Promise<any[]>;
    markNotificationRead(notificationId: string): Promise<void>;
    markAllNotificationsRead(): Promise<void>;
    /** Live (unrevoked) MCP connector keys. Owner/admin only (RLS-enforced). */
    listApiKeys(workspaceId: string): Promise<WorkspaceApiKey[]>;
    /** Create a key; the returned `secret` is shown once and never again. */
    createApiKey(input: {
      workspaceId: string;
      name: string;
      scopes: Record<string, string>;
    }): Promise<WorkspaceApiKey & { secret: string }>;
    revokeApiKey(keyId: string): Promise<void>;
    /** The Moduo MCP connector URL agents connect to (same on web + desktop). */
    getMcpEndpoint(): string;
  };

  /**
   * LEGACY read-only notes surface. Two survivors: the one-time redb import
   * (desktop reads the local store through them) and the legacy dashboard
   * notes-preview widget. The write half died with the Wave-3 rebuild —
   * mutations go through `notesV2`.
   */
  notes: {
    list(workspaceId: string): Promise<any[]>;
    getDocState(workspaceId: string, noteId: string): Promise<any>;
  };

  /**
   * Wave-3 Notes rebuild surface (specs/notes.md NO-1). Cloud-first on both
   * platforms (desktop delegates wholesale). Writes = notes_op_* intent RPCs;
   * reads degrade pre-migration (`degraded: true` on the bundle). The legacy
   * `notes` namespace above retires with NO-2/NO-3.
   */
  notesV2: {
    listMeta(workspaceId: string): Promise<NotesV2Bundle>;
    /** Snapshot + update-log-since-cursor for one note (the sync engine's pull). */
    pullDoc(input: {
      workspaceId: string;
      noteId: string;
      sinceUpdateId?: number | null;
    }): Promise<NoteDocPull>;
    create(input: {
      workspaceId: string;
      id?: string | null;
      parentId?: string | null;
      title?: string;
      position?: string;
      icon?: string | null;
    }): Promise<NoteV2>;
    rename(input: { workspaceId: string; noteId: string; title: string }): Promise<NoteV2>;
    move(input: {
      workspaceId: string;
      noteId: string;
      parentId: string | null;
      position: string;
    }): Promise<NoteV2>;
    setMeta(input: {
      workspaceId: string;
      noteId: string;
      patch: { icon?: string | null; isPinned?: boolean };
    }): Promise<NoteV2>;
    duplicate(input: {
      workspaceId: string;
      sourceNoteId: string;
      position?: string;
    }): Promise<NoteV2>;
    archive(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
    unarchive(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
    trash(input: { workspaceId: string; noteId: string }): Promise<{
      trashedIds: string[];
      count: number;
    }>;
    restore(input: { workspaceId: string; noteId: string }): Promise<{
      restoredIds: string[];
      count: number;
    }>;
    purge(input: { workspaceId: string; noteId: string }): Promise<{ count: number }>;
    /** 30-day trash sweep on module load; degrades quietly pre-deploy. */
    purgeExpired(workspaceId: string): Promise<{ count: number }>;
    publish(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
    unpublish(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
    /** Public read URL for a published note's token (NO-9, the notes-public
     * edge function renders the subtree from body_md). Pure string builder. */
    publishedUrl(token: string): string;
    /** Recently-touched notes for the dashboard widget (NO-10). Trashed
     * excluded; degrades to [] pre-migration (a widget never walls). */
    recent(input: { workspaceId: string; limit?: number }): Promise<
      {
        id: string;
        title: string;
        bodyText: string;
        updatedAt: string;
        isArchived: boolean;
        publishedAt: string | null;
      }[]
    >;
    /** Idempotent outbox push (batched CRDT updates + optional derived body). */
    pushUpdates(input: {
      workspaceId: string;
      noteId: string;
      clientId: string;
      updates: Array<{ clientSeq: number; updateB64: string }>;
      bodyText?: string | null;
      bodyMd?: string | null;
    }): Promise<{ inserted: number; duplicates: number; maxUpdateId: number | null }>;
    /** Client-driven compaction: fold the update log into the snapshot. */
    saveSnapshot(input: {
      workspaceId: string;
      noteId: string;
      snapshotB64: string;
      uptoUpdateId: number;
      bodyText?: string | null;
      bodyMd?: string | null;
    }): Promise<{ folded: number; docVersion: number }>;
    importNotes(input: {
      workspaceId: string;
      rows: NotesImportRow[];
    }): Promise<{ imported: number; skipped: number }>;
    mention(input: {
      workspaceId: string;
      noteId: string;
      mentionedUserIds: string[];
    }): Promise<void>;
    /** Full-text sidebar search (NO-8, AC8) over the server `search_tsv` GIN
     * index; trashed excluded, archived flagged. Degrades to [] pre-migration. */
    search(input: { workspaceId: string; query: string; limit?: number }): Promise<
      { id: string; title: string; bodyText: string; isArchived: boolean; deletedAt: string | null }[]
    >;
    /** `body_md` for a set of notes — the per-note / tree markdown export source. */
    fetchExportDocs(input: {
      workspaceId: string;
      ids: string[];
    }): Promise<{ id: string; title: string; bodyMd: string }[]>;
  };

  migration: {
    importLegacy(payload: any): Promise<any>;
  };

  localStore: {
    get(namespace: string, key: string): Promise<any>;
    set(namespace: string, key: string, value: unknown): Promise<void>;
    remove(namespace: string, key: string): Promise<void>;
  };

  /**
   * Cross-device user settings (appearance + focus). Cloud-first: web hits
   * Supabase directly; desktop delegates to the web runtime. Both return null
   * when signed out. `set` upserts only the domains present in the patch.
   */
  preferences: {
    get(): Promise<UserPreferences | null>;
    set(patch: Partial<UserPreferences>): Promise<UserPreferences | null>;
  };

  /**
   * The Home dashboard layout for one user+workspace (DB-4). Preference-class:
   * a direct RLS upsert (no intent op, no activity, no registry) into the
   * `dashboard_layouts` table keyed by (user_id, workspace_id, 'home'). The whole
   * `{version, pages}` composition is one atomic JSONB blob; `updatedAt` is
   * client-set so the local cache and cloud reconcile last-write-wins. Returns
   * null when signed out or when no row exists yet (fresh user → curated default).
   */
  dashboard: {
    get(workspaceId: string): Promise<StoredDashboardLayout | null>;
    save(input: { workspaceId: string; layout: DashboardLayout; updatedAt: string }): Promise<void>;
  };

  /**
   * Habits (DB-7) — preference-class, user-scoped CRUD (no intent ops). `list`
   * degrades to [] pre-migration (the table is deploy-gated); writes throw so the
   * widget's optimistic update can roll back.
   */
  habits: {
    list(workspaceId: string): Promise<HabitRow[]>;
    upsert(input: {
      id?: string;
      workspaceId: string;
      name: string;
      emoji: string;
      position: string;
    }): Promise<HabitRow>;
    setChecks(input: { id: string; checks: string[] }): Promise<void>;
    remove(id: string): Promise<void>;
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
    /** Gmail "Sign in with Google" (EM-2, desktop-only): runs the PKCE flow,
     *  stores tokens in the OS keychain, registers the account. */
    startGoogleOAuth(input: { workspaceId?: string | null }): Promise<any>;
    /** All messages of a thread (EM-4), oldest→newest, across folders. */
    getThread(input: { accountId: string; threadId: string }): Promise<any>;
    /** LIST the account's server folders, delimiter-aware (EM-5). */
    listFolders(input: { accountId: string }): Promise<any[]>;
    /** Archive / move / delete a message via the op outbox (EM-5). Optimistic —
     *  the row leaves the current folder locally, the IMAP step queues + retries. */
    applyMessageOp(input: {
      accountId: string;
      folder: string;
      uid: number;
      op: "archive" | "move" | "delete";
      destFolder?: string | null;
    }): Promise<any>;
    /** Snooze a thread — move its inbox messages to Moduo/Snoozed (create-if-
     *  missing, delimiter-aware). `local_hide` = the server refused the folder;
     *  the caller keeps the thread hidden locally instead (EM-6). */
    snoozeThread(input: {
      accountId: string;
      threadId: string;
      uids: number[];
    }): Promise<{ strategy: "server_move" | "local_hide"; mailbox: string | null }>;
    /** Restore a snoozed thread — move its messages from Moduo/Snoozed back to the
     *  inbox. Idempotent (0 when nothing matches / the folder is absent). */
    snoozeRestore(input: {
      accountId: string;
      threadId: string;
    }): Promise<{ restored: number }>;
    /** Send a message (reply/forward/new) — HTML+plain multipart, cc/bcc, reply
     *  headers, attachments from disk paths; copy to Sent (Gmail skips). EM-7. */
    sendMessage(input: EmailSendInput): Promise<{ messageId: string; savedToSent: boolean }>;
    /** A received message's attachment metadata (no bytes; EM-7/AC4). */
    listAttachments(input: {
      accountId: string;
      folder: string;
      uid: number;
    }): Promise<EmailAttachmentMeta[]>;
    /** Decode one attachment + write it to disk via a native Save dialog. */
    saveAttachment(input: {
      accountId: string;
      folder: string;
      uid: number;
      attachmentId: string;
      defaultFilename: string;
    }): Promise<{ saved: boolean; path: string | null }>;
    /** Native multi-file open dialog → paths for composing. */
    pickAttachments(): Promise<EmailPickedAttachment[]>;
    /** Small inline `cid:` images (<2MB) for substituting into the reader HTML. */
    getInlineImages(input: {
      accountId: string;
      folder: string;
      uid: number;
    }): Promise<EmailInlineImage[]>;
    /** Local body-text search (EM-9): scan the 8KB body-text sidecar → matching
     *  envelopes. The instant sender/subject match is done client-side over the
     *  in-memory envelopes; this covers deep-body hits the preview misses. */
    searchBodies(input: {
      accountId?: string | null;
      folder?: string | null;
      query: string;
    }): Promise<any[]>;
    /** Per-account server escalation (EM-9): Gmail X-GM-RAW / IMAP SEARCH with an
     *  honest status. Hits are upserted so a result's body fetches normally. */
    searchServer(input: {
      accountId: string;
      query: string;
      limit?: number;
    }): Promise<{ status: "ok" | "timeout" | "unsupported" | "error"; message?: string | null; envelopes: any[] }>;

    // ── EM-3 cloud "tissue" surface (Supabase-first, both platforms) ────────
    // A thread reaches the cloud ONLY via a deliberate action (convert / link /
    // snooze / follow-up / tag); plain reading writes nothing (AC14 privacy).
    // Reads DEGRADE to empty pre-migration; writes = email_op_* RPCs.
    /** Owner's account registry + the workspace's tissue thread refs. */
    listModule(workspaceId: string): Promise<EmailModuleBundle>;
    /** Register/refresh the cloud row for a desktop-connected account (no secret). */
    upsertAccountRef(input: {
      workspaceId: string;
      provider: string;
      address: string;
      signatureHtml?: string | null;
      color?: string | null;
      status?: string | null;
      unreadCount?: number | null;
    }): Promise<EmailAccountRef>;
    removeAccountRef(input: { workspaceId: string; accountId: string }): Promise<void>;
    /** Pull a thread into the tissue (idempotent by thread key); registers the entity. */
    upsertRef(input: {
      workspaceId: string;
      threadKey: string;
      accountId?: string | null;
      messageKey?: string | null;
      fromAddr?: string | null;
      fromName?: string | null;
      subject?: string;
      snippet?: string;
      sentAt?: string | null;
    }): Promise<EmailThreadRef>;
    snooze(input: { workspaceId: string; refId: string; snoozeUntil: string }): Promise<EmailThreadRef>;
    unsnooze(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef>;
    /** A snooze became due: unsnooze the ref + write the owner-targeted due
     *  activity (→ one notification). Called by the restore scheduler (EM-6). */
    snoozeDue(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef>;
    followUp(input: { workspaceId: string; refId: string; followUpAt: string }): Promise<EmailThreadRef>;
    clearFollowUp(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef>;
    /** A follow-up deadline passed with no reply: one-shot due notification.
     *  Returns null when there's nothing to do (not awaiting / already notified). */
    followUpDue(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef | null>;
    /** Remove a tissue ref + its links + registry entry (convert-undo cleanup, EM-8). */
    removeRef(input: { workspaceId: string; refId: string }): Promise<void>;
    /** Link an email_thread to any entity through the spine keystone (idempotent). */
    linkThread(input: {
      workspaceId: string;
      threadId: string;
      targetType: string;
      targetId: string;
      relationKind?: string;
      origin?: string;
      threadLabel?: string | null;
      targetLabel?: string | null;
      targetIcon?: string | null;
    }): Promise<unknown>;
  };

  integrations: {
    getStatus(): Promise<IntegrationStatusItem[]>;
    connectZoom(): Promise<IntegrationStatusItem>;
    connectGoogleMeet(): Promise<IntegrationStatusItem>;
    disconnect(provider: string): Promise<void>;
  };

  calendar: {
    // ── Wave-2 module surface (workspace-scoped, Supabase-first) ──────────
    // (Bundle/patch shapes live below the ModuoRuntime type.)
    // Writes go through calendar_op_* RPCs (guard + write + entities upsert
    // + attributed activity in one txn); reads are indexed SELECTs.
    /** Events + accounts bundle. Reads DEGRADE to empty pre-migration. */
    listModule(workspaceId: string): Promise<CalendarModuleBundle>;
    createEvent(input: {
      workspaceId: string;
      title: string;
      startsAt: string;
      endsAt: string;
      allDay?: boolean;
      rrule?: string | null;
      description?: string;
    }): Promise<CalendarEventModel>;
    updateEvent(input: {
      workspaceId: string;
      eventId: string;
      patch: CalendarEventPatch;
    }): Promise<CalendarEventModel>;
    removeEvent(input: { workspaceId: string; eventId: string }): Promise<void>;
    /** Un-delete a soft-deleted native event (the delete toast's Undo, DF-5). */
    restoreEvent(input: { workspaceId: string; eventId: string }): Promise<CalendarEventModel>;
    upsertAccount(input: {
      workspaceId: string;
      provider: string;
      externalId: string;
      displayLabel: string;
      color?: string | null;
      status?: string | null;
      lastSyncAt?: string | null;
      /**
       * CAL-8: the CalDAV/ICS connection descriptor JSON. OMIT (undefined) to
       * keep the stored value — the RPC param is only sent when provided, so
       * OAuth callers keep working against a pre-CAL-8 database.
       */
      syncToken?: string | null;
    }): Promise<CalendarAccountModel>;
    removeAccount(input: { workspaceId: string; accountId: string }): Promise<void>;
    /** Batched idempotent mirror upsert (the desktop sync engine's write). */
    mirrorEvents(input: {
      workspaceId: string;
      accountId: string;
      events: CalendarMirrorEventInput[];
      deletedExternalIds?: string[];
    }): Promise<{ upserted: number; removed: number }>;

    /**
     * Desktop only (CAL-6b): fetch a connected account's RAW provider events
     * for a window via the Tauri OAuth engine. The frontend maps them
     * (mirror.ts) and pushes them through {@link mirrorEvents}. Web returns []
     * (the sync writer is the desktop app). `externalAccountId` is the provider
     * account id (the keychain key / the cloud account's `externalId`).
     */
    fetchExternalEvents(input: {
      provider: "google" | "microsoft" | "caldav" | "ics";
      externalAccountId: string;
      timeMin: string;
      timeMax: string;
      /** CAL-8: the account row's connection descriptor (caldav needs server+username; ignored by OAuth providers). */
      syncToken?: string | null;
    }): Promise<Record<string, unknown>[]>;
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
    /**
     * All live workspace tags + the tag links attached to one entity. A light
     * read for non-task surfaces (contact/company hubs) that shouldn't pull
     * the whole tasks bundle just to render a tag row (fix pack FX-2).
     */
    listEntityTags(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
    }): Promise<{ tags: Tag[]; links: TagLink[] }>;
    /**
     * All live workspace tags + every tag link for the given entity types —
     * the directory's tag-filter read (fix pack FX-3). One indexed query pair;
     * omit `entityTypes` for all links.
     */
    listTagLinks(input: {
      workspaceId: string;
      entityTypes?: string[];
    }): Promise<{ tags: Tag[]; links: TagLink[] }>;
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

    /**
     * Intent ops (docs/moduo-module-contract.md): named, invariant-keeping
     * mutations via `tasks_op_*` RPCs — server-side permission check,
     * invariants, write, and an attributed activity row in one transaction.
     * Each returns the updated row(s) for optimistic reconciliation.
     */
    opCommit(input: { workspaceId: string; taskId: string; forDate: string }): Promise<Task>;
    opUncommit(input: { workspaceId: string; taskId: string }): Promise<Task>;
    opSkipToday(input: { workspaceId: string; taskId: string }): Promise<Task>;
    opSetStatus(input: {
      workspaceId: string;
      taskId: string;
      status: TaskStatus;
      recurrence?: RecurrenceRule | null;
      position?: string;
    }): Promise<Task>;
    opReschedule(input: {
      workspaceId: string;
      taskId: string;
      scheduledAt: string;
      days?: number;
    }): Promise<Task>;
    opUnschedule(input: { workspaceId: string; taskId: string }): Promise<Task>;
    opSkipOccurrence(input: {
      workspaceId: string;
      taskId: string;
      scheduledAt: string;
      recurrence: RecurrenceRule;
      releaseCommit: boolean;
    }): Promise<Task>;
    opCatchUp(input: { workspaceId: string; items: TasksCatchUpItem[] }): Promise<Task[]>;
    /** Read the entity's quiet activity trail (newest first). */
    listActivity(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
      limit?: number;
      /** Scope to one module (e.g. "tasks"). Omit to read across all modules —
       * what a spine entity (contact/company) needs, since its activity is logged
       * under module='contacts', not 'tasks'. */
      module?: string;
    }): Promise<ActivityEntry[]>;
  };

  /**
   * Connective-tissue spine — the link substrate (specs/connective-tissue.md
   * block CT-1). Any entity links/attaches/relates to any other through one
   * typed `entity_links` table FK'd into the central `entities` registry.
   * Cloud-first: web hits Supabase directly; desktop delegates to the web
   * runtime (same code path). All mutations go through `links_op_*` /
   * `entities_op_*` RPCs (permission guard + write + attributed activity row in
   * one transaction); reads are direct SELECTs over the indexed tables.
   */
  spine: {
    /**
     * Every live link touching an entity (matched on either end). Block CT-2
     * builds the grouped hub roll-up on top of this single indexed read.
     */
    listLinks(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
    }): Promise<EntityLink[]>;
    /**
     * Create a typed link. Idempotent + direction-agnostic (a duplicate pair+kind
     * no-ops and returns the existing row); rejects self-links and unknown kinds.
     * Registers both endpoints in the registry in the same transaction. Optional
     * labels/icons seed the registry projection for the @mention/search picker.
     */
    createLink(input: {
      workspaceId: string;
      source: EntityRef;
      target: EntityRef;
      relationKind?: RelationKind;
      origin?: LinkOrigin;
      sourceLabel?: string;
      sourceIcon?: string | null;
      targetLabel?: string;
      targetIcon?: string | null;
    }): Promise<EntityLink>;
    /** Re-type an existing link (optimistic re-group in the hub). No-op if unchanged. */
    setLinkKind(input: {
      workspaceId: string;
      linkId: string;
      relationKind: RelationKind;
    }): Promise<EntityLink>;
    /** Soft-delete a link (Undo-friendly; idempotent). Returns the tombstoned row. */
    deleteLink(input: { workspaceId: string; linkId: string }): Promise<EntityLink | null>;
    /**
     * Search the central registry for the @mention / `/ref` / link picker.
     * Excludes tombstones; optionally scoped to a set of entity types.
     */
    searchEntities(input: {
      workspaceId: string;
      query?: string;
      types?: string[];
      limit?: number;
    }): Promise<EntityRecord[]>;
    /**
     * Batch-read registry records for a set of refs — the hub snippet/label
     * projection for one roll-up. Includes tombstones (so the hub can dim
     * deleted targets), unlike `searchEntities`.
     */
    getEntities(input: { workspaceId: string; refs: EntityRef[] }): Promise<EntityRecord[]>;
    /**
     * Tombstone a registry entry (the delete half of the registry contract) — a
     * module's own delete op calls this; exposed for testing + pre-adoption use.
     */
    tombstoneEntity(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
    }): Promise<void>;

    // ── Comments + notifications (block CT-5) ────────────────────────────────
    /**
     * Add a comment to any entity. `mentionedUserIds` (workspace members
     * @-mentioned in the body) become notifications for those members (AC9).
     * Goes through `comments_op_add` (guard + registry ensure + attributed
     * activity in one transaction).
     */
    addComment(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
      body: string;
      mentionedUserIds?: string[];
      entityLabel?: string;
      entityIcon?: string | null;
    }): Promise<SpineComment>;
    /** Read an entity's comment thread (oldest first, tombstones excluded) —
     * the Comments rail (NO-7 AC9). Direct member-read SELECT (RLS-guarded). */
    listComments(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
    }): Promise<SpineComment[]>;
    /**
     * The derived notification feed: `module_activity` rows targeting me,
     * overlaid with my read state, newest first (AC10). The NotificationCenter
     * groups these by target then verb.
     */
    listNotifications(input: { workspaceId: string; limit?: number }): Promise<NotificationItem[]>;
    /** Mark one notification (activity row) read. Idempotent. */
    markNotificationRead(input: { workspaceId: string; activityId: string }): Promise<void>;
    /** Mark every targeting-me notification in the workspace read. */
    markAllNotificationsRead(input: { workspaceId: string }): Promise<void>;
    /** Dismiss one notification — it leaves the active bell feed, stays in history (DF-21b). Idempotent. */
    dismissNotification(input: { workspaceId: string; activityId: string }): Promise<void>;
    /** Undo a dismiss — restores the row to the active feed in its prior read state. Idempotent. */
    undismissNotification(input: { workspaceId: string; activityId: string }): Promise<void>;

    // ── Deterministic auto-suggested links (block CT-6) ──────────────────────
    /**
     * Deterministic auto-suggested links for a focus entity (AC11). Computed
     * server-side from non-ML signals only (shared tags, matching email
     * domains, ±time-window co-activity), already excluding self /
     * already-linked / previously-declined pairs. Returns RAW per-signal rows;
     * `scoreSuggestions` ranks them. Requires edit access (the strip is a link
     * gesture); callers degrade gracefully on permission/RPC error.
     */
    suggestLinks(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
      limit?: number;
    }): Promise<RawLinkSuggestion[]>;
    /**
     * Record a "no" for a suggested pair so it is never re-offered (AC11).
     * Writes `link_suggestion_declines` (direction-agnostic, idempotent).
     * Accepting a suggestion is just `createLink({ origin: "suggest" })`.
     */
    declineSuggestion(input: {
      workspaceId: string;
      source: EntityRef;
      target: EntityRef;
    }): Promise<void>;

    /**
     * The workspace's most recent links, both endpoints resolved from the
     * registry — the "Recently linked" dashboard widget read (AC12). One indexed
     * `entity_links` read + one batched registry lookup, shaped newest-first.
     */
    recentLinks(input: { workspaceId: string; limit?: number }): Promise<RecentLinkItem[]>;
  };

  /**
   * Contacts module (light CRM) — block CO-1. People + companies are hub
   * entities whose pages roll up from the spine. Cloud-first: web hits Supabase
   * directly; desktop delegates to the web runtime (same code path). All
   * invariant-bearing writes go through `contacts_op_*` / `companies_op_*` RPCs
   * (permission guard + write + `entities` registry upsert + attributed activity
   * in one transaction); reads are direct SELECTs over the indexed tables.
   */
  contacts: {
    /** People + companies for the directory (CO-2 builds the UI on this). */
    list(workspaceId: string): Promise<ContactsModuleBundle>;
    createContact(input: {
      workspaceId: string;
      name: string;
      email?: string | null;
      phone?: string | null;
      title?: string | null;
      companyId?: string | null;
      status?: string;
      notesInline?: string;
    }): Promise<Contact>;
    updateContact(input: {
      workspaceId: string;
      contactId: string;
      name?: string;
      email?: string | null;
      phone?: string | null;
      title?: string | null;
      notesInline?: string;
      /** Pass to set/clear the denormalized company FK (canonical edge is the link). */
      setCompany?: { companyId: string | null };
    }): Promise<Contact>;
    /** Optimistic, flat status change (AC3). Accepts any renamed/custom label. */
    setStatus(input: { workspaceId: string; contactId: string; status: string }): Promise<Contact>;
    createCompany(input: {
      workspaceId: string;
      name: string;
      domains?: string[];
      website?: string | null;
      notesInline?: string;
    }): Promise<Company>;
    updateCompany(input: {
      workspaceId: string;
      companyId: string;
      name?: string;
      domains?: string[];
      website?: string | null;
      notesInline?: string;
    }): Promise<Company>;
    /**
     * Link a contact/company to any other entity via the spine, attributed to
     * Contacts (`contacts_op_link`). Idempotent + direction-agnostic.
     */
    link(input: {
      workspaceId: string;
      contact: EntityRef;
      target: EntityRef;
      relationKind?: RelationKind;
      origin?: LinkOrigin;
      contactLabel?: string;
      targetLabel?: string;
      targetIcon?: string | null;
    }): Promise<EntityLink>;
    /** Soft-delete a link the contact owns (Undo-friendly; idempotent). */
    unlink(input: { workspaceId: string; linkId: string }): Promise<EntityLink | null>;
    /** Soft-delete a contact: drops its links + tombstones the registry entry. */
    deleteContact(input: { workspaceId: string; contactId: string }): Promise<Contact>;
    /**
     * Un-delete a soft-deleted contact (the delete toast's Undo, DF-5):
     * revives exactly the links the delete dropped + un-tombstones the
     * registry entry.
     */
    restoreContact(input: { workspaceId: string; contactId: string }): Promise<Contact>;
    /**
     * Soft-delete a company (FX-7): clears members' denormalized company_id,
     * drops every link touching it (works-at included), tombstones the registry
     * entry. Member contacts survive — only their company chip clears.
     */
    deleteCompany(input: { workspaceId: string; companyId: string }): Promise<Company>;
    /**
     * Bulk CSV import (AC6) — one attributed, activity-logged op. The client
     * parses + previews dedupe; this writes the confirmed plan (create / merge
     * rows) in a single transaction and returns the counts + affected ids.
     */
    importContacts(input: {
      workspaceId: string;
      rows: ContactImportRow[];
    }): Promise<ContactImportResult>;
    /**
     * Contacts that need attention (AC11) — overdue follow-ups, no-touch active
     * contacts (>14d), stale leads (>30d). The "Needs attention" dashboard widget
     * read; an indexed contacts + follow-up-links + tasks read, shaped by the pure
     * selector. Degrades to fewer signals before the contacts migration deploys.
     */
    needsAttention(input: { workspaceId: string }): Promise<NeedsAttentionItem[]>;
    /** Contacts you've gone quiet on (oldest last-touch first) — the Reconnect widget. */
    reconnect(input: { workspaceId: string }): Promise<ReconnectItem[]>;
    /**
     * Apply a partial detail patch to a contact (the inline-edit card's save) —
     * any of name/title/notesInline/status/isFavorite/companyId + the labelled
     * lists (emails/phones/addresses/urls/dates) + custom. Derives the scalar
     * email/phone from each list's primary. (v2.)
     */
    setContactDetails(input: { workspaceId: string; contactId: string; patch: ContactDetailsPatch }): Promise<Contact>;
    /** Toggle the per-workspace favorite flag. */
    setFavorite(input: { workspaceId: string; contactId: string; value: boolean }): Promise<Contact>;
    /** Apply a partial detail patch to a company (name/website/domains/notes/custom). */
    setCompanyDetails(input: { workspaceId: string; companyId: string; patch: CompanyDetailsPatch }): Promise<Company>;
    /** Create/upsert a workspace custom-field definition (the "add field" picker). */
    addFieldDef(input: {
      workspaceId: string;
      key: string;
      label?: string;
      type?: ContactFieldType;
      options?: string[];
      position?: number;
    }): Promise<ContactFieldDef>;
    /** Remove a custom-field definition (values remain in the blobs, just unsurfaced). */
    deleteFieldDef(input: { workspaceId: string; fieldId: string }): Promise<void>;
  };
};

// ── Email compose + attachments (EM-7, desktop engine) ───────────────────────
/** A received message's attachment metadata (bytes fetched on demand, EM-7). */
export type EmailAttachmentMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
};

/** A file picked for composing (send reads bytes from the path at send time). */
export type EmailPickedAttachment = {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
};

/** A small inline cid image, for substituting `cid:` refs in the reader HTML. */
export type EmailInlineImage = {
  contentId: string;
  mime: string;
  dataBase64: string;
};

/** The full send request (maps to the Rust `email_send_message`). */
export type EmailSendInput = {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string;
  htmlBody: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: { filename: string; mimeType: string; path: string }[];
  messageId?: string | null;
  fromName?: string | null;
};

// ── Email module (EM-3 cloud tissue) ─────────────────────────────────────────
/** An account's cloud registry row (address/status/signature/hue) — NO secrets. */
export type EmailAccountRef = {
  id: string;
  workspaceId: string;
  ownerId: string;
  provider: string;
  address: string;
  status: string;
  signatureHtml: string;
  unreadCount: number;
  color: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A tissue thread ref (entity_type 'email_thread') — a deliberately-linked email. */
export type EmailThreadRef = {
  id: string;
  workspaceId: string;
  ownerId: string;
  accountId: string | null;
  threadKey: string;
  messageKey: string | null;
  fromAddr: string | null;
  fromName: string | null;
  subject: string;
  snippet: string;
  sentAt: string | null;
  isSnoozed: boolean;
  snoozeUntil: string | null;
  followUpAt: string | null;
  followUpClearedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmailModuleBundle = {
  accounts: EmailAccountRef[];
  refs: EmailThreadRef[];
  /** True when the migration isn't applied yet (surfaces degrade, never crash). */
  degraded: boolean;
};

/** Partial patch for `setContactDetails` — camelCase keys mirror the SQL op. */
export type ContactDetailsPatch = Partial<{
  name: string;
  title: string | null;
  notesInline: string;
  status: string;
  isFavorite: boolean;
  companyId: string | null;
  emails: ContactChannel[];
  phones: ContactChannel[];
  addresses: ContactChannel[];
  urls: ContactChannel[];
  dates: ContactDateEntry[];
  custom: Record<string, ContactCustomValue>;
}>;

/** Partial patch for `setCompanyDetails`. */
export type CompanyDetailsPatch = Partial<{
  name: string;
  website: string | null;
  domains: string[];
  notesInline: string;
  custom: Record<string, ContactCustomValue>;
}>;
