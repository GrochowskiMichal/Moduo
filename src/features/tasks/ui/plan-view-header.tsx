import {
  ChartGantt,
  CircleDashed,
  Columns3,
  Ellipsis,
  FolderKanban,
  List,
  Plus,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Separator } from "../../../components/ui/separator";
import { Toolbar } from "../../../components/ui/toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { TaskLayout } from "../display";
import { BACK_TO_MANUAL_ORDER } from "../order";

export type PlanView = TaskLayout;

/** The page-owned toolbar pieces every view shows the same way (TV-U2). */
export type PlanHeaderControls = {
  /** Open tasks in the scope, after the title. */
  count?: number;
  /** Search (`/`). */
  search?: ReactNode;
  /** The Filter button (`f`). */
  filter?: ReactNode;
  /** The Display menu. */
  display?: ReactNode;
  /** The view's ⋯: Copy as text · Export view as CSV · Print (TV-D14). */
  more?: ReactNode;
  /** The active-filter row under the toolbar, when a filter is on. */
  activeFilters?: ReactNode;
  /** "Sorted by due date · Back to manual order", when a project view is
   *  sorted (`SortedOrderLine`, default m). */
  sortedNote?: ReactNode;
  /**
   * An open saved view whose Filter or Display changed, or a new view not
   * saved yet: the toolbar's Save (MOD-142; TV-U8's quiet line under the
   * toolbar went unnoticed). Sits right after Search · Filter · Display.
   */
  viewSave?: ReactNode;
  /**
   * The project this view shows (MOD-95, round-2b): its title opens Project
   * details in the right panel, and a ⋯ beside it offers the project's own
   * actions. Absent for the Inbox, All, My tasks and saved views.
   */
  project?: {
    onOpenDetails: () => void;
    /** ⋯ → Statuses… (TV-D9); absent without edit access. */
    onEditStatuses?: () => void;
  };
};

/**
 * The one toolbar of the List, Board and Timeline (tasks-v2 §7, comp §1):
 * title (a project's opens its details, with its ⋯ beside it) + count ·
 * Search · Filter · Display | view switch | New. One control
 * language: ghost controls on the sm rung, the view switch as a raised
 * plate, and New as the one primary. Grouping lives in Display; a view's own
 * navigation (the Timeline's Today and zoom) sits before Search.
 */
export function PlanViewHeader({
  title,
  view,
  onViewChange,
  viewControls,
  controls = {},
  canEdit,
  onRequestCapture,
}: {
  title: string;
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  /** The view's own controls (Timeline: Today and zoom). */
  viewControls?: ReactNode;
  controls?: PlanHeaderControls;
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  const { count, search, filter, display, more, activeFilters, sortedNote, viewSave, project } =
    controls;
  return (
    // A container, so the controls read its width: under 36rem (576 px) Filter
    // and Display drop their words for icons (the kit's `@max-xl:`).
    <div className="@container mb-3 shrink-0 space-y-1.5">
      <Toolbar gap="snug" className="flex-wrap gap-y-1.5">
        {/* The title comes first (MOD-95 follow-up): it starts at 10rem with
            its ⋯ and count (about ten characters of the name), takes all the
            room the controls leave, and shortens with an ellipsis only below
            that. Past that point the controls wrap under it, right-aligned,
            instead of squeezing it away. */}
        <div data-slot="plan-title" className="flex min-w-0 grow basis-40 items-baseline gap-2">
          {project ? (
            <h1 className="min-w-0 font-display text-lg text-foreground">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={project.onOpenDetails}
                    className="-mx-1 block max-w-full truncate rounded-md px-1 text-left outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {title}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Project details</TooltipContent>
              </Tooltip>
            </h1>
          ) : (
            <h1 className="truncate font-display text-lg text-foreground">{title}</h1>
          )}
          {project ? <ProjectMenu project={project} /> : null}
          {count !== undefined ? (
            <span className="shrink-0 font-sans text-sm tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
          {/* Read-only (research §9): said once, after the title. */}
          {canEdit ? null : (
            <span className="shrink-0 font-sans text-xs text-subtle-foreground">View only</span>
          )}
        </div>
        <Toolbar.Group gap="snug" data-slot="plan-controls" className="ml-auto">
          {viewControls ? <Toolbar.Group>{viewControls}</Toolbar.Group> : null}
          <Toolbar.Group gap="snug">
            {search}
            {filter}
            {display}
            {more}
          </Toolbar.Group>
          {viewSave ? (
            <>
              <ToolbarSeparator />
              {viewSave}
            </>
          ) : null}
          <ToolbarSeparator />
          <ViewSwitcher view={view} onViewChange={onViewChange} />
          {/* Read-only views have no New (research §9: no add in that project). */}
          {canEdit ? (
            <>
              <ToolbarSeparator />
              <Toolbar.Primary>
                <Button size="sm" onClick={() => onRequestCapture()}>
                  <Plus aria-hidden />
                  New
                </Button>
              </Toolbar.Primary>
            </>
          ) : null}
        </Toolbar.Group>
      </Toolbar>
      {activeFilters}
      {sortedNote}
    </div>
  );
}

/**
 * A sorted project view says so, and goes back to its manual order in one
 * click (tasks-v3 §4, default m): "Sorted by due date · Back to manual order".
 * The manual order is kept untouched underneath while it's sorted.
 */
export function SortedOrderLine({
  label,
  onManualOrder,
}: {
  /** "Sorted by due date" (`sortedByLabel`). */
  label: string;
  onManualOrder: () => void;
}) {
  return (
    <p className="flex items-center gap-1.5 px-1 font-sans text-xs text-muted-foreground">
      <span>{label}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onManualOrder}
        className="rounded-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {BACK_TO_MANUAL_ORDER}
      </button>
    </p>
  );
}

/**
 * The project's ⋯ beside its title (round-2b `.pmore`, "Project · Statuses ·
 * …"): the items the app already has an action for.
 */
function ProjectMenu({ project }: { project: NonNullable<PlanHeaderControls["project"]> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={Ellipsis}
          label="Project actions"
          tooltip={null}
          className="-ml-1 shrink-0 self-center text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onSelect={project.onOpenDetails}>
          <FolderKanban aria-hidden />
          Project details
        </DropdownMenuItem>
        {project.onEditStatuses ? (
          <DropdownMenuItem onSelect={project.onEditStatuses}>
            <CircleDashed aria-hidden />
            Statuses…
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToolbarSeparator() {
  return (
    <Separator
      orientation="vertical"
      className="mx-1 bg-hairline data-[orientation=vertical]:h-4"
    />
  );
}

/** Segmented List/Board/Timeline toggle — the shared SegmentedControl primitive. */
export function ViewSwitcher({
  view,
  onViewChange,
}: {
  view: PlanView;
  onViewChange: (view: PlanView) => void;
}) {
  return (
    <SegmentedControl
      aria-label="View"
      size="sm"
      iconOnly
      value={view}
      onValueChange={(value) => onViewChange(value as PlanView)}
      items={[
        { value: "list", icon: List, ariaLabel: "List view" },
        { value: "board", icon: Columns3, ariaLabel: "Board view" },
        { value: "timeline", icon: ChartGantt, ariaLabel: "Timeline view" },
      ]}
    />
  );
}
