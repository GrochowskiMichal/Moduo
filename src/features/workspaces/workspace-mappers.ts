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

export function mapWorkspace(row: any): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    role: (row.role ?? "owner") as WorkspaceRole,
    permissions: {
      notes: (row.permissions?.notes ?? "edit") as ModulePermission,
      tasks: (row.permissions?.tasks ?? "edit") as ModulePermission,
    },
    isDeleted: !!row.isDeleted || !!row.is_deleted,
    createdAt: row.createdAt ?? row.created_at ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
  };
}

export function mapMember(row: any): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    userId: row.userId ?? row.user_id,
    role: (row.role ?? "viewer") as WorkspaceRole,
    isActive: row.isActive ?? row.is_active ?? true,
    removedAt: row.removedAt ?? row.removed_at ?? null,
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
