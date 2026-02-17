import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

type WorkspaceListRow = {
  workspace_id: string;
  workspace_name: string;
  workspace_role: WorkspaceRole;
  notes_permission: ModulePermission;
  tasks_permission: ModulePermission;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

type NotificationRow = {
  id: string;
  workspace_id: string | null;
  event_type: string;
  actor_user_id: string | null;
  source_module: "notes" | "tasks" | null;
  source_resource_type: "note" | "task_project" | "task" | null;
  source_resource_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

function storageKey(userId: string): string {
  return `moduo:selected-workspace:${userId}`;
}

function mapWorkspace(row: WorkspaceListRow): WorkspaceSummary {
  return {
    id: row.workspace_id,
    name: row.workspace_name,
    role: row.workspace_role,
    permissions: {
      notes: row.notes_permission,
      tasks: row.tasks_permission,
    },
    isDeleted: row.is_deleted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNotification(row: NotificationRow): WorkspaceNotification {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    sourceModule: row.source_module,
    sourceResourceType: row.source_resource_type,
    sourceResourceId: row.source_resource_id,
    payload: row.payload ?? {},
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function toModulePermissions(
  value?: Partial<Record<"notes" | "tasks", ModulePermission>>
): Array<{ module: "notes" | "tasks"; permission: ModulePermission }> {
  const notes = value?.notes ?? "edit";
  const tasks = value?.tasks ?? "edit";
  return [
    { module: "notes", permission: notes },
    { module: "tasks", permission: tasks },
  ];
}

function toItemAclTemplates(
  value?: Array<{
    module: "notes" | "tasks";
    resourceType: "note" | "task_project" | "task";
    resourceId: string;
    effect: "allow" | "deny";
    permission: ModulePermission;
  }>
) {
  return (value ?? []).map((entry) => ({
    module: entry.module,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId,
    effect: entry.effect,
    permission: entry.permission,
  }));
}

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const { supabase, userId } = useAuth();
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
    if (!supabase || !userId) {
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      return;
    }

    const { data, error } = await supabase.rpc("workspace_list_for_current_user");
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as WorkspaceListRow[];
    const next = rows.map(mapWorkspace);
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
  }, [selectedWorkspaceId, supabase, userId]);

  const refreshAccessData = useCallback(async () => {
    if (!supabase || !selectedWorkspaceId) {
      setMembers([]);
      setInvites([]);
      return;
    }

    const [{ data: membersRows, error: membersError }, { data: invitesRows, error: invitesError }] =
      await Promise.all([
        supabase
          .from("workspace_members")
          .select("id,workspace_id,user_id,role,is_active,removed_at")
          .eq("workspace_id", selectedWorkspaceId)
          .order("created_at", { ascending: true }),
        supabase
          .from("workspace_invites")
          .select("id,workspace_id,email,role,status,created_at,updated_at")
          .eq("workspace_id", selectedWorkspaceId)
          .order("created_at", { ascending: false }),
      ]);

    if (membersError) throw membersError;
    if (invitesError) throw invitesError;

    setMembers(
      (Array.isArray(membersRows) ? membersRows : []).map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        userId: row.user_id,
        role: row.role,
        isActive: row.is_active,
        removedAt: row.removed_at,
      }))
    );

    setInvites(
      (Array.isArray(invitesRows) ? invitesRows : []).map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        email: row.email,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    );
  }, [selectedWorkspaceId, supabase]);

  const fetchNotifications = useCallback(
    async (scope: NotificationScope, limit = 150): Promise<WorkspaceNotification[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.rpc("workspace_list_notifications", {
        p_scope: scope,
        p_workspace_id: scope === "workspace" ? selectedWorkspaceId : null,
        p_limit: limit,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map((row) => mapNotification(row as NotificationRow));
    },
    [selectedWorkspaceId, supabase]
  );

  const refreshNotifications = useCallback(async () => {
    if (!supabase || !userId) {
      setNotifications([]);
      setUnreadCountWorkspace(0);
      setUnreadCountGlobal(0);
      return;
    }

    setNotificationsLoading(true);
    try {
      const [workspaceFeed, globalFeed, activeFeed] = await Promise.all([
        fetchNotifications("workspace", 250),
        fetchNotifications("global", 250),
        fetchNotifications(notificationsScope, 120),
      ]);
      setUnreadCountWorkspace(workspaceFeed.filter((item) => !item.readAt).length);
      setUnreadCountGlobal(globalFeed.filter((item) => !item.readAt).length);
      setNotifications(activeFeed);
    } finally {
      setNotificationsLoading(false);
    }
  }, [fetchNotifications, notificationsScope, supabase, userId]);

  const createWorkspace = useCallback(
    async (name = "New Workspace") => {
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("workspace_create", { p_name: name.trim() || "New Workspace" });
      if (error) throw error;
      await refreshWorkspaces();
      const workspaceId = (data as { id?: string } | null)?.id ?? null;
      if (workspaceId) selectWorkspace(workspaceId);
      return workspaceId;
    },
    [refreshWorkspaces, selectWorkspace, supabase]
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      if (!supabase) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const { error } = await supabase.from("workspaces").update({ name: trimmed }).eq("id", workspaceId);
      if (error) throw error;
      await refreshWorkspaces();
    },
    [refreshWorkspaces, supabase]
  );

  const leaveWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!supabase) return;
      const { error } = await supabase.rpc("workspace_leave", { p_workspace_id: workspaceId });
      if (error) throw error;
      await refreshWorkspaces();
    },
    [refreshWorkspaces, supabase]
  );

  const softDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!supabase) return;
      const { error } = await supabase.rpc("workspace_soft_delete", { p_workspace_id: workspaceId });
      if (error) throw error;
      await refreshWorkspaces();
    },
    [refreshWorkspaces, supabase]
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
      if (!supabase || !selectedWorkspaceId) return;
      const { error } = await supabase.rpc("workspace_send_invite", {
        p_workspace_id: selectedWorkspaceId,
        p_email: args.email,
        p_role: args.role,
        p_module_permissions: toModulePermissions(args.modulePermissions),
        p_item_acl_templates: toItemAclTemplates(args.itemAclTemplates),
      });
      if (error) throw error;
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, selectedWorkspaceId, supabase]
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
      if (!supabase) return;
      const { error } = await supabase.rpc("workspace_update_invite", {
        p_invite_id: args.inviteId,
        p_role: args.role,
        p_module_permissions: toModulePermissions(args.modulePermissions),
        p_item_acl_templates: toItemAclTemplates(args.itemAclTemplates),
      });
      if (error) throw error;
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, supabase]
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
      if (!supabase) return;
      const { error } = await supabase.rpc("workspace_update_member_permissions", {
        p_member_id: args.memberId,
        p_role: args.role,
        p_module_permissions: toModulePermissions(args.modulePermissions),
        p_item_acl: toItemAclTemplates(args.itemAcl),
      });
      if (error) throw error;
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, supabase]
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!supabase) return;
      const { error } = await supabase.rpc("workspace_revoke_invite", { p_invite_id: inviteId });
      if (error) throw error;
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, supabase]
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      if (!supabase) return;
      const { error } = await supabase.rpc("workspace_mark_notification_read", {
        p_notification_id: notificationId,
      });
      if (error) throw error;
      await refreshNotifications();
    },
    [refreshNotifications, supabase]
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("workspace_mark_all_notifications_read", {
      p_scope: notificationsScope,
      p_workspace_id: notificationsScope === "workspace" ? selectedWorkspaceId : null,
    });
    if (error) throw error;
    await refreshNotifications();
  }, [notificationsScope, refreshNotifications, selectedWorkspaceId, supabase]);

  useEffect(() => {
    if (!supabase || !userId) {
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
        await supabase.rpc("workspace_claim_invites");
        await refreshWorkspaces();
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [refreshWorkspaces, supabase, userId]);

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
