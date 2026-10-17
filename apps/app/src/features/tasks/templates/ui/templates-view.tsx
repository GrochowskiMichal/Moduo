// Templates (TV-D15, Tasks v3 §15 and §17): your templates and the ones shared
// with the workspace, opened from the sidebar's ⋯ until Settings → Tasks →
// Templates exists (like Archived projects and Recently deleted, REPLAN 98).
// A row opens the template as its own editor; Use… makes something from it;
// its ⋯ renames, shares or stops sharing, and deletes (with Undo).

import { FileStack, MoreHorizontal } from "lucide-react";

import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { CollectionHeader } from "../../../../components/ui/collection-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { EmptyState } from "../../../../components/ui/empty-state";
import { IconButton } from "../../../../components/ui/icon-button";
import { Toolbar } from "../../../../components/ui/toolbar";
import { type Template, templateSize } from "../model";

export function TemplatesView({
  templates,
  loaded,
  currentUserId,
  canEdit,
  isAdmin,
  onOpen,
  onUse,
  onNewProjectFromTemplate,
  onShare,
  onDelete,
}: {
  templates: readonly Template[];
  loaded: boolean;
  currentUserId: string | null;
  canEdit: boolean;
  /** The workspace's owner or an admin: may stop sharing or delete a shared one. */
  isAdmin: boolean;
  onOpen: (template: Template) => void;
  onUse: (template: Template) => void;
  onNewProjectFromTemplate: () => void;
  onShare: (template: Template, shared: boolean) => void;
  onDelete: (template: Template) => void;
}) {
  const projects = templates.filter((t) => t.kind === "project");
  const tasks = templates.filter((t) => t.kind === "task");
  const row = (t: Template) => {
    const mine = t.ownerId === currentUserId;
    // The server checks Full on the sources again when you share (D15-5).
    const canShare = mine && canEdit;
    const canStopSharing = t.shared && (mine || isAdmin);
    const canDelete = mine || (t.shared && isAdmin);
    return (
      <li
        key={t.id}
        className="group/template relative flex h-(--row-h) min-w-0 items-center gap-2.5 rounded-md px-2 hover:bg-state-hover"
      >
        <button
          type="button"
          onClick={() => onOpen(t)}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="truncate font-sans text-base text-foreground">{t.name}</span>
          <span className="shrink-0 font-sans text-xs text-muted-foreground">
            {templateSize(t)}
          </span>
          {t.shared ? (
            <Badge variant="secondary" className="shrink-0">
              Shared
            </Badge>
          ) : null}
        </button>
        <span className="relative flex shrink-0 items-center gap-1">
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Use ${t.name}`}
              className="opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/template:opacity-100 group-focus-within/template:opacity-100"
              onClick={() => onUse(t)}
            >
              Use…
            </Button>
          ) : null}
          {canShare || canStopSharing || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon={MoreHorizontal} label={`More for ${t.name}`} tooltip={null} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onSelect={() => onOpen(t)}>
                  {mine ? "Edit" : "Open"}
                </DropdownMenuItem>
                {!t.shared && canShare ? (
                  <DropdownMenuItem onSelect={() => onShare(t, true)}>
                    Share with the workspace…
                  </DropdownMenuItem>
                ) : null}
                {canStopSharing ? (
                  <DropdownMenuItem onSelect={() => onShare(t, false)}>
                    Stop sharing
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(t)}>
                      Delete template
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 shrink-0 space-y-1">
        <Toolbar>
          <h1 className="truncate font-display text-lg text-foreground">Templates</h1>
          <span className="grow" />
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={onNewProjectFromTemplate}>
              New project from template…
            </Button>
          ) : null}
        </Toolbar>
        <p className="font-sans text-xs text-muted-foreground">
          Yours, and the ones shared with the workspace. Save one from a task's or a project's ⋯.
        </p>
      </div>
      {loaded && templates.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="No templates yet"
          description="Save a task or a project as a template from its ⋯. Its dates are kept as days from the start."
        />
      ) : (
        <div className="pane-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
          {projects.length > 0 ? (
            <section>
              <CollectionHeader label="Projects" count={projects.length} />
              <ul aria-label="Project templates">{projects.map(row)}</ul>
            </section>
          ) : null}
          {tasks.length > 0 ? (
            <section>
              <CollectionHeader label="Tasks" count={tasks.length} />
              <ul aria-label="Task templates">{tasks.map(row)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
