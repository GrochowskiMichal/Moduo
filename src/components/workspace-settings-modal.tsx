import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  MoreHorizontal,
  Plus,
  Shield,
  User,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../providers/auth-provider";
import { useWorkspace } from "../providers/workspace-provider";
import type { WorkspaceApiKey } from "../lib/runtime";
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
  DialogFooter,
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

type KeyScope = "view" | "edit";

function keyScope(key: WorkspaceApiKey): KeyScope {
  return key.scopes?.tasks === "edit" ? "edit" : "view";
}

/**
 * Workspace API keys for the Moduo MCP connector (docs/moduo-mcp-connector.md).
 * Keys are workspace-scoped, read-only by default; the secret is shown exactly
 * once at creation. Owner/admin only (the modal already gates on
 * canManageWorkspace; RLS enforces it server-side regardless).
 */
function ApiKeysSection({ workspaceId }: { workspaceId: string }) {
  const { runtime } = useAuth();
  const [keys, setKeys] = useState<WorkspaceApiKey[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<KeyScope>("view");
  const [creating, setCreating] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<"secret" | "endpoint" | null>(null);
  // Revoke is instant + irreversible (the secret can't be re-shown), so it
  // confirms first — the confirm-not-undo half of the DF-5 grammar.
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceApiKey | null>(null);

  const refresh = useCallback(async () => {
    if (!runtime) return;
    try {
      setKeys(await runtime.workspace.listApiKeys(workspaceId));
    } catch {
      // Non-managers can't read keys; the section is already gated, so stay quiet.
    }
  }, [runtime, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = async (text: string, what: "secret" | "endpoint") => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = async () => {
    if (!runtime || creating) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const created = await runtime.workspace.createApiKey({
        workspaceId,
        name: trimmed,
        scopes: { tasks: scope },
      });
      setRevealedSecret(created.secret);
      setName("");
      setScope("view");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the key.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: WorkspaceApiKey) => {
    if (!runtime) return;
    try {
      await runtime.workspace.revokeApiKey(key.id);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke the key.");
    }
  };

  const endpoint = runtime?.workspace.getMcpEndpoint() ?? "";

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <KeyRound className="size-3" aria-hidden />
        <span>API keys · MCP</span>
      </header>

      <p className="text-xs text-muted-foreground">
        Agents connect to this workspace over MCP. Keys are read-only by default,
        and everything a key does is attributed in each task's activity trail.
      </p>

      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {endpoint}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Copy MCP endpoint"
          title="Copy MCP endpoint"
          className="h-6 w-6"
          onClick={() => void copy(endpoint, "endpoint")}
        >
          {copied === "endpoint" ? (
            <Check className="size-3 text-success" aria-hidden />
          ) : (
            <Copy className="size-3" aria-hidden />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Label htmlFor="api-key-name" className="sr-only">
            Key name
          </Label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Key name — e.g. Claude"
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreate();
            }}
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Key scope"
          className="inline-flex items-center gap-1"
        >
          {(["view", "edit"] as const).map((level) => (
            <Button
              key={level}
              type="button"
              variant={scope === level ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setScope(level)}
              aria-pressed={scope === level}
              className={scope === level ? "text-foreground" : "text-muted-foreground"}
            >
              {level === "view" ? "View" : "Edit"}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating || !name.trim()}
        >
          <Plus className="size-3.5" aria-hidden />
          {creating ? "Creating…" : "Create"}
        </Button>
      </div>

      {revealedSecret ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2">
          <Check className="size-3.5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-success">
              Key created — copy it now, it won't be shown again:
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {revealedSecret}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Copy API key"
            title="Copy API key"
            className="h-6 w-6"
            onClick={() => void copy(revealedSecret, "secret")}
          >
            {copied === "secret" ? (
              <Check className="size-3 text-success" aria-hidden />
            ) : (
              <Copy className="size-3" aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dismiss"
            className="h-6 w-6"
            onClick={() => setRevealedSecret(null)}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}

      {keys.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{key.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {key.keyPrefix}…
                  <span className="ml-2 font-sans">
                    {key.lastUsedAt
                      ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                      : "Never used"}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={keyScope(key) === "edit" ? "info" : "secondary"}>
                  Tasks · {keyScope(key) === "edit" ? "Edit" : "View"}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Revoke ${key.name}`}
                  title="Revoke key"
                  onClick={() => setRevokeTarget(key)}
                  className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No keys yet.</p>
      )}

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke {revokeTarget?.name || "this key"}?</DialogTitle>
            <DialogDescription>
              Anything connected with this key loses access immediately. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const key = revokeTarget;
                setRevokeTarget(null);
                if (key) void handleRevoke(key);
              }}
            >
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
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
    selectedWorkspaceId,
    canManageWorkspace,
    workspaces,
    members,
    invites,
    sendInvite,
    revokeInvite,
    updateMemberPermissions,
    removeMember,
    leaveWorkspace,
    refreshAccessData,
  } = useWorkspace();
  const { userId, runtime } = useAuth();
  const { allowed: canInvite } = useEntitlement("team_members");

  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [sending, setSending] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [lastIssuedToken, setLastIssuedToken] = useState<string | null>(null);
  const [copiedNew, setCopiedNew] = useState<"link" | "code" | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void refreshAccessData();
  }, [refreshAccessData, visible]);

  // Reset transient invite/leave UI whenever the modal closes or the workspace
  // changes, so a stale invite link/leave-confirm never bleeds across contexts.
  useEffect(() => {
    if (!visible) {
      setLastIssuedToken(null);
      setLeaveConfirm(false);
    }
  }, [visible]);
  useEffect(() => {
    setLastIssuedToken(null);
    setLeaveConfirm(false);
  }, [selectedWorkspaceId]);

  const lastInviteUrl = useMemo(
    () => (lastIssuedToken && runtime ? runtime.workspace.inviteUrl(lastIssuedToken) : null),
    [lastIssuedToken, runtime],
  );

  const inviteLinkFor = (token: string) => runtime?.workspace.inviteUrl(token) ?? token;

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
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't leave the workspace.");
    } finally {
      setLeaving(false);
      setLeaveConfirm(false);
    }
  };

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );

  const inviteDisabled = sending || !inviteEmail.trim();
  const shortId = (id: string) =>
    id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  // Owners transfer/delete rather than leave; and leaving your only workspace
  // would strand you at zero (the provider has no last-one guard), so gate on
  // both — mirrors the switcher's delete gate. DF-24 / gotchas §Routes.
  const canLeave = selectedWorkspace?.role !== "owner" && workspaces.length > 1;

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
            ) : (
              <div className="flex flex-col gap-7">
                {/* Invite — owners/admins only; everyone else gets the read-only
                    roster + Leave below instead of a dead-end wall. DF-24. */}
                {canManageWorkspace ? (
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
                          <UserPlus className="size-3.5" aria-hidden />
                          {sending ? "Creating…" : "Create invite"}
                        </Button>
                      </div>

                      <div className="flex items-center gap-3">
                        <Label className="w-12 text-xs text-muted-foreground">Role</Label>
                        <RolePicker value={inviteRole} onChange={setInviteRole} />
                      </div>

                      {lastIssuedToken ? (
                        <div className="flex flex-col gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5">
                          <div className="flex items-start gap-2">
                            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                            <p className="min-w-0 flex-1 text-xs text-success">
                              Invite created. Moduo doesn't email invites — send this
                              link to your teammate yourself:
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
                              await navigator.clipboard
                                .writeText(lastIssuedToken)
                                .catch(() => {});
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
                </section>
                ) : null}

                {/* Members */}
                <section className="flex flex-col gap-3">
                  <header className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Users className="size-3" aria-hidden />
                    <span>Members · {members.length}</span>
                  </header>

                  <ul className="flex flex-col gap-1.5">
                    {members.map((member) => {
                      const isOwner = member.role === "owner";
                      const isSelf = member.userId === userId;
                      const label = member.displayName?.trim() || shortId(member.userId);
                      // You manage OTHERS here (role + remove); you manage
                      // yourself via Leave, so the row menu is others-only.
                      const showMenu = canManageWorkspace && !isOwner && !isSelf;
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
                                <PopoverContent
                                  align="end"
                                  sideOffset={4}
                                  className="w-48 p-1"
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
                                </PopoverContent>
                              </Popover>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {/* Pending invites — managers only */}
                {canManageWorkspace && pendingInvites.length > 0 ? (
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
                  </section>
                ) : null}

                {/* MCP connector keys — managers only */}
                {canManageWorkspace ? (
                  <ApiKeysSection workspaceId={selectedWorkspace.id} />
                ) : null}

                {/* Leave workspace — non-owners with somewhere to land. Owners
                    transfer/delete instead; leaving your only workspace would
                    strand you at zero. DF-24. */}
                {canLeave ? (
                  <section className="flex flex-col gap-3 border-t border-border pt-5">
                    {!leaveConfirm ? (
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
                          Leave{" "}
                          <span className="font-semibold">{selectedWorkspace.name}</span>? You'll
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
                    )}
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
