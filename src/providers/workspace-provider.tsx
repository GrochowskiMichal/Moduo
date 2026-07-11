import { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import type { NotificationItem } from "../features/spine/notifications";
import type {
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceNotification,
  WorkspaceSummary,
} from "../features/workspaces/types";
import {
  WorkspaceContext,
  type NotificationScope,
  type SendWorkspaceInviteArgs,
  type UpdateWorkspaceInviteArgs,
  type UpdateWorkspaceMemberPermissionsArgs,
  type WorkspaceContextValue,
} from "../features/workspaces/workspace-context";
import { mapInvite, mapMember, mapNotification, mapWorkspace, storageKey } from "../features/workspaces/workspace-mappers";

/** Map a legacy workspace notification into the source-agnostic feed item. */
function legacyNotificationToItem(n: WorkspaceNotification): NotificationItem {
  return {
    id: n.id,
    source: "workspace",
    workspaceId: n.workspaceId,
    targetType: n.sourceResourceType,
    targetId: n.sourceResourceId,
    op: n.eventType,
    payload: n.payload,
    actorType: "user",
    actorId: n.actorUserId,
    actorLabel: null,
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
}

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const { runtime, userId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [notificationsScope, setNotificationsScope] = useState<NotificationScope>("workspace");
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCountWorkspace, setUnreadCountWorkspace] = useState(0);
  const [unreadCountGlobal, setUnreadCountGlobal] = useState(0);

  // Mirror the selected id into a ref so `refreshWorkspaces` can read the current
  // selection without listing `selectedWorkspaceId` in its deps. Without this the
  // callback re-created on every selection change — and since it *sets* the
  // selection, its own boot effect re-fired and re-issued `workspace.list()` (the
  // measured workspaces ×3, plus the `loading` toggles that remounted AppChrome
  // and multiplied every downstream boot read). DF-12.
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId);
  selectedWorkspaceIdRef.current = selectedWorkspaceId;

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

    const currentSelected = selectedWorkspaceIdRef.current;
    const persisted = typeof window !== "undefined" ? window.localStorage.getItem(storageKey(userId)) : null;
    const resolvedSelected =
      (persisted && next.some((workspace) => workspace.id === persisted) ? persisted : null) ??
      (currentSelected && next.some((workspace) => workspace.id === currentSelected)
        ? currentSelected
        : null) ??
      next[0]?.id ??
      null;

    setSelectedWorkspaceId(resolvedSelected);
    if (resolvedSelected && typeof window !== "undefined") {
      window.localStorage.setItem(storageKey(userId), resolvedSelected);
    }
  }, [runtime, userId]);

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
      // Legacy workspace feed (invites / membership) → the normalized item shape.
      const legacy: NotificationItem[] = (await runtime.workspace.listNotifications())
        .map(mapNotification)
        .map(legacyNotificationToItem);
      // Spine-derived feed (block CT-5): module_activity rows targeting me. It's
      // workspace-scoped, so fetch for the selected workspace. Degrade gracefully
      // if the migration isn't deployed yet (the RPC 404s) — the bell keeps
      // showing the legacy feed rather than breaking.
      let spine: NotificationItem[] = [];
      if (selectedWorkspaceId) {
        try {
          spine = await runtime.spine.listNotifications({ workspaceId: selectedWorkspaceId });
        } catch {
          spine = [];
        }
      }
      const all = [...spine, ...legacy].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
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
    async (args: SendWorkspaceInviteArgs): Promise<WorkspaceInvite | null> => {
      if (!runtime || !selectedWorkspaceId) return null;
      const raw = await runtime.workspace.issueInvite(selectedWorkspaceId, args.email, args.role, args.modulePermissions);
      await refreshAccessData();
      await refreshNotifications();
      return raw ? mapInvite(raw) : null;
    },
    [refreshAccessData, refreshNotifications, runtime, selectedWorkspaceId]
  );

  const joinWorkspace = useCallback(
    async (token: string): Promise<WorkspaceSummary | null> => {
      if (!runtime) return null;
      try {
        const raw = await runtime.workspace.joinInvite(token.trim());
        await refreshWorkspaces();
        if (raw?.id) selectWorkspace(raw.id);
        return raw ? mapWorkspace(raw) : null;
      } catch (err) {
        console.error("[workspace] joinWorkspace failed:", err);
        return null;
      }
    },
    [refreshWorkspaces, runtime, selectWorkspace]
  );

  const updateInvite = useCallback(
    async (args: UpdateWorkspaceInviteArgs) => {
      if (!runtime) return;
      await runtime.workspace.updateInvite(args.inviteId, args.role, args.modulePermissions);
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime]
  );

  const updateMemberPermissions = useCallback(
    async (args: UpdateWorkspaceMemberPermissionsArgs) => {
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
    async (item: NotificationItem) => {
      if (!runtime) return;
      // Route to the op that owns the row: the spine activity-id op, or the
      // legacy workspace-notification op.
      if (item.source === "spine") {
        if (item.workspaceId) {
          await runtime.spine.markNotificationRead({ workspaceId: item.workspaceId, activityId: item.id });
        }
      } else {
        await runtime.workspace.markNotificationRead(item.id);
      }
      await refreshNotifications();
    },
    [refreshNotifications, runtime]
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!runtime) return;
    await runtime.workspace.markAllNotificationsRead();
    if (selectedWorkspaceId) {
      try {
        await runtime.spine.markAllNotificationsRead({ workspaceId: selectedWorkspaceId });
      } catch {
        // Spine notifications migration not deployed yet — legacy mark-all still ran.
      }
    }
    await refreshNotifications();
  }, [refreshNotifications, runtime, selectedWorkspaceId]);

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
    // Wait for the initial workspace resolution before the first notifications
    // read. Otherwise it fires once at `selectedWorkspaceId === null` (legacy feed
    // only) and again when the workspace resolves — the measured notifications
    // duplication. A zero-workspace invitee still reaches this (loading flips false
    // with a null workspace) so their invite feed loads. DF-12.
    if (loading) return;
    void refreshNotifications();
  }, [loading, notificationsScope, refreshNotifications, selectedWorkspaceId]);



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
      joinWorkspace,
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
      joinWorkspace,
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

export { useWorkspace } from "../features/workspaces/workspace-context";
