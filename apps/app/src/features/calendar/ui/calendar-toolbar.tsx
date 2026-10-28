// Calendar toolbar: period nav · Today · range label · the now-and-next line
// (CALR-2, in the free room between) · Day|Week switch.
// Controls sit on the standard rungs; the sync affordance (external
// calendars) joins the right side with CAL-6.

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Toolbar } from "../../../components/ui/toolbar";
import { isMacPlatform } from "../../../lib/hotkeys";
import { formatChord } from "../keys-sheet";
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
  /** The now-and-next line; it fills the free room, so it is the spacer too. */
  nowNext?: ReactNode;
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
  nowNext,
}: Props) {
  return (
    <Toolbar aria-label="Calendar controls" className="shrink-0 pb-3">
      <Toolbar.Group gap="tight">
        <IconButton
          icon={ChevronLeft}
          label={`Previous period (${formatChord("Mod+ArrowLeft", isMacPlatform())})`}
          onClick={onPrev}
        />
        <IconButton
          icon={ChevronRight}
          label={`Next period (${formatChord("Mod+ArrowRight", isMacPlatform())})`}
          onClick={onNext}
        />
      </Toolbar.Group>
      <Button variant="outline" size="sm" onClick={onToday}>
        Today
      </Button>
      <span
        data-calendar-range=""
        className="shrink-0 font-display text-sm font-medium whitespace-nowrap text-foreground"
      >
        {label}
      </span>
      {nowNext ?? <Toolbar.Spacer />}
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
