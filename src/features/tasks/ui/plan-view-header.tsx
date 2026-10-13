import { ChartGantt, Columns3, List, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Separator } from "../../../components/ui/separator";
import { Toolbar } from "../../../components/ui/toolbar";
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
  /** The active-filter row under the toolbar, when a filter is on. */
  activeFilters?: ReactNode;
  /** "Sorted by due date · Back to manual order", when a project view is
   *  sorted (`SortedOrderLine`, default m). */
  sortedNote?: ReactNode;
};

/**
 * The one toolbar of the List, Board and Timeline (tasks-v2 §7, comp §1):
 * title + count · Search · Filter · Display | view switch | New. One control
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
  const { count, search, filter, display, activeFilters, sortedNote } = controls;
  return (
    <div className="mb-3 shrink-0 space-y-1.5">
      <Toolbar gap="snug">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate font-display text-lg text-foreground">{title}</h1>
          {count !== undefined ? (
            <span className="shrink-0 font-sans text-sm tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </div>
        <Toolbar.Spacer />
        {viewControls ? <Toolbar.Group>{viewControls}</Toolbar.Group> : null}
        <Toolbar.Group gap="snug">
          {search}
          {filter}
          {display}
        </Toolbar.Group>
        <ToolbarSeparator />
        <ViewSwitcher view={view} onViewChange={onViewChange} />
        <ToolbarSeparator />
        <Toolbar.Primary>
          <Button size="sm" onClick={onRequestCapture} disabled={!canEdit}>
            <Plus aria-hidden />
            New
          </Button>
        </Toolbar.Primary>
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

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="mx-1 h-4 bg-hairline" />;
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
