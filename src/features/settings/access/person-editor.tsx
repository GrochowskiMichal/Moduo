import { Crown, RotateCcw, UserMinus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useWorkspace } from "../../../providers/workspace-provider";
import {
  canManageMember,
  cellState,
  countOverrides,
  describeKey,
  explainCell,
  grantRefusal,
  type Overrides,
  type PermissionKey,
  resolvePermissions,
  toggleOverride,
  type WorkspaceRoleDef,
} from "../../workspaces/access";
import type { WorkspaceMember } from "../../workspaces/types";
import {
  ExplainStrip,
  firstName,
  friendlyError,
  PaneHeader,
  PersonAvatar,
  SaveBar,
} from "./access-ui";
import {
  PermissionMatrix,
  PersonCell,
  type PersonCellVisual,
  PersonLegend,
} from "./permission-matrix";

function sameOverrides(a: Overrides, b: Overrides): boolean {
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => a[k as PermissionKey] === b[k as PermissionKey])
  );
}

export function memberLabel(member: WorkspaceMember): string {
  return member.displayName?.trim() || "Unnamed member";
}

export function PersonEditor({
  member,
  isWorkspaceOwner,
  isSelf,
  onDirtyChange,
  onRemoved,
}: {
  member: WorkspaceMember;
  isWorkspaceOwner: boolean;
  isSelf: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onRemoved: () => void;
}) {
  const { selectedWorkspace, myPerms, roles, setMemberAccess, removeMember, transferOwnership } =
    useWorkspace();
  const actorIsOwner = selectedWorkspace?.role === "owner";
  const name = memberLabel(member);
  const first = firstName(name);

  const [roleId, setRoleId] = useState<string | null>(member.roleId);
  const [overrides, setOverrides] = useState<Overrides>(member.overrides);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<PermissionKey | null>(null);
  const [confirm, setConfirm] = useState<"remove" | "owner" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRoleId(member.roleId);
    setOverrides(member.overrides);
    setError(null);
  }, [member]);

  const role: WorkspaceRoleDef | null = roles.find((r) => r.id === roleId) ?? null;
  const dirty = roleId !== member.roleId || !sameOverrides(overrides, member.overrides);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const canManage = canManageMember({
    actorIsOwner,
    actorPerms: myPerms,
    targetIsOwner: isWorkspaceOwner,
    targetPerms: member.perms,
    isSelf,
  });

  const manageReason = (() => {
    if (isWorkspaceOwner) return `${first} owns this workspace and can do everything.`;
    if (isSelf) return "This is your access. Someone who manages members can change it.";
    if (canManage) return null;
    if (!actorIsOwner && !myPerms.includes("ws.manage_members")) {
      return "Your role can't change people's access.";
    }
    return `${first} can manage members or roles too, so only the owner can change their access.`;
  })();

  const resulting = useMemo(
    () => (role ? resolvePermissions(role.permissions, role.readOnly, overrides) : []),
    [overrides, role],
  );
  const refusal = canManage ? grantRefusal(actorIsOwner, myPerms, resulting) : null;

  const visualFor = (key: PermissionKey): PersonCellVisual => {
    if (isWorkspaceOwner) return "on";
    if (!role) return "off";
    const s = cellState(key, role, overrides);
    if (s.ceiling) return "locked";
    if (s.needsView) return "needs-view";
    if (s.override === "allow" && s.effective) return "allow";
    if (s.override === "block") return "block";
    return s.effective ? "on" : "off";
  };

  const explain = (() => {
    if (focusKey) {
      if (isWorkspaceOwner)
        return `${first} can ${describeKey(focusKey)}: they own this workspace.`;
      if (role) return explainCell(first, role.name, cellState(focusKey, role, overrides));
    }
    if (refusal && dirty) return refusal;
    if (manageReason) return manageReason;
    const n = countOverrides(overrides);
    return n === 0
      ? `Exactly the ${role?.name ?? "role"} permissions. Click any square to make a personal exception.`
      : `${n} personal exception${n === 1 ? "" : "s"} on top of ${role?.name ?? "the role"}. Click a square again to put it back.`;
  })();

  const save = async () => {
    if (!roleId) return;
    if (refusal) {
      setError(refusal);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setMemberAccess(member.id, roleId, overrides);
      toast.success(`Updated ${first}'s access`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  // Roles this actor may hand out (whole role must be grantable, ≙ the op).
  const roleOptionReason = (r: WorkspaceRoleDef): string | null =>
    canManage
      ? grantRefusal(actorIsOwner, myPerms, resolvePermissions(r.permissions, r.readOnly, {}))
      : null;

  const overrideCount = countOverrides(overrides);

  return (
    <div className="flex flex-col gap-5">
      <PaneHeader
        leading={<PersonAvatar name={name} avatarUrl={member.avatarUrl} size="default" />}
        title={
          <>
            <span className="truncate">{name}</span>
            {isSelf ? <span className="text-sm text-muted-foreground">You</span> : null}
            {isWorkspaceOwner ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                <Crown className="size-3" aria-hidden />
                Owner
              </span>
            ) : null}
          </>
        }
        subtitle={
          member.joinedAt
            ? `Joined ${new Date(member.joinedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
            : undefined
        }
        actions={
          isWorkspaceOwner ? null : (
            <Select
              value={roleId ?? undefined}
              onValueChange={(next) => setRoleId(next)}
              disabled={!canManage}
            >
              <SelectTrigger size="sm" className="w-40" aria-label={`${first}'s role`}>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => {
                  const reason = roleOptionReason(r);
                  return (
                    <SelectItem key={r.id} value={r.id} disabled={!!reason}>
                      {r.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )
        }
      />

      {!isWorkspaceOwner && overrideCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {overrideCount} personal exception{overrideCount === 1 ? "" : "s"} on top of{" "}
            {role?.name}
          </span>
          {canManage ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setOverrides({})}>
              <RotateCcw aria-hidden />
              Reset to role
            </Button>
          ) : null}
        </div>
      ) : null}

      <PermissionMatrix
        onFocusKey={setFocusKey}
        renderCell={(key) => {
          const visual = visualFor(key);
          const interactive = canManage && !!role && visual !== "locked";
          return (
            <PersonCell
              label={`${describeKey(key)}: ${visual === "on" || visual === "allow" ? "allowed" : "not allowed"}`}
              visual={visual}
              interactive={interactive}
              onToggle={() => {
                if (!role) return;
                const next = toggleOverride(key, role, overrides);
                const nextPerms = resolvePermissions(role.permissions, role.readOnly, next);
                const why = grantRefusal(actorIsOwner, myPerms, nextPerms);
                if (why && nextPerms.length >= resulting.length) {
                  toast.error(why);
                  return;
                }
                setOverrides(next);
              }}
            />
          );
        }}
      />

      <PersonLegend />
      <ExplainStrip>{explain}</ExplainStrip>

      {canManage || (actorIsOwner && !isWorkspaceOwner && !isSelf) ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {actorIsOwner && !isWorkspaceOwner && !isSelf ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm("owner")}>
              <Crown aria-hidden />
              Make owner
            </Button>
          ) : null}
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirm("remove")}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <UserMinus aria-hidden />
              Remove from workspace
            </Button>
          ) : null}
        </div>
      ) : null}

      <SaveBar
        dirty={dirty && canManage}
        saving={saving}
        error={error}
        impact={
          role && roleId !== member.roleId
            ? `${first} moves to ${role.name}${overrideCount ? ", keeping their exceptions" : ""}`
            : null
        }
        onDiscard={() => {
          setRoleId(member.roleId);
          setOverrides(member.overrides);
          setError(null);
        }}
        onSave={() => void save()}
      />

      <Dialog open={confirm !== null} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "owner" ? `Make ${first} the owner?` : `Remove ${first}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm === "owner"
                ? `${first} gets full control, including billing and deleting the workspace. You become an Admin. Only ${first} can undo this.`
                : `${first} loses access to this workspace right away. Anything they created stays. You can invite them again later.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirm === "owner" ? "default" : "destructive"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (confirm === "owner") {
                    await transferOwnership(member.id);
                    toast.success(`${first} now owns this workspace`);
                  } else {
                    await removeMember(member.id);
                    toast.success(`Removed ${first}`);
                    onRemoved();
                  }
                  setConfirm(null);
                } catch (err) {
                  toast.error(friendlyError(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirm === "owner" ? "Make owner" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
