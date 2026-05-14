import { useState } from "react";
import { Plus, Settings2 } from "lucide-react";

import { WorkspaceSettingsModal } from "../../../components/workspace-settings-modal";
import { UpgradeModal } from "../../../components/upgrade-modal";
import { useWorkspace } from "../../../providers/workspace-provider";
import { useEntitlement } from "../../../hooks/use-entitlement";
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

import { SettingsSectionShell } from "./section-shell";

export function WorkspaceSection() {
  const {
    workspaces,
    selectedWorkspace,
    canManageWorkspace,
    members,
    invites,
    createWorkspace,
    selectWorkspace,
  } = useWorkspace();
  const { allowed: canAddWorkspace } = useEntitlement("unlimited_workspaces");
  const [modalOpen, setModalOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [newName, setNewName] = useState("New Workspace");
  const [submitting, setSubmitting] = useState(false);

  const memberCount = members.length;
  const inviteCount = invites.length;
  const subtitle = canManageWorkspace
    ? `${memberCount} member${memberCount === 1 ? "" : "s"} · ${inviteCount} pending invite${inviteCount === 1 ? "" : "s"}`
    : "Only owners and admins can manage workspace members.";

  const openAddDialog = () => {
    if (workspaces.length >= 1 && !canAddWorkspace) {
      setUpgradeOpen(true);
      return;
    }
    setNewName("New Workspace");
    setAddOpen(true);
  };

  const submitAddWorkspace = async () => {
    if (submitting) return;
    const name = newName.trim() || "New Workspace";
    setSubmitting(true);
    try {
      const workspaceId = await createWorkspace(name);
      if (workspaceId) {
        selectWorkspace(workspaceId);
        setAddOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsSectionShell
      title="Workspace"
      description="Members, invites, and per-module permissions for this workspace."
    >
      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-border bg-muted text-foreground">
            <Settings2 className="size-5" />
          </span>
          <div className="flex-1">
            <h3 className="font-display text-lg text-foreground">
              {selectedWorkspace?.name ?? "No workspace selected"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-4 flex flex-row items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModalOpen(true)}
                disabled={!selectedWorkspace}
              >
                Open workspace settings
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openAddDialog}
              >
                <Plus className="size-4" aria-hidden />
                Add workspace
              </Button>
            </div>
          </div>
        </div>
      </section>

      <WorkspaceSettingsModal visible={modalOpen} onClose={() => setModalOpen(false)} />

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (!next && submitting) return;
          setAddOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>
              Create a separate workspace to keep notes, projects, and integrations isolated from this one.
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
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Creating…" : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <UpgradeModal
        visible={upgradeOpen}
        feature="unlimited_workspaces"
        onClose={() => setUpgradeOpen(false)}
      />
    </SettingsSectionShell>
  );
}
