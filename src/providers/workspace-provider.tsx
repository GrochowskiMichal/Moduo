import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import type {
  ModulePermission,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceNotification,
  WorkspaceRole,
  WorkspaceSummary,
} from "../features/workspaces/types";

type NotificationScope = "workspace" | "global";

type WorkspaceContextValue = {
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
  notifications: WorkspaceNotification[];
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
  sendInvite: (args: {
    email: string;
    role: WorkspaceRole;
    modulePermissions?: Partial<Record<"notes" | "tasks", ModulePermission>>;
    itemAclTemplates?: Array<{
      module: "notes" | "tasks";
      resourceType: "note" | "task_project" | "task";
      resourceId: string;
      effect: "allow" | "deny";
      permission: ModulePermission;
    }>;
  }) => Promise<void>;
  updateMemberPermissions: (args: {
    memberId: string;
    role: WorkspaceRole;
    modulePermissions?: Partial<Record<"notes" | "tasks", ModulePermission>>;
    itemAcl?: Array<{
      module: "notes" | "tasks";
      resourceType: "note" | "task_project" | "task";
      resourceId: string;
      effect: "allow" | "deny";
      permission: ModulePermission;
    }>;
  }) => Promise<void>;
  updateInvite: (args: {
    inviteId: string;
    role: WorkspaceRole;
    modulePermissions?: Partial<Record<"notes" | "tasks", ModulePermission>>;
    itemAclTemplates?: Array<{
      module: "notes" | "tasks";
      resourceType: "note" | "task_project" | "task";
      resourceId: string;
      effect: "allow" | "deny";
      permission: ModulePermission;
    }>;
  }) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function storageKey(userId: string): string {
  return `moduo:selected-workspace:${userId}`;
}

function mapWorkspace(row: any): WorkspaceSummary {
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

function mapMember(row: any): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    userId: row.userId ?? row.user_id,
    role: (row.role ?? "viewer") as WorkspaceRole,
    isActive: row.isActive ?? row.is_active ?? true,
    removedAt: row.removedAt ?? row.removed_at ?? null,
  };
}

function mapInvite(row: any): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    email: row.email,
    role: (row.role ?? "viewer") as WorkspaceRole,
    status: (row.status ?? "pending") as WorkspaceInvite["status"],
    createdAt: row.createdAt ?? row.created_at ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
  };
}

function mapNotification(row: any): WorkspaceNotification {
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

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const { runtime, userId } = useAuth();
  const legacyMigrationRunRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [notificationsScope, setNotificationsScope] = useState<NotificationScope>("workspace");
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [unreadCountWorkspace, setUnreadCountWorkspace] = useState(0);
  const [unreadCountGlobal, setUnreadCountGlobal] = useState(0);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  );

  const modulePermissions = useMemo(
    () => ({
      notes: selectedWorkspace?.permissions.notes ?? "none",
      tasks: selectedWorkspace?.permissions.tasks ?? "none",
    }),
    [selectedWorkspace]
  );

  const canManageWorkspace = useMemo(() => {
    if (!selectedWorkspace) return false;
    return selectedWorkspace.role === "owner" || selectedWorkspace.role === "admin";
  }, [selectedWorkspace]);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setSelectedWorkspaceId(workspaceId);
      if (typeof window !== "undefined" && userId) {
        window.localStorage.setItem(storageKey(userId), workspaceId);
      }
    },
    [userId]
  );

  const refreshWorkspaces = useCallback(async () => {
    if (!runtime || !userId) {
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      return;
    }

    const rows = await runtime.workspace.list();
    const next = rows.map(mapWorkspace).filter((workspace) => !workspace.isDeleted);
    setWorkspaces(next);

    const persisted = typeof window !== "undefined" ? window.localStorage.getItem(storageKey(userId)) : null;
    const resolvedSelected =
      (persisted && next.some((workspace) => workspace.id === persisted) ? persisted : null) ??
      (selectedWorkspaceId && next.some((workspace) => workspace.id === selectedWorkspaceId)
        ? selectedWorkspaceId
        : null) ??
      next[0]?.id ??
      null;

    setSelectedWorkspaceId(resolvedSelected);
    if (resolvedSelected && typeof window !== "undefined") {
      window.localStorage.setItem(storageKey(userId), resolvedSelected);
    }
  }, [runtime, selectedWorkspaceId, userId]);

  const refreshAccessData = useCallback(async () => {
    if (!runtime || !selectedWorkspaceId) {
      setMembers([]);
      setInvites([]);
      return;
    }

    const [memberRows, inviteRows] = await Promise.all([
      runtime.workspace.listMembers(selectedWorkspaceId),
      runtime.workspace.listInvites(selectedWorkspaceId),
    ]);

    setMembers(memberRows.map(mapMember));
    setInvites(inviteRows.map(mapInvite));
  }, [runtime, selectedWorkspaceId]);

  const refreshNotifications = useCallback(async () => {
    if (!runtime || !userId) {
      setNotifications([]);
      setUnreadCountWorkspace(0);
      setUnreadCountGlobal(0);
      return;
    }

    setNotificationsLoading(true);
    try {
      const all = (await runtime.workspace.listNotifications()).map(mapNotification);
      const workspaceFeed = all.filter((item) => item.workspaceId === selectedWorkspaceId);
      const globalFeed = all;
      const activeFeed = notificationsScope === "workspace" ? workspaceFeed : globalFeed;
      setUnreadCountWorkspace(workspaceFeed.filter((item) => !item.readAt).length);
      setUnreadCountGlobal(globalFeed.filter((item) => !item.readAt).length);
      setNotifications(activeFeed);
    } finally {
      setNotificationsLoading(false);
    }
  }, [runtime, userId, selectedWorkspaceId, notificationsScope]);

  const createWorkspace = useCallback(
    async (name = "New Workspace") => {
      if (!runtime) return null;
      const created = mapWorkspace(await runtime.workspace.create(name));
      await refreshWorkspaces();
      selectWorkspace(created.id);
      return created.id;
    },
    [refreshWorkspaces, runtime, selectWorkspace]
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      if (!runtime) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      await runtime.workspace.rename(workspaceId, trimmed);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, runtime]
  );

  const leaveWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!runtime) return;
      await runtime.workspace.leave(workspaceId);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, runtime]
  );

  const softDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!runtime) return;
      await runtime.workspace.softDelete(workspaceId);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, runtime]
  );

  const sendInvite = useCallback(
    async (args: {
      email: string;
      role: WorkspaceRole;
      modulePermissions?: Partial<Record<"notes" | "tasks", ModulePermission>>;
      itemAclTemplates?: Array<{
        module: "notes" | "tasks";
        resourceType: "note" | "task_project" | "task";
        resourceId: string;
        effect: "allow" | "deny";
        permission: ModulePermission;
      }>;
    }) => {
      if (!runtime || !selectedWorkspaceId) return;
      await runtime.workspace.issueInvite(selectedWorkspaceId, args.email, args.role, args.modulePermissions);
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime, selectedWorkspaceId]
  );

  const updateInvite = useCallback(
    async (args: {
      inviteId: string;
      role: WorkspaceRole;
      modulePermissions?: Partial<Record<"notes" | "tasks", ModulePermission>>;
      itemAclTemplates?: Array<{
        module: "notes" | "tasks";
        resourceType: "note" | "task_project" | "task";
        resourceId: string;
        effect: "allow" | "deny";
        permission: ModulePermission;
      }>;
    }) => {
      if (!runtime) return;
      await runtime.workspace.updateInvite(args.inviteId, args.role, args.modulePermissions);
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime]
  );

  const updateMemberPermissions = useCallback(
    async (args: {
      memberId: string;
      role: WorkspaceRole;
      modulePermissions?: Partial<Record<"notes" | "tasks", ModulePermission>>;
      itemAcl?: Array<{
        module: "notes" | "tasks";
        resourceType: "note" | "task_project" | "task";
        resourceId: string;
        effect: "allow" | "deny";
        permission: ModulePermission;
      }>;
    }) => {
      if (!runtime) return;
      await runtime.workspace.updateMemberPermissions(args.memberId, args.role, args.modulePermissions);
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime]
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!runtime) return;
      await runtime.workspace.revokeInvite(inviteId);
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime]
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      if (!runtime) return;
      await runtime.workspace.markNotificationRead(notificationId);
      await refreshNotifications();
    },
    [refreshNotifications, runtime]
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!runtime) return;
    await runtime.workspace.markAllNotificationsRead();
    await refreshNotifications();
  }, [refreshNotifications, runtime]);

  useEffect(() => {
    if (!runtime || !userId) {
      setLoading(false);
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      setMembers([]);
      setInvites([]);
      setNotifications([]);
      return;
    }

    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        await refreshWorkspaces();
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [refreshWorkspaces, runtime, userId]);

  useEffect(() => {
    void refreshAccessData();
  }, [refreshAccessData]);

  useEffect(() => {
    void refreshNotifications();
  }, [notificationsScope, refreshNotifications, selectedWorkspaceId]);



  const value = useMemo<WorkspaceContextValue>(
    () => ({
      loading,
      workspaces,
      selectedWorkspaceId,
      selectedWorkspace,
      modulePermissions,
      canManageWorkspace,
      members,
      invites,
      notificationsScope,
      notificationsLoading,
      notifications,
      unreadCountWorkspace,
      unreadCountGlobal,
      setNotificationsScope,
      selectWorkspace,
      refreshWorkspaces,
      refreshAccessData,
      createWorkspace,
      renameWorkspace,
      leaveWorkspace,
      softDeleteWorkspace,
      sendInvite,
      updateMemberPermissions,
      updateInvite,
      revokeInvite,
      refreshNotifications,
      markNotificationRead,
      markAllNotificationsRead,
    }),
    [
      canManageWorkspace,
      createWorkspace,
      invites,
      leaveWorkspace,
      loading,
      markAllNotificationsRead,
      markNotificationRead,
      members,
      modulePermissions,
      notifications,
      notificationsLoading,
      notificationsScope,
      refreshAccessData,
      refreshNotifications,
      refreshWorkspaces,
      renameWorkspace,
      revokeInvite,
      selectedWorkspace,
      selectedWorkspaceId,
      selectWorkspace,
      sendInvite,
      softDeleteWorkspace,
      unreadCountGlobal,
      unreadCountWorkspace,
      updateMemberPermissions,
      updateInvite,
      workspaces,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}
