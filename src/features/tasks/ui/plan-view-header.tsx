import type { ReactNode } from "react";
import { ChartGantt, Columns3, List, Plus } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Toolbar } from "../../../components/ui/toolbar";

export type PlanView = "list" | "board" | "timeline";

/**
 * Shared header for both Plan-mode views: scope title on the left; an optional
 * view-specific group control + tag-filter trigger + the List/Board switch on
 * the right, then the one primary "New task" action. Built on the shared
 * Toolbar so every control sits on one rung (sm) and stacks — replaces the
 * old hand-rolled ViewSwitcher that ran 6px taller than its neighbours.
 */
export function PlanViewHeader({
  title,
  view,
  onViewChange,
  groupControl,
  filterControl,
  activeFilters,
  canEdit,
  onRequestCapture,
}: {
  title: string;
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  groupControl?: ReactNode;
  /** Tag-filter trigger, sits next to the group control (both views). */
  filterControl?: ReactNode;
  /** Active filter chips — a quiet second row under the header when present. */
  activeFilters?: ReactNode;
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  return (
    <div className="mb-3 shrink-0 space-y-1.5">
      <Toolbar>
        <h1 className="truncate font-display text-lg text-foreground">{title}</h1>
        <Toolbar.Spacer />
        <Toolbar.Group>
          {groupControl}
          {filterControl}
          <ViewSwitcher view={view} onViewChange={onViewChange} />
        </Toolbar.Group>
        <Toolbar.Primary>
          <Button size="sm" onClick={onRequestCapture} disabled={!canEdit}>
            <Plus aria-hidden />
            New
          </Button>
        </Toolbar.Primary>
      </Toolbar>
      {activeFilters ? <div className="flex flex-wrap items-center gap-1.5">{activeFilters}</div> : null}
    </div>
  );
}

/** Segmented List/Board toggle — the shared SegmentedControl primitive. */
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
