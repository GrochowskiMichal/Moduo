import {
  isMemberDbRole,
  isSystemRoleKey,
  isWorkspaceRole,
  type MemberDbPermission,
  type MemberDbRole,
  PERMISSION_KEYS,
  PERMISSION_MODULES,
  type PermissionKey,
} from "@contracts/vocabularies";
import { sanitizeOverrides, sanitizePermissions, type WorkspaceRoleDef } from "./access";
import type {
  ModulePermission,
  ModulePermissions,
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
export function normalizeMemberRole(role: unknown): WorkspaceRole {
  if (role === "member") return "editor";
  if (isWorkspaceRole(role)) return role;
  return "viewer";
}

/** DB perm {read,write,none} (+ legacy admin) → app ModulePermission. DF-24. */
function memberPermToModulePermission(perm: unknown): ModulePermission {
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
export function toMemberRole(role: string | null | undefined): MemberDbRole {
  if (role === "editor") return "member";
  if (isMemberDbRole(role)) return role;
  return "member";
}
export function toMemberPerm(perm: string | null | undefined): MemberDbPermission {
  if (perm === "view" || perm === "read") return "read";
  if (perm === "none") return "none";
  return "write"; // write / edit / admin / anything else → write
}

/**
 * Effective keys → the legacy none/view/edit/admin lane per module (what the
 * module pages already gate on). Owners are `admin` everywhere.
 */
export function modulePermissionsFromPerms(
  perms: readonly string[],
  isOwner: boolean,
): ModulePermissions {
  const lane = (module: string): ModulePermission => {
    if (isOwner) return "admin";
    if (["create", "edit", "delete"].some((a) => perms.includes(`${module}.${a}`))) return "edit";
    if (perms.includes(`${module}.view`)) return "view";
    return "none";
  };
  const out = {} as ModulePermissions;
  for (const module of PERMISSION_MODULES) out[module] = lane(module);
  return out;
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
  // PERM-1: the member row carries the resolved `perms`. A bare row with no
  // membership (create() for its owner) is the owner's; a member row from a
  // database without PERM-1 (no `perms`) falls back to the legacy lanes.
  // A row from list() always carries the roster; only a bare create() row
  // (no `workspace_members` at all) is the creating owner's.
  const ownerLike = isOwner || (!mine && !Array.isArray(row.workspace_members));
  const hasPerms = Array.isArray(mine?.perms);
  const perms: PermissionKey[] = ownerLike
    ? [...PERMISSION_KEYS]
    : !mine
      ? []
      : hasPerms
        ? sanitizePermissions(mine.perms)
        : legacyPerms(mine);
  return {
    id: row.id,
    name: row.name,
    icon: typeof row.icon === "string" && row.icon.trim() ? row.icon : null,
    logoUrl: row.logo_url ?? row.logoUrl ?? null,
    role: isOwner ? "owner" : normalizeMemberRole(mine?.role ?? row.role ?? "owner"),
    permissions: modulePermissionsFromPerms(perms, ownerLike),
    perms,
    roleId: mine?.role_id ?? null,
    isDeleted: !!row.isDeleted || !!row.is_deleted,
    createdAt: row.createdAt ?? row.created_at ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
  };
}

/** Pre-PERM-1 member row → keys (notes lane; tasks lane covered calendar/contacts). */
function legacyPerms(mine: any): PermissionKey[] {
  const notes = memberPermToModulePermission(mine?.permissions_notes);
  const tasks = memberPermToModulePermission(mine?.permissions_tasks);
  const viewer = normalizeMemberRole(mine?.role) === "viewer";
  const keys: string[] = [];
  const lane = (module: string, level: ModulePermission) => {
    if (level === "none") return;
    keys.push(`${module}.view`);
    if (!viewer && (level === "edit" || level === "admin")) {
      keys.push(`${module}.create`, `${module}.edit`, `${module}.delete`);
    }
  };
  lane("notes", notes);
  for (const module of ["tasks", "calendar", "contacts"]) lane(module, tasks);
  lane("chat", viewer ? "view" : "edit");
  return sanitizePermissions(keys);
}

export function mapRole(row: any): WorkspaceRoleDef {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? row.workspaceId,
    systemKey: isSystemRoleKey(row.system_key) ? row.system_key : null,
    name: row.name ?? "",
    description: row.description ?? "",
    permissions: sanitizePermissions(row.permissions),
    readOnly: !!row.read_only,
    position: typeof row.position === "number" ? row.position : 100,
    updatedAt: row.updated_at ?? row.updatedAt ?? "",
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
    roleId: row.role_id ?? row.roleId ?? null,
    overrides: sanitizeOverrides(row.overrides),
    perms: sanitizePermissions(row.perms),
    joinedAt: row.joined_at ?? row.joinedAt ?? null,
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
    role: normalizeMemberRole(row.role ?? "viewer"),
    roleId: row.role_id ?? row.roleId ?? null,
    status: (row.status ?? "pending") as WorkspaceInvite["status"],
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
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
