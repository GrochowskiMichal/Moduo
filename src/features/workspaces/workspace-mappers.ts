import type {
  ModulePermission,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceNotification,
  WorkspaceRole,
  WorkspaceSummary,
} from "./types";

export function storageKey(userId: string): string {
  return `moduo:selected-workspace:${userId}`;
}

/**
 * DB `workspace_members.role` uses {owner,admin,member,viewer}; the app uses
 * {owner,admin,editor,viewer}. Map `member` → `editor` on the way in (the write
 * side maps `editor` → `member` in runtime.web `toMemberRole`). Missing/unknown
 * → least privilege. DF-24.
 */
export function normalizeMemberRole(role: any): WorkspaceRole {
  if (role === "member") return "editor";
  if (role === "owner" || role === "admin" || role === "editor" || role === "viewer") return role;
  return "viewer";
}

/** DB perm {read,write,none} (+ legacy admin) → app ModulePermission. DF-24. */
function memberPermToModulePermission(perm: any): ModulePermission {
  if (perm === "read" || perm === "view") return "view";
  if (perm === "none") return "none";
  if (perm === "admin") return "admin";
  return "edit"; // write / edit / anything else
}

/**
 * WRITE-side bridges (used by runtime.web when inserting/updating
 * `workspace_members`). The members table CHECK constraints only accept
 * role ∈ {owner,admin,member,viewer} and perm ∈ {read,write,none}; the app hands
 * us `editor` / view-edit-admin, so map before writing or the insert 400s. DF-24.
 */
export function toMemberRole(role: string | null | undefined): string {
  if (role === "editor") return "member";
  if (role === "owner" || role === "admin" || role === "viewer" || role === "member") return role;
  return "member";
}
export function toMemberPerm(perm: string | null | undefined): string {
  if (perm === "view" || perm === "read") return "read";
  if (perm === "none") return "none";
  return "write"; // write / edit / admin / anything else → write
}

export function mapWorkspace(row: any, currentUserId?: string): WorkspaceSummary {
  // The current user's role/permissions come from THEIR row in the nested
  // `workspace_members(*)` join — there is no `role` column on `workspaces`, so
  // the old `row.role ?? "owner"` made every workspace read as owner/edit, which
  // would show a joined member owner-only controls. Fall back to owner/edit only
  // when the membership isn't in the row (e.g. create() returns a bare row for
  // its owner-creator). DF-24.
  const members = Array.isArray(row.workspace_members) ? row.workspace_members : [];
  const mine = currentUserId
    ? members.find((m: any) => (m.user_id ?? m.userId) === currentUserId)
    : null;
  // The authoritative owner is `workspaces.owner_id` — trust it over the
  // membership role string so an owner never loses their own controls if their
  // member row's role ever drifts from "owner" (validator hardening, DF-24).
  const isOwner = !!currentUserId && (row.owner_id ?? row.ownerId) === currentUserId;
  return {
    id: row.id,
    name: row.name,
    role: isOwner ? "owner" : normalizeMemberRole(mine?.role ?? row.role ?? "owner"),
    permissions: {
      notes: mine
        ? memberPermToModulePermission(mine.permissions_notes)
        : ((row.permissions?.notes ?? "edit") as ModulePermission),
      tasks: mine
        ? memberPermToModulePermission(mine.permissions_tasks)
        : ((row.permissions?.tasks ?? "edit") as ModulePermission),
    },
    isDeleted: !!row.isDeleted || !!row.is_deleted,
    createdAt: row.createdAt ?? row.created_at ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
  };
}

export function mapMember(row: any): WorkspaceMember {
  // `listMembers` selects `*, profiles(*)`, so the joined profile rides along —
  // surface the display name/avatar rather than throwing them away (members
  // used to render as truncated UUIDs). DF-24.
  const profile = row.profiles ?? row.profile ?? null;
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    userId: row.userId ?? row.user_id,
    // DB `member` → app `editor` so the modal's ROLE_META lookup never misses. DF-24.
    role: normalizeMemberRole(row.role),
    isActive: row.isActive ?? row.is_active ?? true,
    removedAt: row.removedAt ?? row.removed_at ?? null,
    displayName: profile?.display_name ?? profile?.displayName ?? null,
    avatarUrl: profile?.avatar_url ?? profile?.avatarUrl ?? null,
  };
}

export function mapInvite(row: any): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    email: row.email,
    role: (row.role ?? "viewer") as WorkspaceInvite["role"],
    status: (row.status ?? "pending") as WorkspaceInvite["status"],
    token: row.token ?? undefined,
    createdAt: row.createdAt ?? row.created_at ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
  };
}

export function mapNotification(row: any): WorkspaceNotification {
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id ?? null,
    eventType: row.eventType ?? row.event_type ?? "notification",
    actorUserId: row.actorUserId ?? row.actor_user_id ?? null,
    sourceModule: row.sourceModule ?? row.source_module ?? null,
    sourceResourceType: row.sourceResourceType ?? row.source_resource_type ?? null,
    sourceResourceId: row.sourceResourceId ?? row.source_resource_id ?? null,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt ?? row.created_at ?? new Date().toISOString(),
    readAt: row.readAt ?? row.read_at ?? null,
  };
}
