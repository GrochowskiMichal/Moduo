import { createContext, useContext } from "react";
import type { NotificationItem } from "../spine/notifications";
import type {
  ModulePermission,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from "./types";

export type NotificationScope = "workspace" | "global";

type ModuleAccessInput = Partial<Record<"notes" | "tasks", ModulePermission>>;

type ItemAclInput = Array<{
  module: "notes" | "tasks";
  resourceType: "note" | "task_project" | "task";
  resourceId: string;
  effect: "allow" | "deny";
  permission: ModulePermission;
}>;

export type SendWorkspaceInviteArgs = {
  email: string;
  role: WorkspaceRole;
  modulePermissions?: ModuleAccessInput;
  itemAclTemplates?: ItemAclInput;
};

export type UpdateWorkspaceInviteArgs = {
  inviteId: string;
  role: WorkspaceRole;
  modulePermissions?: ModuleAccessInput;
  itemAclTemplates?: ItemAclInput;
};

export type UpdateWorkspaceMemberPermissionsArgs = {
  memberId: string;
  role: WorkspaceRole;
  modulePermissions?: ModuleAccessInput;
  itemAcl?: ItemAclInput;
};

export type WorkspaceContextValue = {
  loading: boolean;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  selectedWorkspace: WorkspaceSummary | null;
  modulePermissions: { notes: ModulePermission; tasks: ModulePermission };
  canManageWorkspace: boolean;
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  notificationsScope: NotificationScope;
  notificationsLoading: boolean;
  notifications: NotificationItem[];
  unreadCountWorkspace: number;
  unreadCountGlobal: number;
  setNotificationsScope: (scope: NotificationScope) => void;
  selectWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
  refreshAccessData: () => Promise<void>;
  createWorkspace: (name?: string) => Promise<string | null>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  leaveWorkspace: (workspaceId: string) => Promise<void>;
  softDeleteWorkspace: (workspaceId: string) => Promise<void>;
  sendInvite: (args: SendWorkspaceInviteArgs) => Promise<WorkspaceInvite | null>;
  joinWorkspace: (token: string) => Promise<WorkspaceSummary | null>;
  updateMemberPermissions: (args: UpdateWorkspaceMemberPermissionsArgs) => Promise<void>;
  updateInvite: (args: UpdateWorkspaceInviteArgs) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (item: NotificationItem) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}
