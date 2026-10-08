import type { ModulePermission, WorkspaceRole } from "./types";

/**
 * Who can manage whom in a workspace (client-side gate for the UI; the
 * SECURITY DEFINER ops `workspace_op_set_member_role` / `_remove_member` enforce
 * the same rules server-side, so this is UX, not security).
 *
 * Hierarchy: owner > admin > editor > viewer.
 * - The **owner** manages everyone below them (including admins).
 * - An **admin** manages only members *below* admin (editor, viewer) — an admin
 *   can never remove, demote, or promote another admin, and can never grant the
 *   admin role. Only the owner manages admins.
 * - Editors/viewers manage no one.
 * - No one manages the owner or themselves through these controls (the owner
 *   hands off via transfer-ownership; anyone else exits via leave).
 */

/** Can `callerRole` change the role of / remove a member with `targetRole`? */
export function canManageMember(
  callerRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return false;
  if (targetRole === "owner") return false;
  if (callerRole === "owner") return true;
  if (callerRole === "admin") return targetRole !== "admin";
  return false;
}

/** The roles `callerRole` is allowed to assign to a member they manage. */
export function assignableRolesFor(callerRole: WorkspaceRole): WorkspaceRole[] {
  if (callerRole === "owner") return ["viewer", "editor", "admin"];
  if (callerRole === "admin") return ["viewer", "editor"];
  return [];
}

/** Only the owner can hand ownership to another (non-owner) member. */
export function canTransferOwnership(
  callerRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  isSelf: boolean,
): boolean {
  return callerRole === "owner" && !isSelf && targetRole !== "owner";
}

/**
 * The per-module permission a role maps to when inviting or changing a member's
 * role: viewer → view, editor → edit, admin/owner → admin. Used to seed the
 * `modulePermissions` (notes/tasks) an invite or role change writes.
 */
export function modulePermissionFor(role: WorkspaceRole): ModulePermission {
  if (role === "viewer") return "view";
  if (role === "admin" || role === "owner") return "admin";
  return "edit";
}
