// Calendar toolbar: period nav · Today · range label · Day|Week switch.
// Controls sit on the standard rungs; the sync affordance (external
// calendars) joins the right side with CAL-6.

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import type { CalendarView } from "../lens";

type Props = {
  view: CalendarView;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
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
}: Props) {
  return (
    <div className="flex shrink-0 items-center gap-2 pb-3">
      <div className="flex items-center gap-0.5">
        <IconButton icon={ChevronLeft} label="Previous period (←)" onClick={onPrev} />
        <IconButton icon={ChevronRight} label="Next period (→)" onClick={onNext} />
      </div>
      <Button variant="outline" size="sm" onClick={onToday}>
        Today
      </Button>
      <span className="font-display text-sm font-medium text-foreground">{label}</span>
      <div className="ml-auto">
        <SegmentedControl
          size="sm"
          aria-label="Calendar view"
          value={view}
          onValueChange={(v) => onViewChange(v as CalendarView)}
          items={VIEW_ITEMS}
        />
      </div>
    </div>
  );
}
