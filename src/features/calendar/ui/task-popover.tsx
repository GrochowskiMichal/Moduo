// The task-block popover (single click, DESIGN_BRIEF §7b): title · time ·
// checkbox · duration · Open. The elapsed-triage row joins with CAL-4 and
// Start focus with CAL-5 — this stays deliberately quiet until then.

import { ExternalLink } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import type { TaskBlock } from "../lens";
import { ChipPopover } from "./chip-popover";
import { formatDayLabel, formatTimeOfDay } from "./time-format";

type Props = {
  block: TaskBlock;
  anchorRect: DOMRect;
  canEdit: boolean;
  onToggleDone: () => void;
  onOpenDetail: () => void;
  onClose: () => void;
};

export function TaskPopover({
  block,
  anchorRect,
  canEdit,
  onToggleDone,
  onOpenDetail,
  onClose,
}: Props) {
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
      <div className="mt-1 flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenDetail}>
          <ExternalLink aria-hidden />
          Open
        </Button>
      </div>
    </ChipPopover>
  );
}
