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
  keyPrefix: string;
  scopes: Record<string, string>;
  /** The person the key acts as. Null for keys from before creators were recorded (they can't connect). */
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** When the key stops working; null = never. An expired key stays listed until revoked. */
  expiresAt: string | null;
  /** Chat (CV-21): the key also reads the private channels its creator is in. Off by default. */
  includePrivateChat: boolean;
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
  /** The Moduo MCP connector URL agents connect to (same on web + desktop). */
  getMcpEndpoint(): string;
};
