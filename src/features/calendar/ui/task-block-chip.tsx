// The task-block chip — a task rendered in time (the lens). Deliberately
// quieter than events (DESIGN_BRIEF §2: muted/outline treatment, checkbox,
// never a loud color). Done blocks stay on the grid for their day: checked,
// dimmed, serene — never red, nothing pulses.

import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatTimeOfDay } from "./time-format";

type Props = {
  title: string;
  startMs: number;
  endMs: number;
  done: boolean;
  /** Single-line layout for short blocks (< ~40 rendered minutes). */
  compact: boolean;
  canEdit: boolean;
  onToggleDone: () => void;
};

export function TaskBlockChip({
  title,
  startMs,
  endMs,
  done,
  compact,
  canEdit,
  onToggleDone,
}: Props) {
  const timeLabel = `${formatTimeOfDay(startMs)} – ${formatTimeOfDay(endMs)}`;

  const toggle = canEdit ? (
    <CompleteToggle
      done={done}
      onToggle={onToggleDone}
      aria-label={done ? `Reopen ${title}` : `Complete ${title}`}
    />
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <CompleteToggle done={done} disabled onToggle={() => {}} />
        </span>
      </TooltipTrigger>
      <TooltipContent>View-only in this workspace</TooltipContent>
    </Tooltip>
  );

  return (
    <div
      data-task-block
      title={`${title} · ${timeLabel}`}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-left",
        "transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-muted",
        done && "opacity-60",
        compact && "flex-row items-center gap-1.5 py-0",
      )}
    >
      <div className={cn("flex min-w-0 items-center gap-1.5", compact && "contents")}>
        {toggle}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs text-foreground",
            done && "text-muted-foreground line-through",
          )}
        >
          {title}
        </span>
      </div>
      {!compact ? (
        <span className="truncate pl-5.5 text-2xs text-muted-foreground">{timeLabel}</span>
      ) : null}
    </div>
  );
}
