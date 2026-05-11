import { useMemo, useState } from "react";
import { useWorkspace } from "../providers/workspace-provider";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

type Props = {
  onOpenSettings?: () => void;
};

function formatWorkspaceLabel(name: string): string {
  return name.replace(/\s+workspace$/i, "").trim() || name;
}

export function WorkspaceSwitcher({ onOpenSettings }: Props) {
  const {
    workspaces,
    selectedWorkspace,
    selectWorkspace,
    createWorkspace,
    softDeleteWorkspace,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("New Workspace");
  const [deleteCandidateWorkspaceId, setDeleteCandidateWorkspaceId] = useState<string | null>(null);
  const [deleteWorkspaceInput, setDeleteWorkspaceInput] = useState("");
  const [deleteSubmittingWorkspaceId, setDeleteSubmittingWorkspaceId] = useState<string | null>(null);

  const workspaceLabel = useMemo(
    () => (selectedWorkspace?.name ? formatWorkspaceLabel(selectedWorkspace.name) : "No workspace"),
    [selectedWorkspace?.name],
  );

  const cancelDeleteIntent = () => {
    setDeleteCandidateWorkspaceId(null);
    setDeleteWorkspaceInput("");
    setDeleteSubmittingWorkspaceId(null);
  };

  const closeMenu = () => {
    setOpen(false);
    setIsCreatingWorkspace(false);
    setNewWorkspaceName("New Workspace");
    cancelDeleteIntent();
  };

  const submitCreateWorkspace = async () => {
    const name = newWorkspaceName.trim() || "New Workspace";
    const workspaceId = await createWorkspace(name);
    if (workspaceId) {
      selectWorkspace(workspaceId);
      closeMenu();
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else closeMenu();
      }}
    >
      <DropdownMenuTrigger
        className="flex h-9 min-w-[220px] max-w-[320px] flex-row items-center gap-2 rounded-md bg-transparent px-1 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        aria-label="Switch workspace"
      >
        <span className="min-w-0 flex-1 truncate text-left">{workspaceLabel}</span>
        <span className="shrink-0 text-xs leading-none text-muted-foreground">▾</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={8} className="w-[360px]">
        <div className="flex flex-row items-center justify-between px-2 pb-1 pt-1">
          <DropdownMenuLabel className="px-0">Workspaces</DropdownMenuLabel>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsCreatingWorkspace(true);
              setNewWorkspaceName("New Workspace");
            }}
            aria-label="Create workspace"
          >
            <span className="text-base leading-none">+</span>
          </button>
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-[260px] overflow-y-auto">
          {isCreatingWorkspace ? (
            <div className="mb-1 flex flex-row items-center gap-1 rounded-md border border-border bg-muted px-2 py-2">
              <input
                autoFocus
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitCreateWorkspace();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsCreatingWorkspace(false);
                  }
                }}
                className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
              />
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-accent"
                onClick={() => void submitCreateWorkspace()}
              >
                <span className="text-sm leading-none">✓</span>
              </button>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-accent"
                onClick={() => {
                  setIsCreatingWorkspace(false);
                  setNewWorkspaceName("New Workspace");
                }}
              >
                <span className="text-sm leading-none">×</span>
              </button>
            </div>
          ) : null}

          {workspaces.map((workspace) => {
            const active = workspace.id === selectedWorkspace?.id;
            const nameLabel = formatWorkspaceLabel(workspace.name);
            const isDeleteOpen = deleteCandidateWorkspaceId === workspace.id;
            const deleteMatches = deleteWorkspaceInput.trim() === nameLabel.trim();

            return (
              <div
                key={workspace.id}
                className={`rounded-md px-2 py-2 ${active ? "bg-accent" : "hover:bg-accent"}`}
              >
                <button
                  type="button"
                  className="flex w-full flex-row items-center gap-2 text-left focus-visible:outline-none"
                  onClick={() => {
                    selectWorkspace(workspace.id);
                    closeMenu();
                  }}
                >
                  <Avatar size="sm" className="shrink-0">
                    <AvatarFallback>{nameLabel.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${active ? "text-foreground" : "text-popover-foreground"}`}
                  >
                    {nameLabel}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      role="button"
                      tabIndex={0}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Workspace settings"
                      onClick={(event) => {
                        event.stopPropagation();
                        selectWorkspace(workspace.id);
                        closeMenu();
                        onOpenSettings?.();
                      }}
                    >
                      <Icon name="settings" size={13} />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Delete workspace"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isDeleteOpen) {
                          cancelDeleteIntent();
                        } else {
                          setDeleteCandidateWorkspaceId(workspace.id);
                          setDeleteWorkspaceInput("");
                        }
                      }}
                    >
                      <Icon name="trash-2" size={13} className="text-destructive" />
                    </span>
                  </span>
                </button>

                <div
                  style={{
                    overflow: "hidden",
                    transition:
                      "max-height 220ms ease, opacity 180ms ease, transform 180ms ease, margin-top 180ms ease",
                    maxHeight: isDeleteOpen ? 116 : 0,
                    opacity: isDeleteOpen ? 1 : 0,
                    transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                    marginTop: isDeleteOpen ? 8 : 0,
                  }}
                >
                  <p className="text-xs text-muted-foreground">
                    Retype <span className="font-semibold text-foreground">{nameLabel}</span> to delete this workspace.
                  </p>
                  <div className="mt-2 flex flex-row items-center gap-1">
                    <input
                      value={deleteWorkspaceInput}
                      onChange={(event) => setDeleteWorkspaceInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelDeleteIntent();
                        }
                        if (
                          event.key === "Enter" &&
                          deleteMatches &&
                          deleteSubmittingWorkspaceId !== workspace.id
                        ) {
                          event.preventDefault();
                          void (async () => {
                            setDeleteSubmittingWorkspaceId(workspace.id);
                            await softDeleteWorkspace(workspace.id);
                            cancelDeleteIntent();
                          })();
                        }
                      }}
                      placeholder={nameLabel}
                      className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                    />
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-accent"
                      onClick={cancelDeleteIntent}
                    >
                      <span className="text-xs leading-none">×</span>
                    </button>
                    <button
                      type="button"
                      className={`flex h-7 items-center justify-center rounded-md px-2 text-xs font-semibold ${
                        deleteMatches && deleteSubmittingWorkspaceId !== workspace.id
                          ? "text-destructive hover:bg-destructive/10"
                          : "text-muted-foreground/50"
                      }`}
                      onClick={async () => {
                        if (!deleteMatches || deleteSubmittingWorkspaceId === workspace.id) return;
                        setDeleteSubmittingWorkspaceId(workspace.id);
                        await softDeleteWorkspace(workspace.id);
                        cancelDeleteIntent();
                      }}
                      aria-disabled={!deleteMatches || deleteSubmittingWorkspaceId === workspace.id}
                    >
                      Del
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
