import { createContext, useContext } from "react";
import type { NotificationItem } from "../spine/notifications";
import type {
  ModulePermission,
  WorkspaceBranding,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from "./types";

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
  notificationsLoading: boolean;
  /** The active event feed (current workspace, non-dismissed) — the bell dropdown. */
  notifications: NotificationItem[];
  /** The full current-workspace event history incl. read + dismissed — the "See all" modal (DF-21c). */
  notificationHistory: NotificationItem[];
  /** Legacy invite/membership feed (cross-workspace) — the dedicated Invitations area (DF-21c). */
  workspaceInvitations: NotificationItem[];
  unreadCountWorkspace: number;
  selectWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<WorkspaceSummary[]>;
  refreshAccessData: () => Promise<void>;
  createWorkspace: (name?: string) => Promise<string | null>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  updateWorkspaceBranding: (workspaceId: string, branding: WorkspaceBranding) => Promise<void>;
  leaveWorkspace: (workspaceId: string) => Promise<void>;
  softDeleteWorkspace: (workspaceId: string) => Promise<void>;
  sendInvite: (args: SendWorkspaceInviteArgs) => Promise<WorkspaceInvite | null>;
  joinWorkspace: (token: string) => Promise<WorkspaceSummary | null>;
  updateMemberPermissions: (args: UpdateWorkspaceMemberPermissionsArgs) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  transferOwnership: (memberId: string) => Promise<void>;
  updateInvite: (args: UpdateWorkspaceInviteArgs) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (item: NotificationItem) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  /** Dismiss every row in a digest card (DF-21b) — spine rows only; refresh once. */
  dismissNotifications: (items: NotificationItem[]) => Promise<void>;
  /** Undo a dismiss (the 8s Undo) — restores the rows to the active feed. */
  undismissNotifications: (items: NotificationItem[]) => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}
