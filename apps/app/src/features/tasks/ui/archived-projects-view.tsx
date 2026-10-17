import { Archive } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Toolbar } from "../../../components/ui/toolbar";
import { formatDate } from "../../../lib/time-format";
import type { Bucket } from "../model";
import { bucketDotColor } from "../sidebar";

/** "Archived Oct 3" (the one date grammar), or just "Archived". */
export function archivedOnLabel(archivedAt: string | null | undefined, now?: Date): string {
  if (!archivedAt) return "Archived";
  return `Archived ${formatDate(archivedAt, now)}`;
}

/**
 * Archived projects (TV-U6, REPLAN 16 + 78 + 98): opened from the sidebar's ⋯,
 * never a permanent row. Each opens read-only; Unarchive puts it back in the
 * sidebar, Delete project… asks first (REPLAN 78). Search finds their tasks
 * meanwhile, labelled "Archived".
 */
export function ArchivedProjectsView({
  projects,
  openCountByProject,
  canEdit,
  onOpen,
  onUnarchive,
  onDelete,
}: {
  projects: Bucket[];
  /** Open tasks left in each (nothing in an archived project is on any list). */
  openCountByProject: (id: string) => number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (project: Bucket) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 shrink-0 space-y-1">
        <Toolbar>
          <h1 className="truncate font-display text-lg text-foreground">Archived projects</h1>
        </Toolbar>
        <p className="font-sans text-xs text-muted-foreground">
          Archived projects leave the sidebar and every list. Search still finds their tasks.
        </p>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No archived projects"
          description="Archive a project from its ⋯ in the sidebar when it's finished or paused."
        />
      ) : (
        <ul aria-label="Archived projects" className="pane-scroll min-h-0 flex-1 overflow-auto">
          {projects.map((project) => {
            const open = openCountByProject(project.id);
            return (
              <li
                key={project.id}
                className="group/archived relative flex h-(--row-h) min-w-0 items-center gap-2.5 rounded-md px-2 hover:bg-state-hover"
              >
                <button
                  type="button"
                  onClick={() => onOpen(project.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="flex w-icon shrink-0 items-center justify-center">
                    <NavRowDot color={bucketDotColor(project)} />
                  </span>
                  <span className="truncate font-sans text-base text-foreground">
                    {project.name}
                  </span>
                  <span className="shrink-0 font-sans text-xs text-muted-foreground">
                    {archivedOnLabel(project.archivedAt)}
                    {open > 0 ? ` · ${open === 1 ? "1 open task" : `${open} open tasks`}` : ""}
                  </span>
                </button>
                {canEdit ? (
                  // Revealed on hover or keyboard focus; the space is always
                  // reserved, so nothing reflows (R6).
                  <span className="relative flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/archived:opacity-100 group-focus-within/archived:opacity-100">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Unarchive ${project.name}`}
                      onClick={() => onUnarchive(project.id)}
                    >
                      Unarchive
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={`Delete ${project.name}`}
                      onClick={() => onDelete(project)}
                    >
                      Delete…
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The quiet line over an archived project's tasks: read-only, with Unarchive. */
export function ArchivedProjectBanner({
  project,
  canEdit,
  onUnarchive,
}: {
  project: Bucket;
  canEdit: boolean;
  onUnarchive: () => void;
}) {
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-md border border-hairline bg-muted px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-sans text-sm text-muted-foreground">
        {archivedOnLabel(project.archivedAt)} · read-only until you unarchive it.
      </span>
      {canEdit ? (
        <Button size="sm" variant="outline" onClick={onUnarchive}>
          Unarchive
        </Button>
      ) : null}
    </div>
  );
}
