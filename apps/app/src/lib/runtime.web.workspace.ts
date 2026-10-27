/** The web runtime's workspace (Supabase). */

import {
  InviteEmailMismatchError,
  isInviteEmailMismatch,
} from "../features/workspaces/invite-join";
import { toMemberPerm, toMemberRole } from "../features/workspaces/workspace-mappers";
import { mcpEndpointFor } from "./mcp-endpoint";
import { publicConfig } from "./public-config";
import { DbError, runQuery, runRpc, type TableInsert } from "./runtime.db";
import type { WorkspaceRuntime } from "./runtime.types";
import { bootReads, SUPABASE_URL, supabaseClient } from "./runtime.web.client";
import { getAuthedUser } from "./runtime.web.shared";

/** The profile's plan_tier can change (upgrade), but only via a user action long
 *  after boot; a short window collapses the launch double-read without pinning
 *  stale data (`refreshPlanTier` and friends run well past this). */
const PROFILE_TTL_MS = 5_000;

export const webWorkspace: WorkspaceRuntime = {
  async getProfile(userId: string) {
    // Deduped across the boot double-read (bootstrap + INITIAL_SESSION) via a
    // short TTL. Only a successful row is cached — an error throws through so
    // it's retried, and the caller still gets the `{ data, error }` shape.
    try {
      const row = await bootReads.read(
        `profile:${userId}`,
        async () => {
          const data = await runQuery(
            supabaseClient
              .from("profiles")
              .select("plan_tier, display_name, avatar_url")
              .eq("id", userId)
              .single(),
          );
          return data ?? null;
        },
        PROFILE_TTL_MS,
      );
      return { data: row, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
  async list() {
    const data = await runQuery(
      supabaseClient.from("workspaces").select("*, workspace_members(*)").is("deleted_at", null),
    );
    return data ?? [];
  },
  async create(name) {
    const user = await getAuthedUser();
    if (!user) throw new Error("Not authenticated");
    const data = await runQuery(
      supabaseClient
        .from("workspaces")
        // task_key is filled by the workspaces_task_key_insert trigger.
        .insert({ name, owner_id: user.id } as TableInsert<"workspaces">)
        .select()
        .single(),
    );
    return data;
  },
  async rename(workspaceId, name) {
    const data = await runQuery(
      supabaseClient.from("workspaces").update({ name }).eq("id", workspaceId).select().single(),
    );
    return data;
  },
  async updateBranding(workspaceId, branding) {
    const data = await runQuery(
      supabaseClient
        .from("workspaces")
        .update({ icon: branding.icon, logo_url: branding.logoUrl })
        .eq("id", workspaceId)
        .select()
        .single(),
    );
    return data;
  },
  async setTaskKey(workspaceId, key) {
    const data = await runRpc(
      supabaseClient.rpc("workspace_op_set_task_key", {
        p_workspace_id: workspaceId,
        p_key: key,
      }),
    );
    const row = (data ?? {}) as { task_key?: string; task_key_aliases?: string[] };
    return { taskKey: row.task_key ?? key, taskKeyAliases: row.task_key_aliases ?? [] };
  },
  async leave(workspaceId) {
    const user = await getAuthedUser();
    if (!user) throw new Error("Not authenticated");
    await runQuery(
      supabaseClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id),
    );
  },
  async softDelete(workspaceId) {
    // `workspaces` UPDATE RLS is owner-only, and with no `.select()` a refused
    // update is 0 rows and no error: gate the UI on the owner (as rename's is).
    await runQuery(
      supabaseClient
        .from("workspaces")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", workspaceId),
    );
  },
  async issueInvite(workspaceId, email, role, modulePermissions, roleId, sharePayload) {
    const user = await getAuthedUser();
    const data = await runQuery(
      supabaseClient
        .from("workspace_invites")
        .insert({
          workspace_id: workspaceId,
          created_by: user?.id,
          email,
          role,
          // PERM-1: the role id wins; the DB trigger rewrites `role` to its tier.
          ...(roleId ? { role_id: roleId } : {}),
          permissions_notes: modulePermissions?.notes ?? "write",
          permissions_tasks: modulePermissions?.tasks ?? "write",
          ...(sharePayload ? { share_payload: sharePayload } : {}),
        })
        .select()
        .single(),
    );
    return data;
  },
  async joinInvite(token) {
    // The invite row is invisible to the recipient (SELECT is owner/admin
    // only). Redemption goes through a definer function that checks the token.
    const { data, error } = await supabaseClient.rpc("workspace_op_accept_invite", {
      p_token: token.trim(),
    });
    if (error) {
      const message = error.message ?? "";
      // Signed in with another address than the invite's (TX-7, S1).
      if (isInviteEmailMismatch(message)) throw new InviteEmailMismatchError(error.hint);
      if (/already a member/i.test(message)) {
        throw new Error("You're already a member of this workspace.");
      }
      if (/invalid or expired|not authenticated/i.test(message)) {
        throw new Error("Invalid or expired invite");
      }
      throw new Error(message);
    }
    return data;
  },
  async listMembers(workspaceId) {
    const data = await runQuery(
      supabaseClient
        .from("workspace_members")
        .select("*, profiles(*)")
        .eq("workspace_id", workspaceId),
    );
    return data ?? [];
  },
  async listInvites(workspaceId) {
    const data = await runQuery(
      supabaseClient.from("workspace_invites").select("*").eq("workspace_id", workspaceId),
    );
    return data ?? [];
  },
  async updateInvite(inviteId, role, modulePermissions, roleId) {
    await runQuery(
      supabaseClient
        .from("workspace_invites")
        .update({
          role,
          ...(roleId ? { role_id: roleId } : {}),
          permissions_notes: modulePermissions?.notes ?? "write",
          permissions_tasks: modulePermissions?.tasks ?? "write",
        })
        .eq("id", inviteId),
    );
  },
  async revokeInvite(inviteId) {
    await runQuery(
      supabaseClient.from("workspace_invites").update({ status: "revoked" }).eq("id", inviteId),
    );
  },
  async updateMemberPermissions(memberId, role, modulePermissions) {
    // Managing ANOTHER member's row can't be a client-direct write (the base
    // workspace_members RLS is own-row) — route through the hierarchy-enforcing
    // op, which also blocks an admin from managing admins. Send the DB
    // vocabulary (editor→member, view/edit/admin→read/write).
    await runRpc(
      supabaseClient.rpc("workspace_op_set_member_role", {
        p_member_id: memberId,
        p_role: toMemberRole(role),
        p_perm_notes: toMemberPerm(modulePermissions?.notes),
        p_perm_tasks: toMemberPerm(modulePermissions?.tasks),
      }),
    );
  },
  async transferOwnership(memberId) {
    // Owner-only; promotes the target to owner and demotes the caller to admin
    // (SECURITY DEFINER, since it rewrites workspaces.owner_id). Needed by the
    // account-deletion flow — an owner hands off before deleting.
    await runRpc(
      supabaseClient.rpc("workspace_op_transfer_ownership", {
        p_member_id: memberId,
      }),
    );
  },
  async listRoles(workspaceId) {
    const data = await runQuery(
      supabaseClient
        .from("workspace_roles")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("position")
        .order("id"),
    );
    return data ?? [];
  },
  async upsertRole(input) {
    const data = await runRpc(
      supabaseClient.rpc("workspace_op_role_upsert", {
        p_workspace_id: input.workspaceId,
        p_role_id: input.roleId,
        p_name: input.name,
        p_description: input.description,
        p_permissions: input.permissions,
        p_read_only: input.readOnly,
        p_expected_updated_at: input.expectedUpdatedAt,
      }),
    );
    return Array.isArray(data) ? data[0] : data;
  },
  async deleteRole(roleId, reassignTo) {
    await runRpc(
      supabaseClient.rpc("workspace_op_role_delete", {
        p_role_id: roleId,
        p_reassign_to: reassignTo,
      }),
    );
  },
  async setMemberAccess(memberId, roleId, overrides) {
    const data = await runRpc(
      supabaseClient.rpc("workspace_op_set_member_access", {
        p_member_id: memberId,
        p_role_id: roleId,
        p_overrides: overrides,
      }),
    );
    return Array.isArray(data) ? data[0] : data;
  },
  async removeMember(memberId) {
    // The base workspace_members write-RLS is own-row (only `leave` self-deletes),
    // so ejecting another member needs a SECURITY DEFINER op that checks the
    // caller is owner/admin and refuses to remove an owner or yourself. DF-24.
    await runRpc(
      supabaseClient.rpc("workspace_op_remove_member", {
        p_member_id: memberId,
      }),
    );
  },
  inviteUrl(token) {
    // Mirror notesV2.publishedUrl: web origin is correct wherever served;
    // desktop (tauri://) needs PUBLIC_WEB_ORIGIN. encodeURIComponent is
    // load-bearing — invite tokens are base64 (`+` `/` `=`), which are
    // path/query-hostile raw. DF-24.
    const configured = publicConfig().webOrigin.replace(/\/+$/, "");
    const origin = configured || (typeof window !== "undefined" ? window.location.origin : "");
    return `${origin}/join?invite=${encodeURIComponent(token)}`;
  },
  async listNotifications() {
    const user = await getAuthedUser();
    if (!user) return [];
    const { data } = await supabaseClient
      .from("workspace_notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return data ?? [];
  },
  async markNotificationRead(notificationId) {
    await supabaseClient
      .from("workspace_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);
  },
  async markAllNotificationsRead() {
    const user = await getAuthedUser();
    if (!user) return;
    await supabaseClient
      .from("workspace_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  },

  // MCP connector keys (docs/moduo-mcp-connector.md). Explicit column list —
  // key_hash is never client-readable (column-level grant excludes it).
  async listApiKeys(workspaceId) {
    const columns =
      "id, workspace_id, name, key_prefix, scopes, created_by, created_at, last_used_at";
    const list = (select: string) =>
      supabaseClient
        .from("workspace_api_keys")
        .select(select)
        .eq("workspace_id", workspaceId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
    let { data, error } = await list(
      `${columns}, expires_at, include_private_chat, oauth_client_id, oauth_client_domain, oauth_client_scheme`,
    );
    // 42703 = a newer column isn't on this backend yet (expires_at:
    // 20261009210000; include_private_chat: CV-21's 20261017123000;
    // oauth_client_id/_domain: MCPO-3's 20261023120000; oauth_client_scheme:
    // 20261023200000): list the keys without them rather than lose the whole list.
    // 42501: the column is there but not yet readable by clients.
    if (error?.code === "42703" || error?.code === "42501")
      ({ data, error } = await list(
        `${columns}, expires_at, include_private_chat, oauth_client_id, oauth_client_domain`,
      ));
    if (error?.code === "42703" || error?.code === "42501")
      ({ data, error } = await list(`${columns}, expires_at, include_private_chat`));
    if (error?.code === "42703" || error?.code === "42501")
      ({ data, error } = await list(`${columns}, expires_at`));
    if (error?.code === "42703") ({ data, error } = await list(columns));
    if (error) throw new DbError(error);
    return ((data ?? []) as unknown as Array<Record<string, any>>).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      keyPrefix: row.key_prefix ?? null,
      scopes: (row.scopes ?? {}) as Record<string, string>,
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at ?? null,
      expiresAt: row.expires_at ?? null,
      includePrivateChat: row.include_private_chat === true,
      oauthClientId: row.oauth_client_id ?? null,
      oauthClientDomain: row.oauth_client_domain ?? null,
      oauthClientScheme: row.oauth_client_scheme ?? null,
    }));
  },
  async createApiKey({ workspaceId, name, scopes, expiresInDays }) {
    const data = await runRpc(
      supabaseClient.rpc("workspace_api_keys_create", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_scopes: scopes,
        ...(expiresInDays != null ? { p_expires_in_days: expiresInDays } : {}),
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Key creation returned nothing.");
    return {
      id: row.id,
      workspaceId,
      name: row.name,
      keyPrefix: row.key_prefix,
      scopes: (row.scopes ?? {}) as Record<string, string>,
      createdBy: (await getAuthedUser())?.id ?? null,
      createdAt: row.created_at,
      lastUsedAt: null,
      expiresAt: row.expires_at ?? null,
      includePrivateChat: false,
      oauthClientId: null,
      oauthClientDomain: null,
      oauthClientScheme: null,
      secret: row.secret,
    };
  },
  async listMyChatKeys(workspaceId) {
    const { data, error } = await supabaseClient.rpc("chat_my_keys", {
      p_workspace_id: workspaceId,
    });
    // Not on this server yet (CV-21's migration): no switches to show.
    if (error?.code === "PGRST202") return [];
    if (error) throw new DbError(error);
    return ((data ?? []) as Array<{ id?: unknown; name?: unknown }>)
      .filter((r) => typeof r.id === "string")
      .map((r) => ({ id: r.id as string, name: typeof r.name === "string" ? r.name : "A key" }));
  },
  async setApiKeyPrivateChat(keyId, on) {
    const { data, error } = await supabaseClient.rpc("workspace_api_keys_set_private_chat", {
      p_key_id: keyId,
      p_on: on,
    });
    if (error) {
      if (error.code === "PGRST202") {
        throw new Error("Private channels for keys aren't available on this server yet.");
      }
      throw new DbError(error);
    }
    return data === true;
  },
  async setApiKeyScopes(keyId, scopes) {
    const { data, error } = await supabaseClient.rpc("workspace_api_keys_set_scopes", {
      p_key_id: keyId,
      p_scopes: scopes,
    });
    if (error) {
      // PGRST202 = the RPC isn't on this backend yet. User-triggered, so say
      // so plainly rather than fail opaquely.
      if (error.code === "PGRST202") {
        throw new Error(
          "Changing a key's access isn't available on this server yet. Create a new key instead.",
        );
      }
      throw new DbError(error);
    }
    return (data ?? {}) as Record<string, string>;
  },
  async revokeApiKey(keyId) {
    await runRpc(supabaseClient.rpc("workspace_api_keys_revoke", { p_key_id: keyId }));
  },
  async renameApiKey(keyId, name) {
    const { data, error } = await supabaseClient.rpc("workspace_api_keys_rename", {
      p_key_id: keyId,
      p_name: name,
    });
    if (error) {
      if (error.code === "PGRST202") {
        throw new Error("Renaming isn't available on this server yet.");
      }
      throw new DbError(error);
    }
    return typeof data === "string" ? data : name.trim();
  },
  async disconnectApp(key) {
    await runRpc(supabaseClient.rpc("workspace_api_keys_revoke", { p_key_id: key.id }));
    // The row is what the connector checks, so the app is cut off already.
    // Withdrawing the person's own grant stops a silent refresh; another
    // person's grant isn't ours to withdraw, and a server without the OAuth
    // server answers an error we can ignore.
    if (!key.oauthClientId) return;
    const user = await getAuthedUser();
    if (!user || user.id !== key.createdBy) return;
    // Capped, so a slow Auth never keeps a disconnected row on screen.
    const grant = supabaseClient.auth.oauth
      .revokeGrant({ clientId: key.oauthClientId })
      .catch((err: unknown) => console.warn("[api-keys] revokeGrant", err));
    await Promise.race([grant, new Promise((resolve) => setTimeout(resolve, 4_000))]);
  },
  async readOAuthRequest(authorizationId) {
    // Read through Auth first: that ties the sign-in to the signed-in person,
    // and for an app they approved before it approves it on the spot and
    // answers only the redirect (with the code), which the page holds.
    // Approving without this read fails; a reconnect never sits `pending`, and
    // an authorization expires 3 minutes after the app starts it.
    const { data: details, error: authError } =
      await supabaseClient.auth.oauth.getAuthorizationDetails(authorizationId);
    if (authError) {
      if (authError.status === 401 || authError.status === 403) throw authError;
      return null;
    }
    const heldRedirect =
      details && "redirect_url" in details && typeof details.redirect_url === "string"
        ? details.redirect_url
        : null;
    const { data, error } = await supabaseClient.rpc("workspace_api_keys_oauth_request", {
      p_authorization_id: authorizationId,
    });
    if (error) {
      if (error.code === "P0002") return null;
      throw new DbError(error);
    }
    const row = (data ?? {}) as Record<string, any>;
    const conn = row.connection as Record<string, any> | null;
    return {
      authorizationId,
      clientId: String(row.client_id ?? ""),
      appName: typeof row.app_name === "string" ? row.app_name : null,
      clientDomain: typeof row.client_domain === "string" ? row.client_domain : null,
      clientScheme: typeof row.client_scheme === "string" ? row.client_scheme : null,
      redirectUri:
        details && "redirect_uri" in details && typeof details.redirect_uri === "string"
          ? details.redirect_uri
          : heldRedirect,
      connection: conn
        ? {
            id: conn.id,
            workspaceId: conn.workspace_id,
            name: conn.name,
            scopes: (conn.scopes ?? {}) as Record<string, string>,
            expiresAt: conn.expires_at ?? null,
            includePrivateChat: conn.include_private_chat === true,
          }
        : null,
      fullWorkspaceIds: Array.isArray(row.full_workspace_ids)
        ? row.full_workspace_ids.filter((id: unknown): id is string => typeof id === "string")
        : [],
      others: Array.isArray(row.others)
        ? row.others
            .filter((o: any) => o && typeof o.id === "string" && typeof o.workspace_id === "string")
            .map((o: any) => ({
              id: o.id,
              workspaceId: o.workspace_id,
              name: typeof o.name === "string" ? o.name : "",
              createdAt: String(o.created_at ?? ""),
              lastUsedAt: typeof o.last_used_at === "string" ? o.last_used_at : null,
              recentlyUsed: o.recently_used === true,
            }))
        : [],
      heldRedirect,
    };
  },
  async connectOAuthApp({
    authorizationId,
    workspaceId,
    scopes,
    expiresInDays,
    includePrivateChat,
    replaceIds,
  }) {
    const data = await runRpc(
      supabaseClient.rpc("workspace_api_keys_connect_oauth", {
        p_workspace_id: workspaceId,
        p_authorization_id: authorizationId,
        p_scopes: scopes,
        p_expires_in_days: expiresInDays,
        p_include_private_chat: includePrivateChat,
        // Sent only when there is something to replace, so approving keeps
        // working against a database without the argument yet.
        ...(replaceIds && replaceIds.length > 0 ? { p_replace_ids: replaceIds } : {}),
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Connecting returned nothing.");
    return {
      id: row.id,
      created: row.created === true,
      movedFrom: row.moved_from ?? null,
      replaced: Array.isArray(row.replaced) ? row.replaced : [],
    };
  },
  async approveOAuthRequest(authorizationId) {
    const { data, error } = await supabaseClient.auth.oauth.approveAuthorization(authorizationId, {
      skipBrowserRedirect: true,
    });
    if (error) throw error;
    return data.redirect_url;
  },
  async denyOAuthRequest(authorizationId) {
    const { data, error } = await supabaseClient.auth.oauth.denyAuthorization(authorizationId, {
      skipBrowserRedirect: true,
    });
    if (error) throw error;
    return data.redirect_url;
  },
  getMcpEndpoint() {
    return mcpEndpointFor(SUPABASE_URL);
  },
};
