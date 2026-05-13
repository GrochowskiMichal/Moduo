import { useState } from "react";
import { Settings2 } from "lucide-react";

import { WorkspaceSettingsModal } from "../../../components/workspace-settings-modal";
import { useWorkspace } from "../../../providers/workspace-provider";
import { Button } from "../../../components/ui/button";

import { SettingsSectionShell } from "./section-shell";

export function WorkspaceSection() {
  const { selectedWorkspace, canManageWorkspace, members, invites } = useWorkspace();
  const [modalOpen, setModalOpen] = useState(false);

  const memberCount = members.length;
  const inviteCount = invites.length;
  const subtitle = canManageWorkspace
    ? `${memberCount} member${memberCount === 1 ? "" : "s"} · ${inviteCount} pending invite${inviteCount === 1 ? "" : "s"}`
    : "Only owners and admins can manage workspace members.";

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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setModalOpen(true)}
              disabled={!selectedWorkspace}
            >
              Open workspace settings
            </Button>
          </div>
        </div>
      </section>

      <WorkspaceSettingsModal visible={modalOpen} onClose={() => setModalOpen(false)} />
    </SettingsSectionShell>
  );
}
