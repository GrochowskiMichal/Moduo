import { Check, Crown, Link2, Mail, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { UpgradeModal } from "../../../components/upgrade-modal";
import { useEntitlement } from "../../../hooks/use-entitlement";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { grantRefusal, resolvePermissions, type WorkspaceRoleDef } from "../../workspaces/access";
import type { WorkspaceInvite, WorkspaceRole } from "../../workspaces/types";
import { friendlyError, PaneHeader } from "./access-ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tier text the legacy `role` column still carries (the role id is what counts). */
function tierFor(role: WorkspaceRoleDef): WorkspaceRole {
  if (role.systemKey === "admin") return "admin";
  if (role.systemKey === "viewer" || role.readOnly) return "viewer";
  return "editor";
}

function inviteError(err: unknown): string {
  const message = friendlyError(err);
  // The invite power is checked before we get here, so an RLS refusal on the
  // insert is the seat cap (workspace_seat_cap) — say that instead.
  if (message === "Your role doesn't allow this.") {
    return "There are no free seats on this plan. The owner can add seats in Billing.";
  }
  return message;
}

function expiresIn(iso: string | null): string {
  if (!iso) return "Pending";
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Expired";
  return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
}

export function InvitePanel() {
  const { runtime } = useAuth();
  const {
    selectedWorkspace,
    myPerms,
    roles,
    invites,
    members,
    sendInvite,
    updateInvite,
    revokeInvite,
  } = useWorkspace();
  const isOwner = selectedWorkspace?.role === "owner";
  const { allowed: planAllowsInvites } = useEntitlement("team_members");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const grantable = useMemo(
    () =>
      roles.filter(
        (r) => !grantRefusal(isOwner, myPerms, resolvePermissions(r.permissions, r.readOnly, {})),
      ),
    [isOwner, myPerms, roles],
  );
  const defaultRole = grantable.find((r) => r.systemKey === "member") ?? grantable[0] ?? null;

  const [email, setEmail] = useState("");
  const [existing, setExisting] = useState<"none" | "view" | "edit">("none");
  const firstInvite = members.filter((m) => m.isActive && !m.removedAt).length <= 1;
  const [roleId, setRoleId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const chosen = roles.find((r) => r.id === (roleId ?? defaultRole?.id)) ?? null;
  const pending = invites.filter((i) => i.status === "pending");
  const normalized = email.trim().toLowerCase();

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const send = async () => {
    if (isOwner && !planAllowsInvites) {
      setUpgradeOpen(true);
      return;
    }
    if (!EMAIL_RE.test(normalized)) {
      setError("Enter an email address like name@company.com.");
      return;
    }
    if (pending.some((i) => i.email.toLowerCase() === normalized)) {
      setError("There's already a pending invite for this email. Copy its link below.");
      return;
    }
    if (!chosen) {
      setError("Pick a role.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const invite = await sendInvite({
        email: normalized,
        role: tierFor(chosen),
        roleId: chosen.id,
        sharePayload: {
          existing: firstInvite ? existing : "none",
          resources: [],
        },
      });
      setEmail("");
      if (invite?.token && runtime) setLastLink(runtime.workspace.inviteUrl(invite.token));
      toast.success(`Invite ready for ${normalized}`);
    } catch (err) {
      setError(inviteError(err));
    } finally {
      setSending(false);
    }
  };

  const changeInviteRole = async (invite: WorkspaceInvite, nextId: string) => {
    const next = roles.find((r) => r.id === nextId);
    if (!next) return;
    try {
      await updateInvite({ inviteId: invite.id, role: tierFor(next), roleId: next.id });
      toast.success(`${invite.email} will join as ${next.name}`);
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PaneHeader
        title="Invite people"
        subtitle="They join with the role you pick. You can add personal exceptions once they're in."
      />

      {isOwner && !planAllowsInvites ? (
        <button
          type="button"
          onClick={() => setUpgradeOpen(true)}
          className="flex items-center justify-between gap-3 rounded-md border border-dashed border-warning/40 bg-warning/10 px-4 py-3 text-left transition-colors hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-3">
            <Crown className="size-3.5 text-warning" aria-hidden />
            <span className="text-sm text-warning">Upgrade to Duo or Team to invite people</span>
          </span>
          <span className="text-xs text-warning">Upgrade</span>
        </button>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Label htmlFor="access-invite-email" className="sr-only">
                Email
              </Label>
              <Input
                id="access-invite-email"
                type="email"
                value={email}
                placeholder="name@company.com"
                autoCapitalize="none"
                autoComplete="off"
                className="pl-9"
                aria-invalid={!!error}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <Select value={chosen?.id} onValueChange={(v) => setRoleId(v)}>
              <SelectTrigger className="sm:w-40" aria-label="Role">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id} disabled={!grantable.includes(r)}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={sending || normalized.length === 0}>
              <UserPlus aria-hidden />
              {sending ? "Creating…" : "Create invite"}
            </Button>
          </div>
          {firstInvite ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="invite-existing" className="text-xs text-muted-foreground">
                What can they see of what you already have?
              </Label>
              <Select
                value={existing}
                onValueChange={(v) => setExisting(v as "none" | "view" | "edit")}
              >
                <SelectTrigger id="invite-existing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nothing yet</SelectItem>
                  <SelectItem value="view">Everything, view only</SelectItem>
                  <SelectItem value="edit">Everything, can edit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {chosen ? (
            <p className="text-xs text-muted-foreground">
              {chosen.description || `Joins with the ${chosen.name} permissions.`}
              {grantable.length < roles.length
                ? " Roles with permissions you don't have can't be picked."
                : ""}
            </p>
          ) : null}
        </form>
      )}

      {lastLink ? (
        <div className="flex flex-col gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            <p className="min-w-0 flex-1 text-xs text-success">
              Invite created. Send them this link to join:
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss"
              onClick={() => setLastLink(null)}
              className="-mr-1 -mt-1 size-6"
            >
              <X aria-hidden />
            </Button>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {lastLink}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copy("new", lastLink)}
            >
              {copied === "new" ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-2xs text-muted-foreground">Pending · {pending.length}</span>
        {pending.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            No open invites.
          </p>
        ) : (
          <ul className="flex flex-col">
            {pending.map((invite) => {
              const current = roles.find((r) => r.id === invite.roleId) ?? null;
              const expired = expiresIn(invite.expiresAt) === "Expired";
              return (
                <li
                  key={invite.id}
                  className="flex items-center gap-3 border-t border-border py-2 first:border-t-0"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                    <Mail className="size-3" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">{invite.email}</span>
                    <span
                      className={
                        expired ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                      }
                    >
                      {expiresIn(invite.expiresAt)}
                    </span>
                  </div>
                  <Select
                    value={current?.id}
                    onValueChange={(v) => void changeInviteRole(invite, v)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-32"
                      aria-label={`Role for ${invite.email}`}
                    >
                      <SelectValue placeholder={current?.name ?? "Role"} />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id} disabled={!grantable.includes(r)}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {invite.token && runtime ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Copy invite link for ${invite.email}`}
                      onClick={() =>
                        void copy(invite.id, runtime.workspace.inviteUrl(invite.token!))
                      }
                    >
                      {copied === invite.id ? (
                        <Check className="text-success" aria-hidden />
                      ) : (
                        <Link2 aria-hidden />
                      )}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke invite for ${invite.email}`}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={async () => {
                      try {
                        await revokeInvite(invite.id);
                        toast.success(`Revoked ${invite.email}`);
                      } catch (err) {
                        toast.error(friendlyError(err));
                      }
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <UpgradeModal
        visible={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        feature="team_members"
      />
    </div>
  );
}
