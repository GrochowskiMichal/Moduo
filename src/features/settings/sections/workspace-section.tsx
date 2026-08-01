import {
  Check,
  Copy,
  Crown,
  Link2,
  LogOut,
  Mail,
  MoreHorizontal,
  Plus,
  Shield,
  Trash2,
  User,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { UpgradeModal } from "../../../components/upgrade-modal";
import {
  assignableRolesFor,
  canManageMember,
  canTransferOwnership,
  modulePermissionFor,
} from "../../../features/workspaces/member-permissions";
import type { WorkspaceMember, WorkspaceRole } from "../../../features/workspaces/types";
import { useEntitlement } from "../../../hooks/use-entitlement";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";

import { SettingsSectionShell } from "./section-shell";

// ── Role presentation helpers (formerly in WorkspaceSettingsModal, DF-19e) ──────

type RoleMeta = {
  label: string;
  Icon: typeof Crown;
  badgeVariant: "warning" | "info" | "default" | "secondary";
};

const ROLE_META: Record<WorkspaceRole, RoleMeta> = {
  owner: { label: "Owner", Icon: Crown, badgeVariant: "warning" },
  admin: { label: "Admin", Icon: Shield, badgeVariant: "info" },
  editor: { label: "Editor", Icon: User, badgeVariant: "secondary" },
  viewer: { label: "Viewer", Icon: User, badgeVariant: "secondary" },
};

function RoleBadge({ role }: { role: WorkspaceRole }) {
  const meta = ROLE_META[role];
  const Icon = meta.Icon;
  return (
    <Badge variant={meta.badgeVariant}>
      <Icon className="size-3" aria-hidden />
      <span>{meta.label}</span>
    </Badge>
  );
}

function RolePicker({
  value,
  onChange,
  disabled,
  roles,
}: {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
  roles: WorkspaceRole[];
}) {
  return (
    <div role="radiogroup" aria-label="Invite role" className="inline-flex items-center gap-1">
      {roles.map((role) => {
        const active = value === role;
        return (
          <Button
            key={role}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onChange(role)}
            disabled={disabled}
            aria-pressed={active}
            className={active ? "text-foreground" : "text-muted-foreground"}
          >
            {ROLE_META[role].label}
          </Button>
        );
      })}
    </div>
  );
}

function MemberAvatar({ name, email }: { name?: string; email?: string }) {
  const letter = (name ?? email ?? "?").trim().slice(0, 1).toUpperCase();
  return (
    <Avatar size="sm" className="shrink-0">
      <AvatarFallback>{letter}</AvatarFallback>
    </Avatar>
  );
}

/** A labelled cluster (eyebrow above a card), mirroring the other settings sections. */
function WsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5">
        {children}
      </section>
    </div>
  );
}

const shortId = (id: string) => (id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

// ── The section (DF-19e: workspace management inlined; the standalone modal retired) ──

export function WorkspaceSection() {
  const {
    workspaces,
    selectedWorkspace,
    selectedWorkspaceId,
    members,
    invites,
    sendInvite,
    revokeInvite,
    updateMemberPermissions,
    removeMember,
    transferOwnership,
    leaveWorkspace,
    renameWorkspace,
    softDeleteWorkspace,
    createWorkspace,
    selectWorkspace,
    refreshAccessData,
  } = useWorkspace();
  const { userId, runtime } = useAuth();
  const { allowed: canInvite } = useEntitlement("team_members");
  const { allowed: canAddWorkspace } = useEntitlement("unlimited_workspaces");

  const callerRole: WorkspaceRole = selectedWorkspace?.role ?? "viewer";
  const isOwner = callerRole === "owner";
  const invitableRoles = assignableRolesFor(callerRole);

  // Invite / rename / add-workspace / danger-zone transient state.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [sending, setSending] = useState(false);
  const [lastIssuedToken, setLastIssuedToken] = useState<string | null>(null);
  const [copiedNew, setCopiedNew] = useState<"link" | "code" | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<WorkspaceMember | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [upgradeInviteOpen, setUpgradeInviteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [upgradeAddOpen, setUpgradeAddOpen] = useState(false);
  const [newName, setNewName] = useState("New Workspace");
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Refresh the roster when the section mounts (parity with the retired modal's
  // on-open refresh), and reset transient link/confirm state on workspace change.
  useEffect(() => {
    void refreshAccessData();
  }, [refreshAccessData, selectedWorkspaceId]);
  useEffect(() => {
    // The section (unlike the retired modal) stays mounted across a mid-open
    // workspace switch (⌘⇧W), so reset every transient control — including the
    // transfer dialog, or confirming it would fire against a foreign member id.
    setLastIssuedToken(null);
    setLeaveConfirm(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
    setTransferTarget(null);
    setInviteEmail("");
  }, [selectedWorkspaceId]);
  useEffect(() => {
    setNameDraft(selectedWorkspace?.name ?? "");
  }, [selectedWorkspace?.name, selectedWorkspaceId]);

  const lastInviteUrl = useMemo(
    () => (lastIssuedToken && runtime ? runtime.workspace.inviteUrl(lastIssuedToken) : null),
    [lastIssuedToken, runtime],
  );
  const inviteLinkFor = (token: string) => runtime?.workspace.inviteUrl(token) ?? token;
  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );

  // Owners transfer/delete rather than leave; leaving your only workspace strands
  // you at zero (provider guards at <= 1). DF-24 / gotchas §Routes.
  const canLeave = callerRole !== "owner" && workspaces.length > 1;
  const canDelete = isOwner && workspaces.length > 1;
  const nameChanged = nameDraft.trim().length > 0 && nameDraft.trim() !== selectedWorkspace?.name;

  const handleRename = async () => {
    if (!selectedWorkspaceId || !nameChanged || renaming) return;
    setRenaming(true);
    try {
      await renameWorkspace(selectedWorkspaceId, nameDraft.trim());
      toast.success("Workspace renamed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename the workspace.");
    } finally {
      setRenaming(false);
    }
  };

  const handleSendInvite = async () => {
    if (!canInvite) {
      setUpgradeInviteOpen(true);
      return;
    }
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    setSending(true);
    try {
      const invite = await sendInvite({
        email,
        role: inviteRole,
        modulePermissions: {
          notes: modulePermissionFor(inviteRole),
          tasks: modulePermissionFor(inviteRole),
        },
        itemAclTemplates: [],
      });
      if (invite?.token) {
        setLastIssuedToken(invite.token);
        setCopiedNew(null);
        await navigator.clipboard.writeText(inviteLinkFor(invite.token)).catch(() => {});
        toast.success("Invite link copied — send it to your teammate.");
      } else {
        toast.error("Couldn't create the invite. Try again.");
      }
      setInviteEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the invite.");
    } finally {
      setSending(false);
    }
  };

  const handleRoleChange = async (memberId: string, role: WorkspaceRole) => {
    try {
      await updateMemberPermissions({
        memberId,
        role,
        modulePermissions: {
          notes: modulePermissionFor(role),
          tasks: modulePermissionFor(role),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the role.");
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setRemovingMemberId(memberId);
    try {
      await removeMember(memberId);
      toast.success("Member removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove the member.");
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleTransferOwnership = async (member: WorkspaceMember) => {
    if (transferring) return;
    setTransferring(true);
    try {
      await transferOwnership(member.id);
      const name = member.displayName?.trim() || "That member";
      toast.success(`${name} is now the owner. You're an admin.`);
      setTransferTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't transfer ownership.");
    } finally {
      setTransferring(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await revokeInvite(inviteId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke the invite.");
    }
  };

  const handleLeave = async () => {
    if (!selectedWorkspaceId || leaving) return;
    setLeaving(true);
    try {
      await leaveWorkspace(selectedWorkspaceId);
      toast.success("You left the workspace.");
      setLeaveConfirm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't leave the workspace.");
    } finally {
      setLeaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedWorkspaceId || deleting) return;
    setDeleting(true);
    try {
      await softDeleteWorkspace(selectedWorkspaceId);
      toast.success("Workspace deleted.");
      setDeleteOpen(false);
      setDeleteConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the workspace.");
    } finally {
      setDeleting(false);
    }
  };

  const openAddDialog = () => {
    if (workspaces.length >= 1 && !canAddWorkspace) {
      setUpgradeAddOpen(true);
      return;
    }
    setNewName("New Workspace");
    setAddOpen(true);
  };

  const submitAddWorkspace = async () => {
    if (addSubmitting) return;
    const name = newName.trim() || "New Workspace";
    setAddSubmitting(true);
    try {
      const workspaceId = await createWorkspace(name);
      if (workspaceId) {
        selectWorkspace(workspaceId);
        setAddOpen(false);
      }
    } finally {
      setAddSubmitting(false);
    }
  };

  const inviteDisabled = sending || !inviteEmail.trim();

  return (
    <SettingsSectionShell
      title="Workspace"
      description="Members, invites, and per-module permissions for this workspace."
    >
      {!selectedWorkspace ? (
        <div className="rounded-lg border border-border bg-card px-6 py-5 text-sm text-muted-foreground">
          Select a workspace first.
        </div>
      ) : (
        <>
          {/* Identity + rename */}
          <WsGroup label="Workspace">
            <div className="flex items-start gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
                <Users className="size-5" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {/* Only the owner can rename — the `workspaces` UPDATE RLS is
                    owner-only (`owner_id = auth.uid()`), so an admin's client-side
                    rename would error. Non-owners see the name as static text. */}
                {isOwner ? (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="ws-name" className="sr-only">
                      Workspace name
                    </Label>
                    <Input
                      id="ws-name"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleRename();
                        }
                      }}
                      className="max-w-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRename()}
                      disabled={!nameChanged || renaming}
                    >
                      {renaming ? "Saving…" : "Rename"}
                    </Button>
                  </div>
                ) : (
                  <h3 className="font-display text-lg text-foreground">{selectedWorkspace.name}</h3>
                )}
                <p className="text-sm text-muted-foreground">
                  {members.length} member{members.length === 1 ? "" : "s"}
                  {isOwner
                    ? ` · ${pendingInvites.length} pending invite${pendingInvites.length === 1 ? "" : "s"}`
                    : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openAddDialog}
                className="shrink-0"
              >
                <Plus className="size-4" aria-hidden />
                Add workspace
              </Button>
            </div>
          </WsGroup>

          {/* Invite — owner-only (RLS gates invites to the owner). DF-24. */}
          {isOwner ? (
            <WsGroup label="Invite">
              {!canInvite ? (
                <button
                  type="button"
                  onClick={() => setUpgradeInviteOpen(true)}
                  className="group flex items-center justify-between gap-3 rounded-md border border-dashed border-warning/40 bg-warning/10 px-4 py-3 text-left transition-colors hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-warning/20 text-warning">
                      <Crown className="size-3.5" aria-hidden />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-warning">
                        Upgrade to Team to invite members
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Collaborate with your team in real time
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-warning">Upgrade →</span>
                </button>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail
                        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Label htmlFor="invite-email" className="sr-only">
                        Invite by email
                      </Label>
                      <Input
                        id="invite-email"
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="teammate@company.com"
                        autoCapitalize="none"
                        className="pl-9"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={() => void handleSendInvite()}
                      disabled={inviteDisabled}
                    >
                      <UserPlus className="size-3.5" aria-hidden />
                      {sending ? "Creating…" : "Create invite"}
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    <Label className="w-12 text-xs text-muted-foreground">Role</Label>
                    <RolePicker
                      value={inviteRole}
                      onChange={setInviteRole}
                      roles={invitableRoles}
                    />
                  </div>

                  {lastIssuedToken ? (
                    <div className="flex flex-col gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                        <p className="min-w-0 flex-1 text-xs text-success">
                          Invite created. Moduo doesn't email invites — send this link to your
                          teammate yourself:
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setLastIssuedToken(null)}
                          aria-label="Dismiss"
                          className="-mr-1 -mt-1 h-6 w-6 shrink-0"
                        >
                          <X className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
                        <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                          {lastInviteUrl}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            await navigator.clipboard
                              .writeText(lastInviteUrl ?? "")
                              .catch(() => {});
                            setCopiedNew("link");
                            setTimeout(() => setCopiedNew(null), 2000);
                          }}
                          aria-label="Copy invite link"
                          title="Copy invite link"
                          className="h-6 w-6 shrink-0"
                        >
                          {copiedNew === "link" ? (
                            <Check className="size-3 text-success" aria-hidden />
                          ) : (
                            <Copy className="size-3" aria-hidden />
                          )}
                        </Button>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(lastIssuedToken).catch(() => {});
                          setCopiedNew("code");
                          setTimeout(() => setCopiedNew(null), 2000);
                        }}
                        className="self-start text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
                      >
                        {copiedNew === "code" ? "Code copied" : "Or copy the raw code"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </WsGroup>
          ) : null}

          {/* Members */}
          <WsGroup label={`Members · ${members.length}`}>
            <ul className="flex flex-col gap-1.5">
              {members.map((member) => {
                const isSelf = member.userId === userId;
                const label = member.displayName?.trim() || shortId(member.userId);
                const canManage = canManageMember(callerRole, member.role, isSelf);
                const canTransfer = canTransferOwnership(callerRole, member.role, isSelf);
                const roleOptions = assignableRolesFor(callerRole);
                const showMenu = canManage || canTransfer;
                return (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <MemberAvatar name={member.displayName ?? undefined} email={member.userId} />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">
                          {label}
                          {isSelf ? (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              · You
                            </span>
                          ) : null}
                        </p>
                        {member.displayName ? null : (
                          <p className="text-2xs text-muted-foreground">Profile name not set</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <RoleBadge role={member.role} />
                      {showMenu ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Manage ${label}`}
                              className="h-6 w-6"
                            >
                              <MoreHorizontal className="size-3.5" aria-hidden />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" sideOffset={4} className="w-52 p-1">
                            {canManage
                              ? roleOptions.map((role) => {
                                  const active = member.role === role;
                                  return (
                                    <button
                                      key={role}
                                      type="button"
                                      onClick={() => void handleRoleChange(member.id, role)}
                                      className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                      <span>{ROLE_META[role].label}</span>
                                      {active ? (
                                        <Check
                                          className="size-3.5 text-muted-foreground"
                                          aria-hidden
                                        />
                                      ) : null}
                                    </button>
                                  );
                                })
                              : null}
                            {canTransfer ? (
                              <>
                                {canManage ? <div className="my-1 h-px bg-border" /> : null}
                                <button
                                  type="button"
                                  onClick={() => setTransferTarget(member)}
                                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <Crown className="size-3.5" aria-hidden />
                                  <span>Make owner</span>
                                </button>
                              </>
                            ) : null}
                            {canManage ? (
                              <>
                                <div className="my-1 h-px bg-border" />
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveMember(member.id)}
                                  disabled={removingMemberId === member.id}
                                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                >
                                  <UserMinus className="size-3.5" aria-hidden />
                                  <span>
                                    {removingMemberId === member.id
                                      ? "Removing…"
                                      : "Remove from workspace"}
                                  </span>
                                </button>
                              </>
                            ) : null}
                          </PopoverContent>
                        </Popover>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </WsGroup>

          {/* Pending invites — owner-only (revoke is owner-gated too) */}
          {isOwner && pendingInvites.length > 0 ? (
            <WsGroup label={`Pending · ${pendingInvites.length}`}>
              <ul className="flex flex-col gap-1.5">
                {pendingInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                        <Mail className="size-3" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">Invite pending</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <RoleBadge role={invite.role} />
                      {invite.token ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Copy invite link"
                          title="Copy invite link"
                          className="h-6 w-6"
                          onClick={async () => {
                            await navigator.clipboard
                              .writeText(inviteLinkFor(invite.token!))
                              .catch(() => {});
                            setCopiedInviteId(invite.id);
                            setTimeout(() => setCopiedInviteId(null), 2000);
                          }}
                        >
                          {copiedInviteId === invite.id ? (
                            <Check className="size-3 text-success" aria-hidden />
                          ) : (
                            <Link2 className="size-3" aria-hidden />
                          )}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Revoke invite"
                        onClick={() => void handleRevokeInvite(invite.id)}
                        className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </WsGroup>
          ) : null}

          {/* Danger zone — Leave (non-owner) / Delete (owner, with somewhere to land) */}
          {canLeave || canDelete ? (
            <WsGroup label="Danger zone">
              {canLeave ? (
                !leaveConfirm ? (
                  <button
                    type="button"
                    onClick={() => setLeaveConfirm(true)}
                    className="flex items-center gap-2 self-start rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LogOut className="size-3.5" aria-hidden />
                    <span>Leave workspace</span>
                  </button>
                ) : (
                  <div className="flex flex-col gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                    <p className="text-xs text-foreground">
                      Leave <span className="font-semibold">{selectedWorkspace.name}</span>? You'll
                      lose access until someone invites you again.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLeaveConfirm(false)}
                        disabled={leaving}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleLeave()}
                        disabled={leaving}
                      >
                        {leaving ? "Leaving…" : "Leave workspace"}
                      </Button>
                    </div>
                  </div>
                )
              ) : null}

              {canDelete ? (
                !deleteOpen ? (
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    className="flex items-center gap-2 self-start rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    <span>Delete workspace</span>
                  </button>
                ) : (
                  <div className="flex flex-col gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                    <p className="text-xs text-foreground">
                      Delete <span className="font-semibold">{selectedWorkspace.name}</span> for
                      everyone? This can't be undone. Type the workspace name to confirm.
                    </p>
                    <Input
                      value={deleteConfirm}
                      onChange={(event) => setDeleteConfirm(event.target.value)}
                      placeholder={selectedWorkspace.name}
                      aria-label="Type the workspace name to confirm deletion"
                      autoCapitalize="none"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDeleteOpen(false);
                          setDeleteConfirm("");
                        }}
                        disabled={deleting}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDelete()}
                        disabled={deleting || deleteConfirm.trim() !== selectedWorkspace.name}
                      >
                        {deleting ? "Deleting…" : "Delete workspace"}
                      </Button>
                    </div>
                  </div>
                )
              ) : null}
            </WsGroup>
          ) : null}
        </>
      )}

      {/* Transfer-ownership confirm */}
      <Dialog
        open={transferTarget !== null}
        onOpenChange={(open) => {
          if (!open && !transferring) setTransferTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Make {transferTarget?.displayName?.trim() || "this member"} the owner?
            </DialogTitle>
            <DialogDescription>
              They get full control of this workspace and you become an admin. Only the new owner
              can hand ownership back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTransferTarget(null)}
              disabled={transferring}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (transferTarget) void handleTransferOwnership(transferTarget);
              }}
              disabled={transferring}
            >
              {transferring ? "Transferring…" : "Transfer ownership"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add workspace */}
      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (!next && addSubmitting) return;
          setAddOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>
              Create a separate workspace to keep notes, projects, and integrations isolated from
              this one.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitAddWorkspace();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-workspace-name">Name</Label>
              <Input
                id="add-workspace-name"
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="New Workspace"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAddOpen(false)}
                disabled={addSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={addSubmitting}>
                {addSubmitting ? "Creating…" : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <UpgradeModal
        visible={upgradeInviteOpen}
        feature="team_members"
        onClose={() => setUpgradeInviteOpen(false)}
      />
      <UpgradeModal
        visible={upgradeAddOpen}
        feature="unlimited_workspaces"
        onClose={() => setUpgradeAddOpen(false)}
      />
    </SettingsSectionShell>
  );
}
