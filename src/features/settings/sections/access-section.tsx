import { Lock, Plus, UserPlus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { cn } from "../../../lib/utils";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { ChatCapsPanel } from "../../sharing/chat-caps-panel";
import { ShareDefaultsPanel } from "../../sharing/share-defaults-panel";
import { countOverrides, type WorkspaceRoleDef } from "../../workspaces/access";
import { PersonAvatar } from "../access/access-ui";
import { InvitePanel } from "../access/invite-panel";
import { memberLabel, PersonEditor } from "../access/person-editor";
import { RoleEditor, type RoleEditorTarget } from "../access/role-editor";
import { SettingsSectionShell } from "./section-shell";

type Selection =
  | { kind: "role"; id: string }
  | { kind: "new-role"; fromId: string | null; nonce: number }
  | { kind: "person"; id: string }
  | { kind: "invite" }
  | { kind: "defaults" }
  | { kind: "chat" };

function RailItem({
  selected,
  onSelect,
  children,
  trailing,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-[var(--motion-fade)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-(--selected-bg) text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {trailing ? (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{trailing}</span>
      ) : null}
    </button>
  );
}

/**
 * Settings → Members & access (PERM-1/2, specs/permissions.md).
 *
 * Roles (what kinds of things people can do) + people (role + personal
 * exceptions) + invites, in one master/detail pane. Everything here is
 * enforced in Postgres; the UI mirrors the same rules to explain them and to
 * disable what would be refused.
 */
export function AccessSection() {
  const { userId } = useAuth();
  const { selectedWorkspace, members, roles, invites, myPerms, refreshAccessData } = useWorkspace();
  const isOwner = selectedWorkspace?.role === "owner";
  const canInvite = isOwner || myPerms.includes("ws.invite");
  const canManageRoles = isOwner || myPerms.includes("ws.manage_roles");

  useEffect(() => {
    void refreshAccessData();
  }, [refreshAccessData]);

  const ownerUserId = useMemo(
    () => members.find((m) => m.role === "owner")?.userId ?? null,
    [members],
  );

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        if (a.userId === ownerUserId) return -1;
        if (b.userId === ownerUserId) return 1;
        return memberLabel(a).localeCompare(memberLabel(b));
      }),
    [members, ownerUserId],
  );

  const [selection, setSelection] = useState<Selection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<Selection | null>(null);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);

  // Default selection: yourself (everyone can see their own access).
  useEffect(() => {
    if (selection) return;
    const me = members.find((m) => m.userId === userId);
    if (me) setSelection({ kind: "person", id: me.id });
    else if (roles[0]) setSelection({ kind: "role", id: roles[0].id });
  }, [members, roles, selection, userId]);

  // A selected row that disappeared (removed person, deleted role) falls back.
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === "person" && !members.some((m) => m.id === selection.id))
      setSelection(null);
    if (
      selection.kind === "role" &&
      roles.length > 0 &&
      !roles.some((r) => r.id === selection.id)
    ) {
      setSelection(null);
    }
  }, [members, roles, selection]);

  const select = (next: Selection) => {
    if (dirty) {
      setPending(next);
      return;
    }
    setSelection(next);
  };

  const roleTarget: RoleEditorTarget | null = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "role") {
      const role = roles.find((r) => r.id === selection.id);
      return role ? { kind: "existing", role } : null;
    }
    if (selection.kind === "new-role") {
      return {
        kind: "new",
        from:
          roles.find((r) => r.id === selection.fromId) ??
          roles.find((r) => r.systemKey === "member") ??
          null,
      };
    }
    return null;
    // `nonce` forces a fresh draft for each "New role" click.
  }, [roles, selection]);

  // The owner sits on the Admin role id but isn't governed by it — don't count them.
  const roleCount = (role: WorkspaceRoleDef) =>
    members.filter((m) => m.roleId === role.id && m.userId !== ownerUserId).length;
  const pendingInvites = invites.filter((i) => i.status === "pending");
  const selectedPerson =
    selection?.kind === "person" ? (members.find((m) => m.id === selection.id) ?? null) : null;

  if (!selectedWorkspace) {
    return (
      <SettingsSectionShell title="Members and access">
        <div className="rounded-lg border border-border bg-card px-6 py-5 text-sm text-muted-foreground">
          Select a workspace first.
        </div>
      </SettingsSectionShell>
    );
  }

  const rolesUnavailable = roles.length === 0;

  return (
    <SettingsSectionShell
      title="Members and access"
      description="Roles decide what kinds of things people can do. Personal exceptions fine-tune one person. The owner can always do everything."
      className="max-w-4xl"
    >
      {rolesUnavailable ? (
        <div className="rounded-lg border border-border bg-card px-6 py-5 text-sm text-muted-foreground">
          Roles are loading. If this stays empty, reload Moduo to pick up the latest update.
        </div>
      ) : (
        <div className="grid gap-6 rounded-lg border border-border bg-card p-4 md:grid-cols-[13rem_minmax(0,1fr)]">
          <nav
            aria-label="Roles and people"
            className="flex flex-col gap-4 md:border-r md:border-border md:pr-4"
          >
            <div className="flex flex-col gap-0.5">
              <Eyebrow className="px-2 pb-1">Roles</Eyebrow>
              {roles.map((role) => (
                <RailItem
                  key={role.id}
                  selected={selection?.kind === "role" && selection.id === role.id}
                  onSelect={() => select({ kind: "role", id: role.id })}
                  trailing={roleCount(role) || null}
                >
                  <span className="truncate">{role.name}</span>
                  {role.readOnly ? (
                    <Lock
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-label="Read-only"
                    />
                  ) : null}
                </RailItem>
              ))}
              {canManageRoles ? (
                <RailItem
                  selected={selection?.kind === "new-role"}
                  onSelect={() => select({ kind: "new-role", fromId: null, nonce: Date.now() })}
                >
                  <Plus className="size-3.5 shrink-0" aria-hidden />
                  <span>New role</span>
                </RailItem>
              ) : null}
            </div>

            <div className="flex flex-col gap-0.5">
              <Eyebrow className="px-2 pb-1">People · {members.length}</Eyebrow>
              {sortedMembers.map((member) => {
                const n = countOverrides(member.overrides);
                const isOwnerRow = member.userId === ownerUserId;
                return (
                  <RailItem
                    key={member.id}
                    selected={selection?.kind === "person" && selection.id === member.id}
                    onSelect={() => select({ kind: "person", id: member.id })}
                    trailing={isOwnerRow ? "Owner" : n > 0 ? `${n} exc.` : null}
                  >
                    <PersonAvatar name={memberLabel(member)} avatarUrl={member.avatarUrl} />
                    <span className="truncate">
                      {memberLabel(member)}
                      {member.userId === userId ? (
                        <span className="text-muted-foreground"> · You</span>
                      ) : null}
                    </span>
                  </RailItem>
                );
              })}
              {canInvite ? (
                <RailItem
                  selected={selection?.kind === "invite"}
                  onSelect={() => select({ kind: "invite" })}
                  trailing={pendingInvites.length || null}
                >
                  <UserPlus className="size-3.5 shrink-0" aria-hidden />
                  <span>Invite people</span>
                </RailItem>
              ) : null}
              {/* Workspace-wide settings: the server only lets role managers save them. */}
              {canManageRoles ? (
                <>
                  <RailItem
                    selected={selection?.kind === "defaults"}
                    onSelect={() => select({ kind: "defaults" })}
                  >
                    <span>Defaults</span>
                  </RailItem>
                  <RailItem
                    selected={selection?.kind === "chat"}
                    onSelect={() => select({ kind: "chat" })}
                  >
                    <span>Chat</span>
                  </RailItem>
                </>
              ) : null}
            </div>
          </nav>

          <div className="min-w-0">
            {selection?.kind === "invite" ? (
              <InvitePanel />
            ) : selection?.kind === "defaults" && selectedWorkspace ? (
              <ShareDefaultsPanel workspaceId={selectedWorkspace.id} />
            ) : selection?.kind === "chat" && selectedWorkspace ? (
              <ChatCapsPanel workspaceId={selectedWorkspace.id} />
            ) : selectedPerson ? (
              <PersonEditor
                key={selectedPerson.id}
                member={selectedPerson}
                isWorkspaceOwner={selectedPerson.userId === ownerUserId}
                isSelf={selectedPerson.userId === userId}
                onDirtyChange={onDirtyChange}
                onRemoved={() => {
                  setDirty(false);
                  setSelection(null);
                }}
              />
            ) : roleTarget ? (
              <RoleEditor
                key={
                  selection?.kind === "new-role"
                    ? `new-${selection.nonce}`
                    : roleTarget.kind === "existing"
                      ? roleTarget.role.id
                      : "new"
                }
                target={roleTarget}
                members={members}
                onDirtyChange={onDirtyChange}
                onSaved={(role) => {
                  setDirty(false);
                  setSelection({ kind: "role", id: role.id });
                }}
                onDeleted={() => {
                  setDirty(false);
                  setSelection(null);
                }}
                onDuplicate={(role) =>
                  select({ kind: "new-role", fromId: role.id, nonce: Date.now() })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">Pick a role or a person.</p>
            )}
          </div>
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? null : setPending(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You changed permissions here but didn't save them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setDirty(false);
                setSelection(pending);
                setPending(null);
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSectionShell>
  );
}
