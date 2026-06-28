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
import type { NeedsAttentionItem } from "../features/contacts/needs-attention";
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

  /**
   * Cross-device user settings (appearance + focus). Cloud-first: web hits
   * Supabase directly; desktop delegates to the web runtime. Both return null
   * when signed out. `set` upserts only the domains present in the patch.
   */
  preferences: {
    get(): Promise<UserPreferences | null>;
    set(patch: Partial<UserPreferences>): Promise<UserPreferences | null>;
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
