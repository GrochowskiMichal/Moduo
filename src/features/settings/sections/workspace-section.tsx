import { LogOut, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { UpgradeModal } from "../../../components/upgrade-modal";
import type { WorkspaceRole } from "../../../features/workspaces/types";
import { useEntitlement } from "../../../hooks/use-entitlement";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { normalizeWorkspaceIcon } from "../../branding/image-asset";
import { clearWorkspaceLogo, uploadWorkspaceLogo } from "../../branding/upload-image";
import { WorkspaceMark, WorkspaceMarkPicker } from "../../workspaces/ui/workspace-mark";

import { dispatchOpenSettings } from "../settings-events";
import { SettingsSectionShell } from "./section-shell";
import { TaskKeyField } from "./task-key-field";

/** A labelled cluster (eyebrow above a card), mirroring the other settings sections. */
function WsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="px-1">{label}</Eyebrow>
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5">
        {children}
      </section>
    </div>
  );
}

// ── The section (DF-19e: workspace management inlined; the standalone modal retired) ──

export function WorkspaceSection() {
  const {
    workspaces,
    selectedWorkspace,
    selectedWorkspaceId,
    members,
    leaveWorkspace,
    renameWorkspace,
    updateWorkspaceBranding,
    setTaskKey,
    softDeleteWorkspace,
    createWorkspace,
    selectWorkspace,
    refreshAccessData,
  } = useWorkspace();

  const { allowed: canAddWorkspace } = useEntitlement("unlimited_workspaces");

  const callerRole: WorkspaceRole = selectedWorkspace?.role ?? "viewer";
  const isOwner = callerRole === "owner";

  // Invite / rename / add-workspace / danger-zone transient state.
  const [nameDraft, setNameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [upgradeAddOpen, setUpgradeAddOpen] = useState(false);
  const [newName, setNewName] = useState("New Workspace");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);

  // Refresh the roster when the section mounts (parity with the retired modal's
  // on-open refresh), and reset transient link/confirm state on workspace change.
  useEffect(() => {
    void refreshAccessData();
  }, [refreshAccessData]);
  useEffect(() => {
    // The section (unlike the retired modal) stays mounted across a mid-open
    // workspace switch (⌘⇧W), so reset every transient control — including the
    // transfer dialog, or confirming it would fire against a foreign member id.
    setLeaveConfirm(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
  }, []);
  useEffect(() => {
    setNameDraft(selectedWorkspace?.name ?? "");
  }, [selectedWorkspace?.name]);

  // Owners transfer/delete rather than leave; leaving your only workspace strands
  // you at zero (provider guards at <= 1). DF-24 / gotchas §Routes.
  const canLeave = callerRole !== "owner" && workspaces.length > 1;
  const canDelete = isOwner && workspaces.length > 1;
  const nameChanged = nameDraft.trim().length > 0 && nameDraft.trim() !== selectedWorkspace?.name;

  const applyBranding = async (branding: { icon: string | null; logoUrl: string | null }) => {
    if (!selectedWorkspaceId || markBusy) return;
    setMarkBusy(true);
    try {
      await updateWorkspaceBranding(selectedWorkspaceId, branding);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the workspace icon.");
    } finally {
      setMarkBusy(false);
    }
  };

  const handlePickIcon = (raw: string) => {
    const icon = normalizeWorkspaceIcon(raw);
    if (!icon) {
      toast.error("Use a single emoji.");
      return;
    }
    if (selectedWorkspaceId && selectedWorkspace?.logoUrl) {
      void clearWorkspaceLogo(selectedWorkspaceId).catch(() => {});
    }
    void applyBranding({ icon, logoUrl: null });
  };

  const handlePickLogo = async (file: File) => {
    if (!selectedWorkspaceId || markBusy) return;
    setMarkBusy(true);
    try {
      const logoUrl = await uploadWorkspaceLogo(selectedWorkspaceId, file);
      await updateWorkspaceBranding(selectedWorkspaceId, { icon: null, logoUrl });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the logo.");
    } finally {
      setMarkBusy(false);
    }
  };

  const handleClearMark = async () => {
    if (!selectedWorkspaceId || markBusy) return;
    setMarkBusy(true);
    try {
      await clearWorkspaceLogo(selectedWorkspaceId).catch(() => {});
      await updateWorkspaceBranding(selectedWorkspaceId, { icon: null, logoUrl: null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove the workspace icon.");
    } finally {
      setMarkBusy(false);
    }
  };

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

  return (
    <SettingsSectionShell
      title="Workspace"
      description="Name, mark, and the workspace itself. People and permissions are in Members and access."
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
              {isOwner ? (
                <WorkspaceMarkPicker
                  name={selectedWorkspace.name}
                  icon={selectedWorkspace.icon}
                  logoUrl={selectedWorkspace.logoUrl}
                  busy={markBusy}
                  className="size-10"
                  onPickIcon={handlePickIcon}
                  onPickLogo={(file) => void handlePickLogo(file)}
                  onInvalidLogo={(message) => toast.error(message)}
                  onClear={() => void handleClearMark()}
                />
              ) : (
                <WorkspaceMark
                  name={selectedWorkspace.name}
                  icon={selectedWorkspace.icon}
                  logoUrl={selectedWorkspace.logoUrl}
                  className="size-10"
                />
              )}
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

          {/* Task handles, MOD-142 (TV-D8). */}
          <WsGroup label="Tasks">
            <TaskKeyField
              taskKey={selectedWorkspace.taskKey}
              canEdit={isOwner}
              onSave={(key) => setTaskKey(selectedWorkspace.id, key)}
            />
          </WsGroup>

          {/* People, roles and invites moved to Members and access (PERM-2). */}
          <WsGroup label="People">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {members.length} {members.length === 1 ? "person" : "people"} in this workspace.
                Roles, personal exceptions, and invites live in Members and access.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatchOpenSettings({ section: "access" })}
              >
                Open
              </Button>
            </div>
          </WsGroup>

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
        visible={upgradeAddOpen}
        feature="unlimited_workspaces"
        onClose={() => setUpgradeAddOpen(false)}
      />
    </SettingsSectionShell>
  );
}
