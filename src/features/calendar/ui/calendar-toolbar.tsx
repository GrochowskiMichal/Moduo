// Calendar toolbar: period nav · Today · range label · Day|Week switch.
// Controls sit on the standard rungs; the sync affordance (external
// calendars) joins the right side with CAL-6.

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Toolbar } from "../../../components/ui/toolbar";
import type { CalendarView } from "../lens";

type Props = {
  view: CalendarView;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
  /** External-calendar sync age ("synced 12 min ago"); null when no accounts. */
  syncLabel?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
};

const VIEW_ITEMS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

export function CalendarToolbar({
  view,
  label,
  onPrev,
  onNext,
  onToday,
  onViewChange,
  syncLabel,
  onRefresh,
  refreshing = false,
}: Props) {
  return (
    <Toolbar aria-label="Calendar controls" className="shrink-0 pb-3">
      <Toolbar.Group gap="tight">
        <IconButton icon={ChevronLeft} label="Previous period (←)" onClick={onPrev} />
        <IconButton icon={ChevronRight} label="Next period (→)" onClick={onNext} />
      </Toolbar.Group>
      <Button variant="outline" size="sm" onClick={onToday}>
        Today
      </Button>
      <span className="font-display text-sm font-medium text-foreground">{label}</span>
      <Toolbar.Spacer />
      <Toolbar.Group>
        {onRefresh ? (
          <Toolbar.Group gap="snug">
            {syncLabel ? <span className="text-2xs text-muted-foreground">{syncLabel}</span> : null}
            <IconButton
              icon={RefreshCw}
              label="Refresh calendars"
              onClick={onRefresh}
              className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined}
            />
          </Toolbar.Group>
        ) : null}
        <SegmentedControl
          size="sm"
          aria-label="Calendar view"
          value={view}
          onValueChange={(v) => onViewChange(v as CalendarView)}
          items={VIEW_ITEMS}
        />
      </Toolbar.Group>
    </Toolbar>
  );
}
