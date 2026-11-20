// The Timeline's own bar: No date on the left; Today and the zoom on the right.

import { CalendarOff } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { TIMELINE_ZOOMS, type TimelineZoom, ZOOM_LABELS } from "../timeline-scale";

type Props = {
  /** The rows with no date (the count beside "No date"). */
  undated: number;
  showUndated: boolean;
  /** The right panel's No date view (absent: the button shows the undated rows). */
  onOpenNoDate?: () => void;
  onToggleUndated: () => void;
  onToday: () => void;
  zoom: TimelineZoom;
  onZoom: (zoom: TimelineZoom) => void;
};

export function TimelineToolbar({
  undated,
  showUndated,
  onOpenNoDate,
  onToggleUndated,
  onToday,
  zoom,
  onZoom,
}: Props) {
  return (
    <div className="-mt-1 mb-2 flex shrink-0 items-center gap-1.5">
      {undated > 0 || showUndated ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {onOpenNoDate ? (
              // The right panel's No date view (70): drag a task from there onto a day.
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenNoDate}
                className="px-2"
                data-timeline-no-date-open=""
              >
                <CalendarOff aria-hidden />
                No date
                <span className="tabular-nums text-subtle-foreground">· {undated}</span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={showUndated}
                onClick={onToggleUndated}
                className={cn("px-2", showUndated && "bg-state-active")}
              >
                <CalendarOff aria-hidden />
                No date
                <span className="tabular-nums text-subtle-foreground">· {undated}</span>
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {onOpenNoDate
              ? "Open the tasks with no date beside the timeline"
              : showUndated
                ? "Hide the rows with no date"
                : "Show the tasks with no date as rows"}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <div className="flex-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={onToday}>
            Today
          </Button>
        </TooltipTrigger>
        <TooltipContent>Go to today · T</TooltipContent>
      </Tooltip>
      <SegmentedControl
        aria-label="Timeline zoom"
        size="sm"
        value={zoom}
        onValueChange={(value) => onZoom(value as TimelineZoom)}
        items={TIMELINE_ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))}
      />
    </div>
  );
}
