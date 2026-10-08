// The task-block popover (single click, DESIGN_BRIEF §7b): title · time ·
// checkbox · duration · Open. CAL-4 adds the elapsed-triage actions (same four
// as the in-grid row: Done is the checkbox; Later today · Took longer · Remove
// are here for every size, incl. blocks too short for the inline row). CAL-5
// adds Start focus / pause · stop with the live readout. Quiet throughout —
// never red, never a modal.

import { ExternalLink, Pause, Play, Square, Timer } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import type { TaskBlock } from "../lens";
import { ChipPopover } from "./chip-popover";
import { formatDayLabel, formatTimeOfDay } from "./time-format";

type Props = {
  block: TaskBlock;
  anchorRect: DOMRect;
  canEdit: boolean;
  /** Open + end passed → the four triage actions appear (AC8). */
  elapsed: boolean;
  /** "Took longer" acknowledged this session. */
  worked: boolean;
  /** Start-focus offered (current-ish block). */
  canFocus: boolean;
  focusing: boolean;
  focusRunning: boolean;
  focusReadout?: ReactNode;
  onToggleDone: () => void;
  onLater: () => void;
  onLonger: () => void;
  onRemove: () => void;
  onStartFocus: () => void;
  onPauseFocus: () => void;
  onResumeFocus: () => void;
  onStopFocus: () => void;
  onOpenDetail: () => void;
  onClose: () => void;
};

export function TaskPopover({
  block,
  anchorRect,
  canEdit,
  elapsed,
  worked,
  canFocus,
  focusing,
  focusRunning,
  focusReadout,
  onToggleDone,
  onLater,
  onLonger,
  onRemove,
  onStartFocus,
  onPauseFocus,
  onResumeFocus,
  onStopFocus,
  onOpenDetail,
  onClose,
}: Props) {
  const showTriage = elapsed && !block.done && !worked && canEdit;
  const showStartFocus = canFocus && canEdit && !block.done && !focusing;

  return (
    <ChipPopover anchorRect={anchorRect} onClose={onClose}>
      <div className="flex items-center gap-2">
        <CompleteToggle
          done={block.done}
          disabled={!canEdit}
          onToggle={onToggleDone}
          aria-label={block.done ? `Reopen ${block.title}` : `Complete ${block.title}`}
        />
        <span className="min-w-0 flex-1 truncate font-display text-sm font-medium text-foreground">
          {block.title}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {formatDayLabel(block.startMs)} · {formatTimeOfDay(block.startMs)} –{" "}
        {formatTimeOfDay(block.endMs)} · {block.durationMinutes}m
      </span>

      {worked ? (
        <span className="text-2xs text-muted-foreground">
          Worked — its planned time was logged; still open.
        </span>
      ) : null}

      {focusing ? (
        <div className="flex items-center gap-1.5">
          <span className="mr-auto flex items-center gap-1 font-sans text-sm tabular-nums text-primary">
            <Timer aria-hidden className="size-icon-xs" />
            {focusReadout}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={focusRunning ? onPauseFocus : onResumeFocus}
          >
            {focusRunning ? <Pause aria-hidden /> : <Play aria-hidden />}
            {focusRunning ? "Pause" : "Resume"}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={onStopFocus}>
            <Square aria-hidden />
            Stop
          </Button>
        </div>
      ) : showStartFocus ? (
        <div>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={onStartFocus}>
            <Timer aria-hidden />
            Start focus
          </Button>
        </div>
      ) : null}

      {showTriage ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          <Button size="sm" variant="ghost" onClick={onLater}>
            Later today
          </Button>
          <Button size="sm" variant="ghost" onClick={onLonger}>
            Took longer
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      ) : null}

      <div className="mt-1 flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenDetail}>
          <ExternalLink aria-hidden />
          Open
        </Button>
      </div>
    </ChipPopover>
  );
}
