import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveNotificationFeeds, type NotificationItem } from "../features/spine/notifications";
import type { Overrides, WorkspaceRoleDef } from "../features/workspaces/access";
import {
  rememberedWorkspaces,
  rememberWorkspaces,
} from "../features/workspaces/remembered-workspaces";
import type {
  PermissionKey,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceNotification,
  WorkspaceSummary,
} from "../features/workspaces/types";
import {
  type SendWorkspaceInviteArgs,
  type UpdateWorkspaceInviteArgs,
  type UpdateWorkspaceMemberPermissionsArgs,
  WorkspaceContext,
  type WorkspaceContextValue,
} from "../features/workspaces/workspace-context";
import {
  mapInvite,
  mapMember,
  mapNotification,
  mapRole,
  mapWorkspace,
  storageKey,
} from "../features/workspaces/workspace-mappers";
import {
  isNotificationEnabled,
  readLocalPreferences,
  usePreferencesValue,
} from "../lib/preferences";
import { browserOffline, isNetworkError } from "../lib/sync/network";
import { keepWorkspaceCopies } from "../lib/sync/store";
import { useAuth } from "./auth-provider";

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
    // Legacy workspace notifications (invites/membership) have no dismiss path —
    // they always read as active until DF-21c relocates them to Invitations.
    dismissedAt: null,
  };
}

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const { runtime, userId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [roles, setRoles] = useState<WorkspaceRoleDef[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  // The raw merged feed (spine + legacy), unfiltered. The three derived feeds
  // (active / history / invitations) + the unread count come from it below, so a
  // per-type mute (Settings → Preferences) or a dismiss applies instantly with no
  // refetch. DF-19f-notif / DF-21.
  const [rawNotifications, setRawNotifications] = useState<NotificationItem[]>([]);

  // React to per-type mutes without spinning a second sync loop (cross-device
  // reconcile is owned by the single <PreferencesSync/> in main.tsx).
  const { notifications: notificationPrefs } = usePreferencesValue();

  const { notifications, notificationHistory, workspaceInvitations, unreadCountWorkspace } =
    useMemo(() => {
      // The whole active/history/invitations/badge split is the pure
      // `deriveNotificationFeeds` (unit-tested); the provider just supplies the raw
      // feed + the DF-19f mute predicate. Spine events are current-workspace +
      // pref-gated; the legacy feed becomes the cross-workspace Invitations area.
      const feeds = deriveNotificationFeeds(rawNotifications, {
        workspaceId: selectedWorkspaceId,
        isEnabled: (op) => isNotificationEnabled(op, notificationPrefs),
      });
      return {
        notifications: feeds.active,
        notificationHistory: feeds.history,
        workspaceInvitations: feeds.invitations,
        unreadCountWorkspace: feeds.unreadCount,
      };
    }, [rawNotifications, notificationPrefs, selectedWorkspaceId]);

  // Mirror the selected id into a ref so `refreshWorkspaces` can read the current
  // selection without listing `selectedWorkspaceId` in its deps. Without this the
  // callback re-created on every selection change — and since it *sets* the
  // selection, its own boot effect re-fired and re-issued `workspace.list()` (the
  // measured workspaces ×3, plus the `loading` toggles that remounted AppChrome
  // and multiplied every downstream boot read). DF-12.
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId);
  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  });

  // Mirror the list so leave/delete can enforce the last-one guard without
  // listing `workspaces` in their deps (which would churn their identity on
  // every refresh). The invariant: never strand the user at zero reachable
  // workspaces (the runtime ops have no such guard). DF-24 (DF-16 deferred this).
  const workspacesRef = useRef(workspaces);
  useEffect(() => {
    workspacesRef.current = workspaces;
  });

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );

  const modulePermissions = useMemo(
    () => ({
      notes: selectedWorkspace?.permissions.notes ?? "none",
      tasks: selectedWorkspace?.permissions.tasks ?? "none",
      calendar: selectedWorkspace?.permissions.calendar ?? "none",
      contacts: selectedWorkspace?.permissions.contacts ?? "none",
      chat: selectedWorkspace?.permissions.chat ?? "none",
    }),
    [selectedWorkspace],
  );

  const myPerms = useMemo<PermissionKey[]>(
    () => selectedWorkspace?.perms ?? [],
    [selectedWorkspace],
  );
  const can = useCallback(
    (key: PermissionKey) => selectedWorkspace?.role === "owner" || myPerms.includes(key),
    [myPerms, selectedWorkspace?.role],
  );

  // "Can open the people/roles admin": any management power (PERM-1).
  const canManageWorkspace = useMemo(() => {
    if (!selectedWorkspace) return false;
    if (selectedWorkspace.role === "owner") return true;
    return ["ws.invite", "ws.manage_members", "ws.manage_roles"].some((k) =>
      selectedWorkspace.perms.includes(k as PermissionKey),
    );
  }, [selectedWorkspace]);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setSelectedWorkspaceId(workspaceId);
      if (typeof window !== "undefined" && userId) {
        window.localStorage.setItem(storageKey(userId), workspaceId);
      }
    },
    [userId],
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

    // Offline at launch (TV-D11a): open the workspaces this person had, as this
    // device remembers them, so the Tasks device copy can show. With no
    // network at all, without waiting for the read's retries; it reads again
    // when the network is back (the boot effect's `online` listener).
    const remembered = rememberedWorkspaces(userId);
    let next: WorkspaceSummary[];
    if (remembered && browserOffline()) {
      next = remembered;
    } else {
      try {
        const rows = await runtime.workspace.list();
        next = rows
          .map((row) => mapWorkspace(row, userId))
          .filter((workspace) => !workspace.isDeleted);
        // An empty list proves nothing (a request that went out without the
        // person's token reads as no workspaces): keep what the device has.
        if (next.length > 0) {
          rememberWorkspaces(userId, next);
          // Tasks device copies of workspaces you left or that went away go too.
          void keepWorkspaceCopies(
            userId,
            next.map((workspace) => workspace.id),
          );
        }
      } catch (e) {
        if (!remembered || !isNetworkError(e)) throw e;
        next = remembered;
      }
    }
    setWorkspaces(next);

    const currentSelected = selectedWorkspaceIdRef.current;
    // "Reopen last workspace" OFF (Settings → Preferences, DF-19f) ignores the
    // persisted selection at launch (currentSelected is null then → first
    // workspace); mid-session refreshes still keep the active one via
    // currentSelected, so this only changes the cold-launch default.
    const reopenLast = readLocalPreferences().reopenLastWorkspace;
    const persisted =
      reopenLast && typeof window !== "undefined"
        ? window.localStorage.getItem(storageKey(userId))
        : null;
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
      setRoles([]);
      return;
    }

    // Settle independently: a viewer/editor can read the member roster but may
    // not be allowed to read invites — don't let that drop the roster too. DF-24.
    // Roles degrade to [] before the PERM-1 migration exists (gotchas: a new
    // read path must survive the deploy gap).
    const [memberResult, inviteResult, roleResult] = await Promise.allSettled([
      runtime.workspace.listMembers(selectedWorkspaceId),
      runtime.workspace.listInvites(selectedWorkspaceId),
      // Async thunk: a runtime without listRoles (older shells, test doubles)
      // must reject here, not throw synchronously and drop the roster too.
      Promise.resolve().then(() => runtime.workspace.listRoles(selectedWorkspaceId)),
    ]);

    setMembers(memberResult.status === "fulfilled" ? memberResult.value.map(mapMember) : []);
    setInvites(inviteResult.status === "fulfilled" ? inviteResult.value.map(mapInvite) : []);
    setRoles(roleResult.status === "fulfilled" ? roleResult.value.map(mapRole) : []);
  }, [runtime, selectedWorkspaceId]);

  const refreshNotifications = useCallback(async () => {
    if (!runtime || !userId) {
      setRawNotifications([]);
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
          // 200 so the "See all" history modal (DF-21c) has depth; the active
          // dropdown renders a small non-dismissed subset of this.
          spine = await runtime.spine.listNotifications({
            workspaceId: selectedWorkspaceId,
            limit: 200,
          });
        } catch {
          spine = [];
        }
      }
      // Store the raw merged feed; the scope split, per-type mute filter, and both
      // unread counts are derived from it (see the memo above), so a mute toggles
      // instantly without a refetch.
      setRawNotifications(
        [...spine, ...legacy].sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
        ),
      );
    } finally {
      setNotificationsLoading(false);
    }
  }, [runtime, userId, selectedWorkspaceId]);

  const createWorkspace = useCallback(
    async (name = "New Workspace") => {
      if (!runtime) return null;
      const created = mapWorkspace(await runtime.workspace.create(name));
      await refreshWorkspaces();
      selectWorkspace(created.id);
      return created.id;
    },
    [refreshWorkspaces, runtime, selectWorkspace],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      if (!runtime) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      await runtime.workspace.rename(workspaceId, trimmed);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, runtime],
  );

  const updateWorkspaceBranding = useCallback(
    async (workspaceId: string, branding: { icon: string | null; logoUrl: string | null }) => {
      if (!runtime) return;
      await runtime.workspace.updateBranding(workspaceId, branding);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, runtime],
  );

  const setTaskKey = useCallback(
    async (workspaceId: string, key: string) => {
      if (!runtime) return;
      await runtime.workspace.setTaskKey(workspaceId, key);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, runtime],
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
    [refreshWorkspaces, runtime],
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
    [refreshWorkspaces, runtime],
  );

  const sendInvite = useCallback(
    async (args: SendWorkspaceInviteArgs): Promise<WorkspaceInvite | null> => {
      if (!runtime || !selectedWorkspaceId) return null;
      const raw = await runtime.workspace.issueInvite(
        selectedWorkspaceId,
        args.email,
        args.role,
        args.modulePermissions,
        args.roleId ?? null,
        args.sharePayload,
      );
      await refreshAccessData();
      await refreshNotifications();
      return raw ? mapInvite(raw) : null;
    },
    [refreshAccessData, refreshNotifications, runtime, selectedWorkspaceId],
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
        const joined = joinedId
          ? (refreshed.find((workspace) => workspace.id === joinedId) ?? null)
          : null;
        if (joined) selectWorkspace(joined.id);
        return joined;
      } catch (err) {
        console.error("[workspace] joinWorkspace failed:", err);
        return null;
      }
    },
    [refreshWorkspaces, runtime, selectWorkspace],
  );

  const updateInvite = useCallback(
    async (args: UpdateWorkspaceInviteArgs) => {
      if (!runtime) return;
      await runtime.workspace.updateInvite(
        args.inviteId,
        args.role,
        args.modulePermissions,
        args.roleId ?? null,
      );
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime],
  );

  const updateMemberPermissions = useCallback(
    async (args: UpdateWorkspaceMemberPermissionsArgs) => {
      if (!runtime) return;
      await runtime.workspace.updateMemberPermissions(
        args.memberId,
        args.role,
        args.modulePermissions,
      );
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime],
  );

  const upsertRole = useCallback(
    async (input: {
      roleId: string | null;
      name: string;
      description: string;
      permissions: PermissionKey[];
      readOnly: boolean;
      expectedUpdatedAt: string | null;
    }): Promise<WorkspaceRoleDef | null> => {
      if (!runtime || !selectedWorkspaceId) return null;
      const raw = await runtime.workspace.upsertRole({
        workspaceId: selectedWorkspaceId,
        ...input,
      });
      // A role edit re-resolves everyone holding it — the caller included.
      await Promise.all([refreshAccessData(), refreshWorkspaces()]);
      return raw ? mapRole(raw) : null;
    },
    [refreshAccessData, refreshWorkspaces, runtime, selectedWorkspaceId],
  );

  const deleteRole = useCallback(
    async (roleId: string, reassignTo: string) => {
      if (!runtime) return;
      await runtime.workspace.deleteRole(roleId, reassignTo);
      await Promise.all([refreshAccessData(), refreshWorkspaces()]);
    },
    [refreshAccessData, refreshWorkspaces, runtime],
  );

  const setMemberAccess = useCallback(
    async (memberId: string, roleId: string, overrides: Overrides) => {
      if (!runtime) return;
      await runtime.workspace.setMemberAccess(
        memberId,
        roleId,
        overrides as Record<string, boolean>,
      );
      await refreshAccessData();
    },
    [refreshAccessData, runtime],
  );

  const removeMember = useCallback(
    async (memberId: string) => {
      if (!runtime) return;
      // Throws on failure (not-owner/admin, target-is-owner, unapplied-RPC) —
      // callers toast it.
      await runtime.workspace.removeMember(memberId);
      await refreshAccessData();
    },
    [refreshAccessData, runtime],
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
    [refreshAccessData, refreshWorkspaces, runtime],
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!runtime) return;
      await runtime.workspace.revokeInvite(inviteId);
      await refreshAccessData();
      await refreshNotifications();
    },
    [refreshAccessData, refreshNotifications, runtime],
  );

  const markNotificationRead = useCallback(
    async (item: NotificationItem) => {
      if (!runtime) return;
      // Route to the op that owns the row: the spine activity-id op, or the
      // legacy workspace-notification op.
      if (item.source === "spine") {
        if (item.workspaceId) {
          await runtime.spine.markNotificationRead({
            workspaceId: item.workspaceId,
            activityId: item.id,
          });
        }
      } else {
        await runtime.workspace.markNotificationRead(item.id);
      }
      await refreshNotifications();
    },
    [refreshNotifications, runtime],
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

  // Dismiss / undo (DF-21b). Only spine rows carry a dismiss mark — legacy
  // invites are relocated, not dismissed (DF-21c). Dismiss every row in a digest
  // card at once, then refresh once; the ops throw on failure so the caller can
  // surface a toast (and skip the Undo) if the migration isn't deployed yet.
  const dismissNotifications = useCallback(
    async (items: NotificationItem[]) => {
      if (!runtime) return;
      const targets = items.filter((i) => i.source === "spine" && i.workspaceId);
      try {
        await Promise.all(
          targets.map((i) =>
            runtime.spine.dismissNotification({
              workspaceId: i.workspaceId as string,
              activityId: i.id,
            }),
          ),
        );
      } finally {
        // Always reconcile — a partial failure across a multi-row card still
        // repaints the real server state instead of a stale list.
        await refreshNotifications();
      }
    },
    [refreshNotifications, runtime],
  );

  const undismissNotifications = useCallback(
    async (items: NotificationItem[]) => {
      if (!runtime) return;
      const targets = items.filter((i) => i.source === "spine" && i.workspaceId);
      try {
        await Promise.all(
          targets.map((i) =>
            runtime.spine.undismissNotification({
              workspaceId: i.workspaceId as string,
              activityId: i.id,
            }),
          ),
        );
      } finally {
        await refreshNotifications();
      }
    },
    [refreshNotifications, runtime],
  );

  useEffect(() => {
    if (!runtime || !userId) {
      setLoading(false);
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      setMembers([]);
      setInvites([]);
      setRawNotifications([]);
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
    // Opened offline from the remembered list: read the real one once the
    // network is back (TV-D11a).
    const onOnline = () => {
      void refreshWorkspaces().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
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
    // Scope (Workspace/Global) is now a pure view derived from the raw feed, so it
    // no longer triggers a refetch — only a real workspace change does. DF-19f-notif.
    if (loading) return;
    void refreshNotifications();
  }, [loading, refreshNotifications, selectedWorkspaceId]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      loading,
      workspaces,
      selectedWorkspaceId,
      selectedWorkspace,
      modulePermissions,
      canManageWorkspace,
      myPerms,
      can,
      roles,
      upsertRole,
      deleteRole,
      setMemberAccess,
      members,
      invites,
      notificationsLoading,
      notifications,
      notificationHistory,
      workspaceInvitations,
      unreadCountWorkspace,
      selectWorkspace,
      refreshWorkspaces,
      refreshAccessData,
      createWorkspace,
      renameWorkspace,
      updateWorkspaceBranding,
      setTaskKey,
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
      dismissNotifications,
      undismissNotifications,
    }),
    [
      can,
      canManageWorkspace,
      deleteRole,
      myPerms,
      roles,
      setMemberAccess,
      upsertRole,
      createWorkspace,
      dismissNotifications,
      invites,
      leaveWorkspace,
      loading,
      markAllNotificationsRead,
      markNotificationRead,
      undismissNotifications,
      members,
      modulePermissions,
      notifications,
      notificationHistory,
      notificationsLoading,
      refreshAccessData,
      refreshNotifications,
      refreshWorkspaces,
      renameWorkspace,
      updateWorkspaceBranding,
      setTaskKey,
      revokeInvite,
      selectedWorkspace,
      selectedWorkspaceId,
      selectWorkspace,
      sendInvite,
      joinWorkspace,
      removeMember,
      transferOwnership,
      softDeleteWorkspace,
      unreadCountWorkspace,
      updateMemberPermissions,
      updateInvite,
      workspaceInvitations,
      workspaces,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export { useWorkspace } from "../features/workspaces/workspace-context";
