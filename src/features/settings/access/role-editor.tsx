import { Copy, Lock, Trash2 } from "lucide-react";
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
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { useWorkspace } from "../../../providers/workspace-provider";
import {
  describeKey,
  MANAGEMENT_POWERS,
  type PermissionKey,
  resolvePermissions,
  type WorkspaceRoleDef,
} from "../../workspaces/access";
import type { WorkspaceMember } from "../../workspaces/types";
import { ExplainStrip, friendlyError, PaneHeader, SaveBar } from "./access-ui";
import { PermissionMatrix, RoleCell } from "./permission-matrix";

type Draft = {
  name: string;
  description: string;
  permissions: PermissionKey[];
  readOnly: boolean;
};

function draftOf(role: WorkspaceRoleDef): Draft {
  return {
    name: role.name,
    description: role.description,
    permissions: [...role.permissions],
    readOnly: role.readOnly,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.readOnly === b.readOnly &&
    a.permissions.length === b.permissions.length &&
    a.permissions.every((k) => b.permissions.includes(k))
  );
}

/** Toggle a key with the module rules: no create/edit/delete without view. */
function toggleKey(perms: PermissionKey[], key: PermissionKey): PermissionKey[] {
  const set = new Set(perms);
  const [module, action] = key.split(".");
  if (set.has(key)) {
    set.delete(key);
    if (module !== "ws" && action === "view") {
      for (const a of ["create", "edit", "delete"]) set.delete(`${module}.${a}` as PermissionKey);
    }
  } else {
    set.add(key);
    if (module !== "ws" && action !== "view") set.add(`${module}.view` as PermissionKey);
  }
  return resolvePermissions([...set], false, {});
}

export type RoleEditorTarget =
  | { kind: "existing"; role: WorkspaceRoleDef }
  | { kind: "new"; from: WorkspaceRoleDef | null };

export function RoleEditor({
  target,
  members,
  onDirtyChange,
  onSaved,
  onDeleted,
  onDuplicate,
}: {
  target: RoleEditorTarget;
  members: WorkspaceMember[];
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (role: WorkspaceRoleDef) => void;
  onDeleted: () => void;
  onDuplicate: (role: WorkspaceRoleDef) => void;
}) {
  const { selectedWorkspace, myPerms, roles, upsertRole, deleteRole, refreshAccessData } =
    useWorkspace();
  const isOwner = selectedWorkspace?.role === "owner";
  const myRoleId = selectedWorkspace?.roleId ?? null;

  const base: Draft = useMemo(() => {
    if (target.kind === "existing") return draftOf(target.role);
    const from = target.from;
    // A copy only keeps what this person may hand out (owners: everything).
    const grantable = (k: PermissionKey) =>
      isOwner || (myPerms.includes(k) && !(MANAGEMENT_POWERS as readonly string[]).includes(k));
    return {
      name: from ? `${from.name} copy` : "New role",
      description: from?.description ?? "",
      permissions: (from
        ? [...from.permissions]
        : (["notes.view", "tasks.view"] as PermissionKey[])
      ).filter(grantable),
      readOnly: from?.readOnly ?? false,
    };
  }, [isOwner, myPerms, target]);

  const [draft, setDraft] = useState<Draft>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<PermissionKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setDraft(base);
    setError(null);
  }, [base]);

  const isNew = target.kind === "new";
  const role = target.kind === "existing" ? target.role : null;
  const dirty = isNew || !sameDraft(draft, base);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const holders = role ? members.filter((m) => m.roleId === role.id && m.role !== "owner") : [];

  // Why this whole role is read-only for the viewer (mirrors workspace_op_role_upsert).
  const lockReason = useMemo(() => {
    if (!isOwner && !myPerms.includes("ws.manage_roles")) {
      return "Your role can't change roles. Ask the owner or an admin.";
    }
    if (isOwner || !role) return null;
    if (role.id === myRoleId) return "You can't change the role you have yourself.";
    const holdersManage = members.some(
      (m) =>
        m.roleId === role.id &&
        m.perms.some((k) => (MANAGEMENT_POWERS as readonly string[]).includes(k)),
    );
    if (
      role.permissions.some((k) => (MANAGEMENT_POWERS as readonly string[]).includes(k)) ||
      holdersManage
    ) {
      return "People with this role can manage members or roles, so only the owner can change it.";
    }
    if (!role.permissions.every((k) => myPerms.includes(k))) {
      return "This role has permissions you don't have, so only the owner can change it.";
    }
    return null;
  }, [isOwner, members, myPerms, myRoleId, role]);
  const editable = !lockReason;

  const cellReason = (key: PermissionKey): string | null => {
    if (!editable) return lockReason;
    if (isOwner) return null;
    if ((MANAGEMENT_POWERS as readonly string[]).includes(key)) {
      return "Only the owner can give member or role management.";
    }
    if (!myPerms.includes(key) && !draft.permissions.includes(key)) {
      return "You don't have this permission yourself, so you can't give it.";
    }
    return null;
  };

  const isSystem = !!role?.systemKey;
  const nameError =
    draft.name.trim().length === 0
      ? "Give the role a name."
      : draft.name.trim().length > 40
        ? "Keep it under 40 characters."
        : roles.some(
              (r) =>
                r.id !== role?.id &&
                r.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
            )
          ? "There's already a role with this name."
          : null;

  const save = async () => {
    if (nameError) {
      setError(nameError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertRole({
        roleId: role?.id ?? null,
        name: draft.name.trim(),
        description: draft.description.trim(),
        permissions: draft.permissions,
        readOnly: draft.readOnly,
        expectedUpdatedAt: role?.updatedAt ?? null,
      });
      toast.success(isNew ? `Created ${draft.name.trim()}` : `Saved ${draft.name.trim()}`);
      if (saved) onSaved(saved);
    } catch (err) {
      const message = friendlyError(err);
      setError(message);
      // Someone else saved first: pull their version so "Discard" shows it.
      if (/someone else/i.test(message)) void refreshAccessData();
    } finally {
      setSaving(false);
    }
  };

  const explain = (() => {
    if (focusKey) {
      const on = resolvePermissions(draft.permissions, draft.readOnly, {}).includes(focusKey);
      if (draft.readOnly && !focusKey.endsWith(".view")) {
        return `Read-only: nobody with ${draft.name.trim() || "this role"} can ${describeKey(focusKey)}, whatever exceptions say.`;
      }
      return `${draft.name.trim() || "This role"} ${on ? "can" : "can't"} ${describeKey(focusKey)}.`;
    }
    if (lockReason) return lockReason;
    if (isNew)
      return "Pick what people with this role can do. You can fine-tune individuals later.";
    return holders.length === 0
      ? "Nobody has this role yet."
      : `Changes apply to ${holders.length} ${holders.length === 1 ? "person" : "people"} right away. Their personal exceptions stay.`;
  })();

  const effective = resolvePermissions(draft.permissions, draft.readOnly, {});

  return (
    <div className="flex flex-col gap-5">
      <PaneHeader
        leading={null}
        title={
          <>
            <span className="truncate">{isNew ? "New role" : role?.name}</span>
            {isSystem ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                Built-in
              </span>
            ) : null}
            {draft.readOnly ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                <Lock className="size-3" aria-hidden />
                Read-only
              </span>
            ) : null}
          </>
        }
        subtitle={
          role ? `${holders.length} ${holders.length === 1 ? "person" : "people"}` : undefined
        }
        actions={
          role ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDuplicate(role)}
                disabled={!isOwner && !myPerms.includes("ws.manage_roles")}
              >
                <Copy aria-hidden />
                Duplicate
              </Button>
              {!isSystem ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  disabled={!editable}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            value={draft.name}
            maxLength={40}
            disabled={!editable || isSystem}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            aria-invalid={!!nameError && dirty}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-description">Description</Label>
          <Input
            id="role-description"
            value={draft.description}
            maxLength={200}
            placeholder="What this role is for"
            disabled={!editable}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </div>
      </div>

      {!isSystem ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <div className="flex min-w-0 flex-col">
            <Label htmlFor="role-read-only">Read-only role</Label>
            <span className="text-xs text-muted-foreground">
              People with this role can only look — no exception can let them edit.
            </span>
          </div>
          <Switch
            id="role-read-only"
            checked={draft.readOnly}
            disabled={!editable}
            onCheckedChange={(checked) =>
              setDraft((d) => ({
                ...d,
                readOnly: checked,
                permissions: checked
                  ? d.permissions.filter((k) => k.endsWith(".view"))
                  : d.permissions,
              }))
            }
          />
        </div>
      ) : null}

      <PermissionMatrix
        onFocusKey={setFocusKey}
        renderCell={(key) => {
          const locked = draft.readOnly && !key.endsWith(".view");
          return (
            <RoleCell
              label={`${describeKey(key)}: ${effective.includes(key) ? "allowed" : "not allowed"}`}
              checked={effective.includes(key)}
              locked={locked}
              disabledReason={cellReason(key)}
              onToggle={() =>
                setDraft((d) => ({ ...d, permissions: toggleKey(d.permissions, key) }))
              }
            />
          );
        }}
      />

      <ExplainStrip>{explain}</ExplainStrip>

      <SaveBar
        dirty={dirty && editable}
        saving={saving}
        error={error}
        impact={
          isNew
            ? null
            : holders.length > 0
              ? `Applies to ${holders.length} ${holders.length === 1 ? "person" : "people"}`
              : null
        }
        onDiscard={() => {
          setDraft(base);
          setError(null);
          if (isNew) onDeleted();
        }}
        onSave={() => void save()}
      />

      {role && !isSystem ? (
        <DeleteRoleDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          role={role}
          holders={holders.length}
          roles={
            isOwner
              ? roles
              : roles.filter(
                  (r) =>
                    r.permissions.every((k) => myPerms.includes(k)) &&
                    !r.permissions.some((k) =>
                      (MANAGEMENT_POWERS as readonly string[]).includes(k),
                    ),
                )
          }
          onConfirm={async (reassignTo) => {
            try {
              await deleteRole(role.id, reassignTo);
              toast.success(`Deleted ${role.name}`);
              setDeleteOpen(false);
              onDeleted();
            } catch (err) {
              toast.error(friendlyError(err));
            }
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteRoleDialog({
  open,
  onOpenChange,
  role,
  holders,
  roles,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: WorkspaceRoleDef;
  holders: number;
  roles: WorkspaceRoleDef[];
  onConfirm: (reassignTo: string) => Promise<void>;
}) {
  const options = roles.filter((r) => r.id !== role.id);
  const fallback = options.find((r) => r.systemKey === "member") ?? options[0];
  const [reassign, setReassign] = useState<string>(fallback?.id ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReassign(fallback?.id ?? "");
  }, [open, fallback?.id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {role.name}?</DialogTitle>
          <DialogDescription>
            {holders > 0
              ? `${holders} ${holders === 1 ? "person has" : "people have"} this role. Pick the role they move to — their personal exceptions stay. Pending invites move too.`
              : "Nobody has this role. Pending invites with it move to the role you pick."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reassign-role">Move people to</Label>
          <Select value={reassign} onValueChange={setReassign}>
            <SelectTrigger id="reassign-role">
              <SelectValue placeholder="Pick a role" />
            </SelectTrigger>
            <SelectContent>
              {options.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!reassign || busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reassign);
              setBusy(false);
            }}
          >
            {busy ? "Deleting…" : "Delete role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
