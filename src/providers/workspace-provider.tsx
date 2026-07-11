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

  // Mirror the list so leave/delete can enforce the last-one guard without
  // listing `workspaces` in their deps (which would churn their identity on
  // every refresh). The invariant: never strand the user at zero reachable
  // workspaces (the runtime ops have no such guard). DF-24 (DF-16 deferred this).
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;

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

  // Returns the freshly-loaded list so callers (e.g. `joinWorkspace`) can resolve a
  // just-added workspace immediately — `setWorkspaces` is async, so the closure's
  // `workspaces` won't reflect the new rows right after this awaits.
  const refreshWorkspaces = useCallback(async (): Promise<WorkspaceSummary[]> => {
    if (!runtime || !userId) {
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      return [];
    }

    const rows = await runtime.workspace.list();
    const next = rows
      .map((row) => mapWorkspace(row, userId))
      .filter((workspace) => !workspace.isDeleted);
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
    return next;
  }, [runtime, userId]);

  const refreshAccessData = useCallback(async () => {
    if (!runtime || !selectedWorkspaceId) {
      setMembers([]);
      setInvites([]);
      return;
    }

    // Settle independently: a viewer/editor can read the member roster but may
    // not be allowed to read invites — don't let that drop the roster too. DF-24.
    const [memberResult, inviteResult] = await Promise.allSettled([
      runtime.workspace.listMembers(selectedWorkspaceId),
      runtime.workspace.listInvites(selectedWorkspaceId),
    ]);

    setMembers(memberResult.status === "fulfilled" ? memberResult.value.map(mapMember) : []);
    setInvites(inviteResult.status === "fulfilled" ? inviteResult.value.map(mapInvite) : []);
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
      if (workspacesRef.current.length <= 1) {
        throw new Error("You can't leave your only workspace.");
      }
      await runtime.workspace.leave(workspaceId);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, runtime]
  );

  const softDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!runtime) return;
      if (workspacesRef.current.length <= 1) {
        throw new Error("You can't delete your only workspace.");
      }
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
        // `joinInvite` returns the accepted *invite* row, not a workspace — its
        // `workspace_id` points at the joined workspace. Resolve the real summary
        // from the refreshed list rather than mapping the invite shape (which would
        // yield a garbage id/name). DF-24 validator finding.
        const invite = await runtime.workspace.joinInvite(token.trim());
        const refreshed = await refreshWorkspaces();
        const joinedId = invite?.workspace_id ?? invite?.workspaceId ?? null;
        const joined = joinedId ? refreshed.find((workspace) => workspace.id === joinedId) ?? null : null;
        if (joined) selectWorkspace(joined.id);
        return joined;
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

  const removeMember = useCallback(
    async (memberId: string) => {
      if (!runtime) return;
      // Throws on failure (not-owner/admin, target-is-owner, unapplied-RPC) —
      // callers toast it.
      await runtime.workspace.removeMember(memberId);
      await refreshAccessData();
    },
    [refreshAccessData, runtime]
  );

  const transferOwnership = useCallback(
    async (memberId: string) => {
      if (!runtime) return;
      // The caller's own role changes (owner → admin), so refresh the workspace
      // summary too, not just the roster.
      await runtime.workspace.transferOwnership(memberId);
      await refreshWorkspaces();
      await refreshAccessData();
    },
    [refreshAccessData, refreshWorkspaces, runtime]
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
      removeMember,
      transferOwnership,
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
      removeMember,
      transferOwnership,
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
