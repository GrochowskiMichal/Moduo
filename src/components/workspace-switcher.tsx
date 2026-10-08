import { ChevronDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { WorkspaceMark } from "../features/workspaces/ui/workspace-mark";
import { useEntitlement } from "../hooks/use-entitlement";
import { formatShortcut, SHORTCUTS, useShortcut } from "../lib/shortcuts";
import { useWorkspace } from "../providers/workspace-provider";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { UpgradeModal } from "./upgrade-modal";

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
    joinWorkspace,
  } = useWorkspace();
  const { allowed: canAddWorkspace } = useEntitlement("unlimited_workspaces");
  const [open, setOpen] = useState(false);
  // The shortcut hook must mount before the early return so React's hook
  // order rule is respected. It becomes a no-op when the trigger is hidden
  // (single-workspace case) because there's nothing to open.
  useShortcut(
    "workspace-switcher",
    useCallback(() => setOpen((prev) => !prev), []),
  );
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("New Workspace");
  const [deleteCandidateWorkspaceId, setDeleteCandidateWorkspaceId] = useState<string | null>(null);
  const [deleteWorkspaceInput, setDeleteWorkspaceInput] = useState("");
  const [deleteSubmittingWorkspaceId, setDeleteSubmittingWorkspaceId] = useState<string | null>(
    null,
  );
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [isJoiningWorkspace, setIsJoiningWorkspace] = useState(false);
  const [joinToken, setJoinToken] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  const workspaceLabel = useMemo(
    () => (selectedWorkspace?.name ? formatWorkspaceLabel(selectedWorkspace.name) : "No workspace"),
    [selectedWorkspace?.name],
  );

  const cancelDeleteIntent = () => {
    setDeleteCandidateWorkspaceId(null);
    setDeleteWorkspaceInput("");
    setDeleteSubmittingWorkspaceId(null);
  };

  const cancelJoinIntent = () => {
    setIsJoiningWorkspace(false);
    setJoinToken("");
    setJoinError(null);
  };

  const closeMenu = () => {
    setOpen(false);
    setIsCreatingWorkspace(false);
    setNewWorkspaceName("New Workspace");
    cancelDeleteIntent();
    cancelJoinIntent();
  };

  const handleCreateIntent = () => {
    if (workspaces.length >= 1 && !canAddWorkspace) {
      setUpgradeModalOpen(true);
      return;
    }
    setIsJoiningWorkspace(false);
    setIsCreatingWorkspace(true);
    setNewWorkspaceName("New Workspace");
  };

  const handleJoinIntent = () => {
    setIsCreatingWorkspace(false);
    setIsJoiningWorkspace(true);
    setJoinToken("");
    setJoinError(null);
  };

  const submitCreateWorkspace = async () => {
    const name = newWorkspaceName.trim() || "New Workspace";
    const workspaceId = await createWorkspace(name);
    if (workspaceId) {
      selectWorkspace(workspaceId);
      closeMenu();
    }
  };

  const submitJoinWorkspace = async () => {
    if (!joinToken.trim() || joinBusy) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      const ws = await joinWorkspace(joinToken.trim());
      if (!ws) throw new Error("Invalid or expired invite code.");
      setOpen(false);
      setIsJoiningWorkspace(false);
      setJoinToken("");
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : "Failed to join workspace.");
    } finally {
      setJoinBusy(false);
    }
  };

  // Show the workspace identity even for a single-workspace user (CC-10): the
  // top-left was empty for every brand-new user, and ⌘⇧W was a no-op. We only
  // hide when there's genuinely nothing selected yet (0 workspaces / loading).
  // Deleting the *only* workspace stays impossible — its trash affordance is
  // withheld below when `workspaces.length <= 1` (the provider has no last-one
  // guard, so a zero-workspace state must never be reachable from here).
  if (!selectedWorkspace) return null;

  const switcherShortcut = SHORTCUTS.find((s) => s.id === "workspace-switcher");
  const canDeleteWorkspaces = workspaces.length > 1;
  const switcherHint = switcherShortcut ? formatShortcut(switcherShortcut) : "";

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else closeMenu();
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              data-slot="chrome-fade-in"
              className="flex h-8 flex-row items-center gap-1.5 rounded-md bg-transparent px-2 text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground aria-expanded:bg-state-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label={`Switch workspace · current: ${workspaceLabel}`}
            >
              <WorkspaceMark
                name={workspaceLabel}
                icon={selectedWorkspace.icon}
                logoUrl={selectedWorkspace.logoUrl}
              />
              <span className="max-w-[14ch] truncate text-sm">{workspaceLabel}</span>
              <ChevronDown className="size-4 shrink-0" aria-hidden />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            Switch workspace{switcherHint ? ` · ${switcherHint}` : ""}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" sideOffset={8} className="w-[360px]">
          <div className="flex flex-row items-center justify-between px-2 pb-1 pt-1">
            <DropdownMenuLabel className="px-0">Workspaces</DropdownMenuLabel>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleJoinIntent();
                }}
                aria-label="Join workspace by invite code"
                className="h-6 w-6"
              >
                <Icon name="user-plus" size={13} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleCreateIntent();
                }}
                aria-label="Create workspace"
                className="h-6 w-6"
              >
                <span className="text-base leading-none">+</span>
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          <div className="max-h-[260px] overflow-y-auto">
            {isCreatingWorkspace ? (
              <div className="mb-1 flex flex-row items-center gap-1 rounded-md border border-border bg-muted px-2 py-2">
                <Input
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
                  className="h-8 flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void submitCreateWorkspace()}
                  aria-label="Save workspace"
                  className="h-7 w-7"
                >
                  <span className="text-sm leading-none">✓</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setIsCreatingWorkspace(false);
                    setNewWorkspaceName("New Workspace");
                  }}
                  aria-label="Cancel"
                  className="h-7 w-7"
                >
                  <span className="text-sm leading-none">×</span>
                </Button>
              </div>
            ) : null}

            {isJoiningWorkspace ? (
              <div className="mb-1 flex flex-col gap-1 rounded-md border border-border bg-muted px-2 py-2">
                <p className="px-1 text-xs text-muted-foreground">
                  Paste an invite code to join an existing workspace.
                </p>
                <div className="flex flex-row items-center gap-1">
                  <Input
                    autoFocus
                    value={joinToken}
                    onChange={(event) => setJoinToken(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitJoinWorkspace();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelJoinIntent();
                      }
                    }}
                    placeholder="Invite code"
                    className="h-8 flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void submitJoinWorkspace()}
                    disabled={!joinToken.trim() || joinBusy}
                    aria-label="Join workspace"
                    className="h-7 w-7"
                  >
                    <span className="text-sm leading-none">✓</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={cancelJoinIntent}
                    aria-label="Cancel"
                    className="h-7 w-7"
                  >
                    <span className="text-sm leading-none">×</span>
                  </Button>
                </div>
                {joinError ? (
                  <p className="px-1 text-xs text-destructive" role="alert">
                    {joinError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {workspaces.map((workspace) => {
              const active = workspace.id === selectedWorkspace?.id;
              const nameLabel = formatWorkspaceLabel(workspace.name);
              // Fold the last-one guard into `isDeleteOpen` too, not just the
              // trigger: if a background refresh drops the list to one while a
              // delete panel is open, the panel collapses and its confirm becomes
              // unreachable — so the zero-workspace state stays truly impossible.
              const isDeleteOpen =
                canDeleteWorkspaces && deleteCandidateWorkspaceId === workspace.id;
              const deleteMatches = deleteWorkspaceInput.trim() === nameLabel.trim();

              return (
                <div
                  key={workspace.id}
                  className={`rounded-md px-2 py-2 ${active ? "bg-state-active" : "hover:bg-state-hover"}`}
                >
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    className="flex w-full flex-row items-center gap-2 text-left focus-visible:outline-none"
                    onClick={() => {
                      selectWorkspace(workspace.id);
                      closeMenu();
                    }}
                  >
                    <WorkspaceMark
                      name={nameLabel}
                      icon={workspace.icon}
                      logoUrl={workspace.logoUrl}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${active ? "text-foreground" : "text-popover-foreground"}`}
                    >
                      {nameLabel}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span
                        role="button"
                        tabIndex={0}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      {canDeleteWorkspaces ? (
                        <span
                          role="button"
                          tabIndex={0}
                          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      ) : null}
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
                      Retype <span className="font-semibold text-foreground">{nameLabel}</span> to
                      delete this workspace.
                    </p>
                    <div className="mt-2 flex flex-row items-center gap-1">
                      <Input
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
                            canDeleteWorkspaces &&
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
                        className="h-8 flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={cancelDeleteIntent}
                        aria-label="Cancel"
                        className="h-7 w-7"
                      >
                        <span className="text-xs leading-none">×</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (
                            !deleteMatches ||
                            !canDeleteWorkspaces ||
                            deleteSubmittingWorkspaceId === workspace.id
                          )
                            return;
                          setDeleteSubmittingWorkspaceId(workspace.id);
                          await softDeleteWorkspace(workspace.id);
                          cancelDeleteIntent();
                        }}
                        disabled={!deleteMatches || deleteSubmittingWorkspaceId === workspace.id}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        Del
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <UpgradeModal
        visible={upgradeModalOpen}
        feature="unlimited_workspaces"
        onClose={() => setUpgradeModalOpen(false)}
      />
    </>
  );
}
