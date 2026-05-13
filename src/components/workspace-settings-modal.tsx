import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  Mail,
  MoreHorizontal,
  Send,
  Shield,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { useWorkspace } from "../providers/workspace-provider";
import { useEntitlement } from "../hooks/use-entitlement";
import { UpgradeModal } from "./upgrade-modal";
import type { ModulePermission, WorkspaceRole } from "../features/workspaces/types";

import { Avatar, AvatarFallback } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";

type Props = {
  visible: boolean;
  onClose: () => void;
};

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

const ASSIGNABLE_ROLES: WorkspaceRole[] = ["viewer", "editor", "admin"];

function modulePermissionFor(role: WorkspaceRole): ModulePermission {
  if (role === "viewer") return "view";
  if (role === "admin" || role === "owner") return "admin";
  return "edit";
}

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
}: {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Invite role"
      className="inline-flex items-center gap-1"
    >
      {ASSIGNABLE_ROLES.map((role) => {
        const active = value === role;
        const meta = ROLE_META[role];
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
            {meta.label}
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

export function WorkspaceSettingsModal({ visible, onClose }: Props) {
  const {
    selectedWorkspace,
    canManageWorkspace,
    members,
    invites,
    sendInvite,
    revokeInvite,
    updateMemberPermissions,
    refreshAccessData,
  } = useWorkspace();
  const { allowed: canInvite } = useEntitlement("team_members");

  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [sending, setSending] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [lastIssuedToken, setLastIssuedToken] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    void refreshAccessData();
  }, [refreshAccessData, visible]);

  const handleSendInvite = async () => {
    if (!canInvite) {
      setUpgradeModalOpen(true);
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
        await navigator.clipboard.writeText(invite.token).catch(() => {});
      }
      setInviteEmail("");
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 2000);
    } finally {
      setSending(false);
    }
  };

  const handleRoleChange = async (memberId: string, role: WorkspaceRole) => {
    await updateMemberPermissions({
      memberId,
      role,
      modulePermissions: {
        notes: modulePermissionFor(role),
        tasks: modulePermissionFor(role),
      },
    });
  };

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );

  const inviteDisabled = sending || !inviteEmail.trim();

  return (
    <>
      <Dialog
        open={visible}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
                <Users className="size-4" aria-hidden />
              </span>
              <div className="flex flex-col">
                <DialogTitle className="font-display text-base text-foreground">
                  Workspace members
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {selectedWorkspace?.name ?? "—"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
            {!selectedWorkspace ? (
              <p className="text-sm text-muted-foreground">Select a workspace first.</p>
            ) : !canManageWorkspace ? (
              <p className="text-sm text-muted-foreground">
                Only owners and admins can manage members.
              </p>
            ) : (
              <div className="flex flex-col gap-7">
                {/* Invite section */}
                <section className="flex flex-col gap-3">
                  <header className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <UserPlus className="size-3" aria-hidden />
                    <span>Invite</span>
                  </header>

                  {!canInvite ? (
                    <button
                      type="button"
                      onClick={() => setUpgradeModalOpen(true)}
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
                      <span className="shrink-0 text-xs font-semibold text-warning">
                        Upgrade →
                      </span>
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
                          <Send className="size-3.5" aria-hidden />
                          {sending ? "Sending…" : sentFlash ? "Sent" : "Invite"}
                        </Button>
                      </div>

                      <div className="flex items-center gap-3">
                        <Label className="w-12 text-xs text-muted-foreground">Role</Label>
                        <RolePicker value={inviteRole} onChange={setInviteRole} />
                      </div>

                      {sentFlash && lastIssuedToken ? (
                        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2">
                          <Check className="size-3.5 text-success" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-success">
                              Invite code copied — share it with your teammate:
                            </p>
                            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                              {lastIssuedToken}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={async () => {
                              await navigator.clipboard
                                .writeText(lastIssuedToken)
                                .catch(() => {});
                            }}
                            aria-label="Copy invite code again"
                            className="h-6 w-6"
                          >
                            <Copy className="size-3" aria-hidden />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>

                {/* Members */}
                <section className="flex flex-col gap-3">
                  <header className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Users className="size-3" aria-hidden />
                    <span>Members · {members.length}</span>
                  </header>

                  <ul className="flex flex-col gap-1.5">
                    {members.map((member) => {
                      const isOwner = member.role === "owner";
                      return (
                        <li
                          key={member.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <MemberAvatar email={member.userId} />
                            <p className="truncate text-sm text-foreground">
                              {member.userId.length > 20
                                ? `${member.userId.slice(0, 8)}…${member.userId.slice(-4)}`
                                : member.userId}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <RoleBadge role={member.role} />
                            {!isOwner ? (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Change role"
                                    className="h-6 w-6"
                                  >
                                    <MoreHorizontal className="size-3.5" aria-hidden />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="end"
                                  sideOffset={4}
                                  className="w-40 p-1"
                                >
                                  {ASSIGNABLE_ROLES.map((role) => {
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
                                  })}
                                </PopoverContent>
                              </Popover>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {/* Pending invites */}
                {pendingInvites.length > 0 ? (
                  <section className="flex flex-col gap-3">
                    <header className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <Mail className="size-3" aria-hidden />
                      <span>Pending · {pendingInvites.length}</span>
                    </header>

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
                                aria-label="Copy invite code"
                                title="Copy invite code"
                                className="h-6 w-6"
                                onClick={async () => {
                                  await navigator.clipboard
                                    .writeText(invite.token!)
                                    .catch(() => {});
                                  setCopiedInviteId(invite.id);
                                  setTimeout(() => setCopiedInviteId(null), 2000);
                                }}
                              >
                                {copiedInviteId === invite.id ? (
                                  <Check className="size-3 text-success" aria-hidden />
                                ) : (
                                  <Copy className="size-3" aria-hidden />
                                )}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Revoke invite"
                              onClick={() => void revokeInvite(invite.id)}
                              className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            >
                              <X className="size-3.5" aria-hidden />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <UpgradeModal
        visible={upgradeModalOpen}
        feature="team_members"
        onClose={() => setUpgradeModalOpen(false)}
      />
    </>
  );
}
