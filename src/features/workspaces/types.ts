import type {
  InviteStatus,
  ModulePermission,
  PermissionKey,
  WorkspaceRole,
} from "@contracts/vocabularies";

export type {
  InviteStatus,
  ModulePermission,
  PermissionKey,
  WorkspaceRole,
} from "@contracts/vocabularies";

/** The modules the role matrix covers, each as a none/view/edit/admin lane. */
export type ModulePermissions = {
  notes: ModulePermission;
  tasks: ModulePermission;
  calendar: ModulePermission;
  contacts: ModulePermission;
  chat: ModulePermission;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  /** Emoji mark. Null when a logo image is set, or when the workspace has neither. */
  icon: string | null;
  /** Public URL of the uploaded logo. Takes the place of `icon`. */
  logoUrl: string | null;
  /**
   * The prefix of every task handle, `MOD` in `MOD-142` (TV-D8): 2–5 letters,
   * from the workspace name; the owner can change it. Null before TV-D8.
   */
  taskKey: string | null;
  role: WorkspaceRole;
  permissions: ModulePermissions;
  /** Effective permission keys (PERM-1). Owners hold every key. */
  perms: PermissionKey[];
  /** The caller's workspace role id; null for an owner-created bare row. */
  roleId: string | null;
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
  /** PERM-1: the member's workspace role + personal exceptions + resolved set. */
  roleId: string | null;
  overrides: Partial<Record<PermissionKey, boolean>>;
  perms: PermissionKey[];
  joinedAt: string | null;
  isActive: boolean;
  removedAt: string | null;
  /** From the `profiles(*)` join in `listMembers` — null until the profile resolves. */
  displayName: string | null;
  avatarUrl: string | null;
};

export type WorkspaceBranding = {
  icon: string | null;
  logoUrl: string | null;
};

export type WorkspaceInvite = {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  roleId: string | null;
  status: InviteStatus;
  expiresAt: string | null;
  token?: string;
  createdAt: string;
  updatedAt: string;
};
