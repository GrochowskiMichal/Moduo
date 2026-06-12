import type { ReactNode } from "react";
import { Columns3, List, Plus } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";

export type PlanView = "list" | "board";

/**
 * Shared header for both Plan-mode views: scope title on the left; an optional
 * view-specific group control, the List/Board switcher, and "New task" on the
 * right. Keeps the two views visually identical above the fold.
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="truncate font-display text-lg text-foreground">{title}</h1>
        <div className="flex items-center gap-2">
          {groupControl}
          {filterControl}
          <ViewSwitcher view={view} onViewChange={onViewChange} />
          <Button size="sm" onClick={onRequestCapture} disabled={!canEdit}>
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        </div>
      </div>
      {activeFilters ? <div className="flex flex-wrap items-center gap-1.5">{activeFilters}</div> : null}
    </div>
  );
}

const VIEW_OPTIONS: Array<{ value: PlanView; label: string; icon: typeof List }> = [
  { value: "list", label: "List", icon: List },
  { value: "board", label: "Board", icon: Columns3 },
];

/** Segmented List/Board toggle — mirrors the rail's Plan/Execute mode toggle. */
export function ViewSwitcher({
  view,
  onViewChange,
}: {
  view: PlanView;
  onViewChange: (view: PlanView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="View"
      className="flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5"
    >
      {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="tab"
              aria-selected={view === value}
              aria-label={`${label} view`}
              onClick={() => onViewChange(value)}
              className={cn(
                "flex size-7 items-center justify-center rounded-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
