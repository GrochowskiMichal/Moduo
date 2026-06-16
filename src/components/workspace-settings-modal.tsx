import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  KeyRound,
  Mail,
  MoreHorizontal,
  Plus,
  Send,
  Shield,
  User,
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
                  onClick={() => void handleRevoke(key)}
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

                {/* MCP connector keys */}
                <ApiKeysSection workspaceId={selectedWorkspace.id} />
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
