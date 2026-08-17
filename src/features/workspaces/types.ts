import type { InviteStatus, ModulePermission, WorkspaceRole } from "@contracts/vocabularies";

export type {
  InviteStatus,
  ModulePermission,
  WorkspaceRole,
} from "@contracts/vocabularies";

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  permissions: {
    notes: ModulePermission;
    tasks: ModulePermission;
  };
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceNotification = {
  id: string;
  workspaceId: string | null;
  eventType: string;
  actorUserId: string | null;
  sourceModule: "notes" | "tasks" | null;
  sourceResourceType: "note" | "task_project" | "task" | null;
  sourceResourceId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

export type WorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  isActive: boolean;
  removedAt: string | null;
  /** From the `profiles(*)` join in `listMembers` — null until the profile resolves. */
  displayName: string | null;
  avatarUrl: string | null;
};

export type WorkspaceInvite = {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  status: InviteStatus;
  token?: string;
  createdAt: string;
  updatedAt: string;
};
