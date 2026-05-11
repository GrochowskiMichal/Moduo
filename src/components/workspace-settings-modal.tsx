import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../providers/workspace-provider";
import type { ModulePermission, WorkspaceRole } from "../features/workspaces/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const roleOptions: WorkspaceRole[] = ["viewer", "editor", "admin", "owner"];
const permissionOptions: ModulePermission[] = ["none", "view", "edit", "admin"];

const inputClasses =
  "h-10 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card placeholder:text-muted-foreground/70";

const ghostButtonClasses =
  "rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const destructiveButtonClasses =
  "rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function WorkspaceSettingsModal({ visible, onClose }: Props) {
  const {
    selectedWorkspace,
    canManageWorkspace,
    members,
    invites,
    sendInvite,
    updateInvite,
    revokeInvite,
    updateMemberPermissions,
    refreshAccessData,
  } = useWorkspace();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [notesPermission, setNotesPermission] = useState<ModulePermission>("edit");
  const [tasksPermission, setTasksPermission] = useState<ModulePermission>("edit");
  const [itemAclJson, setItemAclJson] = useState("[]");

  useEffect(() => {
    if (!visible) return;
    void refreshAccessData();
  }, [refreshAccessData, visible]);

  const parsedItemAcl = useMemo(() => {
    try {
      const parsed = JSON.parse(itemAclJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [itemAclJson]);

  return (
    <Dialog open={visible} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[980px]">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
          <DialogDescription>{selectedWorkspace?.name ?? "No workspace selected"}</DialogDescription>
        </DialogHeader>

        {!selectedWorkspace ? (
          <p className="text-sm text-muted-foreground">Select a workspace first.</p>
        ) : !canManageWorkspace ? (
          <p className="text-sm text-muted-foreground">
            Only owners and admins can manage workspace members and invites.
          </p>
        ) : (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Invite user</h3>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px_120px]">
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="email@example.com"
                  autoCapitalize="none"
                  className={inputClasses}
                />
                <input
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(
                      roleOptions.includes(event.target.value as WorkspaceRole)
                        ? (event.target.value as WorkspaceRole)
                        : "viewer",
                    )
                  }
                  placeholder="role"
                  className={inputClasses}
                />
                <input
                  value={notesPermission}
                  onChange={(event) =>
                    setNotesPermission(
                      permissionOptions.includes(event.target.value as ModulePermission)
                        ? (event.target.value as ModulePermission)
                        : "view",
                    )
                  }
                  placeholder="notes"
                  className={inputClasses}
                />
                <input
                  value={tasksPermission}
                  onChange={(event) =>
                    setTasksPermission(
                      permissionOptions.includes(event.target.value as ModulePermission)
                        ? (event.target.value as ModulePermission)
                        : "view",
                    )
                  }
                  placeholder="tasks"
                  className={inputClasses}
                />
              </div>
              <textarea
                value={itemAclJson}
                onChange={(event) => setItemAclJson(event.target.value)}
                rows={3}
                placeholder='Item ACL JSON (e.g. [{"module":"notes","resourceType":"note","resourceId":"...","effect":"deny","permission":"view"}])'
                className="mt-2 min-h-[72px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card placeholder:text-muted-foreground/70"
              />
              <button
                type="button"
                className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                onClick={async () => {
                  const email = inviteEmail.trim();
                  if (!email) return;
                  await sendInvite({
                    email,
                    role: inviteRole,
                    modulePermissions: {
                      notes: notesPermission,
                      tasks: tasksPermission,
                    },
                    itemAclTemplates: parsedItemAcl,
                  });
                  setInviteEmail("");
                  setItemAclJson("[]");
                }}
              >
                Send invite
              </button>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Members</h3>
              <div className="mt-2 flex max-h-[220px] flex-col gap-2 overflow-y-auto">
                {members.map((member) => (
                  <div key={member.id} className="rounded-md border border-border bg-muted px-3 py-2">
                    <div className="flex flex-row items-center justify-between">
                      <p className="text-sm text-foreground">{member.userId}</p>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{member.role}</p>
                    </div>
                    <div className="mt-2 flex flex-row flex-wrap gap-2">
                      {roleOptions.map((role) => (
                        <button
                          key={`${member.id}-${role}`}
                          type="button"
                          className={ghostButtonClasses}
                          onClick={() =>
                            void updateMemberPermissions({
                              memberId: member.id,
                              role,
                              modulePermissions: {
                                notes:
                                  role === "viewer"
                                    ? "view"
                                    : role === "owner" || role === "admin"
                                      ? "admin"
                                      : "edit",
                                tasks:
                                  role === "viewer"
                                    ? "view"
                                    : role === "owner" || role === "admin"
                                      ? "admin"
                                      : "edit",
                              },
                            })
                          }
                        >
                          {role.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Invites</h3>
              <div className="mt-2 flex max-h-[180px] flex-col gap-2 overflow-y-auto">
                {invites.map((invite) => (
                  <div key={invite.id} className="rounded-md border border-border bg-muted px-3 py-2">
                    <div className="flex flex-row items-center justify-between">
                      <p className="text-sm text-foreground">{invite.email}</p>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{invite.status}</p>
                    </div>
                    <div className="mt-2 flex flex-row flex-wrap gap-2">
                      <button
                        type="button"
                        className={ghostButtonClasses}
                        onClick={() =>
                          void updateInvite({
                            inviteId: invite.id,
                            role: invite.role,
                            modulePermissions: { notes: "view", tasks: "view" },
                          })
                        }
                      >
                        Set view
                      </button>
                      <button
                        type="button"
                        className={ghostButtonClasses}
                        onClick={() =>
                          void updateInvite({
                            inviteId: invite.id,
                            role: invite.role,
                            modulePermissions: { notes: "edit", tasks: "edit" },
                          })
                        }
                      >
                        Set edit
                      </button>
                      <button
                        type="button"
                        className={destructiveButtonClasses}
                        onClick={() => void revokeInvite(invite.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
