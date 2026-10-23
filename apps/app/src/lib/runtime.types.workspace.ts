/** The runtime port's workspace (implemented in runtime.web.workspace.ts). */

/**
 * A workspace-scoped API key for the Moduo MCP connector
 * (docs/moduo-mcp-connector.md). The secret is returned exactly once from
 * `createApiKey` and never readable again — only the prefix is stored in
 * clear. `scopes` maps module → "none" | "view" | "edit" (admin is never
 * key-grantable). The key acts as `createdBy` and never gets more than that
 * person can do (PERM-0).
 */
export type WorkspaceApiKey = {
  id: string;
  workspaceId: string;
  name: string;
  /** The secret's visible start; null for a connected app (MCPO-4), which has no secret. */
  keyPrefix: string | null;
  scopes: Record<string, string>;
  /** The person the key acts as. Null for keys from before creators were recorded (they can't connect). */
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** When the key stops working; null = never. An expired key stays listed until revoked. */
  expiresAt: string | null;
  /** Chat (CV-21): the key also reads the private channels its creator is in. Off by default. */
  includePrivateChat: boolean;
  /** MCPO-3: a connected app (signed in with OAuth) instead of a pasted key; null for a key. */
  oauthClientId: string | null;
  /** The host the app's sign-in returns to ("claude.ai"); null for a key. */
  oauthClientDomain: string | null;
};

/**
 * What the consent screen (/oauth/consent, MCPO-4) knows about an app's
 * sign-in. `heldRedirect` is set when Supabase Auth approved the sign-in by
 * itself (the person approved this app before): the code is already in it,
 * so the page follows it only after the person's own Approve.
 */
export type OAuthConsentRequest = {
  authorizationId: string;
  clientId: string;
  /** The app's registered name; null when it gave none. */
  appName: string | null;
  /** The host the sign-in returns to; null when unreadable. */
  clientDomain: string | null;
  /** The person's live connection to this app (a reconnect), in whichever workspace. */
  connection: {
    id: string;
    workspaceId: string;
    name: string;
    scopes: Record<string, string>;
    expiresAt: string | null;
    includePrivateChat: boolean;
  } | null;
  /** Workspaces the person manages keys in that are at the 20 cap. */
  fullWorkspaceIds: string[];
  heldRedirect: string | null;
};

export type WorkspaceRuntime = {
  getProfile(userId: string): Promise<{
    data: { plan_tier?: string; display_name?: string; avatar_url?: string | null } | null;
    error: any;
  }>;
  list(): Promise<any[]>;
  create(name: string): Promise<any>;
  rename(workspaceId: string, name: string): Promise<any>;
  /** Owner-only. `icon` and `logoUrl` are alternatives — one of them is null. */
  updateBranding(
    workspaceId: string,
    branding: { icon: string | null; logoUrl: string | null },
  ): Promise<any>;
  /**
   * Owner-only (TV-D8): change the workspace's task key (2–5 letters, A–Z),
   * the prefix of every handle (`MOD-142`). The old key stays an alias.
   */
  setTaskKey(
    workspaceId: string,
    key: string,
  ): Promise<{ taskKey: string; taskKeyAliases: string[] }>;
  leave(workspaceId: string): Promise<void>;
  softDelete(workspaceId: string): Promise<void>;
  issueInvite(
    workspaceId: string,
    email: string,
    role: string,
    modulePermissions?: { notes?: string; tasks?: string },
    /** PERM-1: the workspace role to join with (wins over `role`). */
    roleId?: string | null,
    sharePayload?: {
      existing?: string;
      resources?: { type: string; id: string; level: string }[];
    },
  ): Promise<any>;
  joinInvite(token: string): Promise<any>;
  listMembers(workspaceId: string): Promise<any[]>;
  listInvites(workspaceId: string): Promise<any[]>;
  updateInvite(
    inviteId: string,
    role: string,
    modulePermissions?: { notes?: string; tasks?: string },
    roleId?: string | null,
  ): Promise<void>;
  revokeInvite(inviteId: string): Promise<void>;
  updateMemberPermissions(
    memberId: string,
    role: string,
    modulePermissions?: { notes?: string; tasks?: string },
  ): Promise<void>;
  /**
   * Remove another member from the workspace (owner/admin only, never an
   * owner or yourself — use `leave` for self-exit). Routes through the
   * `workspace_op_remove_member` SECURITY DEFINER RPC because the base
   * `workspace_members` write-RLS is own-row. DF-24.
   */
  removeMember(memberId: string): Promise<void>;
  /** PERM-1: the workspace's roles (system + custom), readable by members. */
  listRoles(workspaceId: string): Promise<any[]>;
  /** Create (`roleId` null) or update a role. Server enforces every rule. */
  upsertRole(input: {
    workspaceId: string;
    roleId: string | null;
    name: string;
    description: string;
    permissions: string[];
    readOnly: boolean;
    expectedUpdatedAt: string | null;
  }): Promise<any>;
  /** Delete a custom role, moving its people + pending invites to `reassignTo`. */
  deleteRole(roleId: string, reassignTo: string): Promise<void>;
  /** Set a member's role and personal exceptions in one step. */
  setMemberAccess(
    memberId: string,
    roleId: string,
    overrides: Record<string, boolean>,
  ): Promise<any>;
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
  /** Live (unrevoked) MCP connector keys. Needs ws.api_keys (RLS-enforced). */
  listApiKeys(workspaceId: string): Promise<WorkspaceApiKey[]>;
  /** Create a key; the returned `secret` is shown once and never again. */
  createApiKey(input: {
    workspaceId: string;
    name: string;
    scopes: Record<string, string>;
    /** Days until the key expires; omitted or null = never. */
    expiresInDays?: number | null;
  }): Promise<WorkspaceApiKey & { secret: string }>;
  /**
   * Change a live key's per-module scopes without rotating its secret;
   * resolves to the key's scopes after the change. Merges: modules missing
   * from `scopes` keep their level. Only the key's creator can raise a level.
   */
  setApiKeyScopes(keyId: string, scopes: Record<string, string>): Promise<Record<string, string>>;
  /**
   * Chat (CV-21): "Include private channels I'm in". Only the key's creator
   * turns it on; any key manager turns it off. Resolves to the new value.
   */
  setApiKeyPrivateChat(keyId: string, on: boolean): Promise<boolean>;
  /** Chat (CV-21): your own live keys that read chat here (Settings' reply switches). */
  listMyChatKeys(workspaceId: string): Promise<Array<{ id: string; name: string }>>;
  revokeApiKey(keyId: string): Promise<void>;
  /** Rename a key or connection (its trail name). Only the person it acts as. Resolves to the stored name. */
  renameApiKey(keyId: string, name: string): Promise<string>;
  /**
   * Disconnect a connected app: revokes its row (the connector refuses it at
   * once) and, when it is the caller's own, withdraws their grant so the app
   * can't refresh silently. The grant step is best effort.
   */
  disconnectApp(key: Pick<WorkspaceApiKey, "id" | "oauthClientId" | "createdBy">): Promise<void>;
  /**
   * Read an app's sign-in for the consent screen (this binds it to the
   * signed-in person). Null when it is unknown, used up or expired.
   */
  readOAuthRequest(authorizationId: string): Promise<OAuthConsentRequest | null>;
  /** The consent screen's Approve, before Supabase's: creates, updates or moves the connection. */
  connectOAuthApp(input: {
    authorizationId: string;
    workspaceId: string;
    scopes: Record<string, string>;
    expiresInDays: number | null;
    includePrivateChat: boolean;
  }): Promise<{ id: string; created: boolean; movedFrom: string | null }>;
  /** Supabase's approve; resolves to the URL that returns to the app with its code. */
  approveOAuthRequest(authorizationId: string): Promise<string>;
  /** Supabase's deny; resolves to the URL that tells the app no. */
  denyOAuthRequest(authorizationId: string): Promise<string>;
  /** The Moduo MCP connector URL agents connect to (same on web + desktop). */
  getMcpEndpoint(): string;
};
