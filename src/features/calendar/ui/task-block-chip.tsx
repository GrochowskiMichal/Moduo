// The task-block chip — a task rendered in time (the lens). Deliberately
// quieter than events (DESIGN_BRIEF §2: muted/outline treatment, checkbox,
// never a loud color). Done blocks stay on the grid for their day: checked,
// dimmed, serene — never red, nothing pulses.
//
// CAL-4 adds the elapsed states: an elapsed-but-open block shows a quiet
// desaturated treatment and (when tall enough) an inline triage row
// (Later · Longer · Remove — Done is the checkbox); a "worked" block (took
// longer) dims with a clock glyph, no strike, still open. CAL-5 adds the live
// focus treatment: a leading progress edge + elapsed readout while focusing.

import type { ReactNode } from "react";
import { Clock } from "lucide-react";

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
  /** Open + end passed — the quiet desaturated treatment (CAL-4, AC8). */
  elapsed?: boolean;
  /** "Took longer" acknowledged this session — dimmed, clock glyph (CAL-4). */
  worked?: boolean;
  /** Show the inline triage row (only when the block is tall enough). */
  showTriage?: boolean;
  onLater?: () => void;
  onLonger?: () => void;
  onRemove?: () => void;
  /** Live focus session on this block (CAL-5, AC10). */
  focusing?: boolean;
  /** The self-ticking readout element, shown while focusing. */
  focusReadout?: ReactNode;
};

export function TaskBlockChip({
  title,
  startMs,
  endMs,
  done,
  compact,
  canEdit,
  onToggleDone,
  elapsed = false,
  worked = false,
  showTriage = false,
  onLater,
  onLonger,
  onRemove,
  focusing = false,
  focusReadout,
}: Props) {
  const timeLabel = `${formatTimeOfDay(startMs)} – ${formatTimeOfDay(endMs)}`;
  // Elapsed treatment only applies while genuinely awaiting triage — a done or
  // worked block has been handled and sits serenely.
  const awaitingTriage = elapsed && !done && !worked;

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

  const showRow = awaitingTriage && showTriage && canEdit;

  return (
    <div
      data-task-block
      data-elapsed={awaitingTriage ? "" : undefined}
      title={`${title} · ${timeLabel}`}
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-left",
        "transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-muted",
        done && "opacity-60",
        worked && "opacity-70",
        awaitingTriage && "border-dashed bg-muted/30",
        focusing && "border-primary/60",
        compact && "flex-row items-center gap-1.5 py-0",
      )}
    >
      {focusing ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-l-md bg-primary"
        />
      ) : null}

      <div className={cn("flex min-w-0 items-center gap-1.5", compact && "contents")}>
        {toggle}
        {worked ? (
          <Clock aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs text-foreground",
            done && "text-muted-foreground line-through",
          )}
        >
          {title}
        </span>
        {focusing && focusReadout ? (
          <span className="shrink-0 font-sans text-2xs tabular-nums text-primary">
            {focusReadout}
          </span>
        ) : null}
      </div>

      {!compact && !showRow ? (
        <span className="truncate pl-5.5 text-2xs text-muted-foreground">
          {worked ? `Worked · ${timeLabel}` : timeLabel}
        </span>
      ) : null}

      {showRow ? (
        <div className="mt-auto flex items-center gap-2 pl-5.5 pt-0.5 text-2xs text-muted-foreground">
          <TriageButton label="Later" onClick={onLater} />
          <TriageButton label="Longer" onClick={onLonger} />
          <TriageButton label="Remove" onClick={onRemove} />
        </div>
      ) : null}
    </div>
  );
}

/** A quiet in-chip triage action — muted text, foreground on hover. */
function TriageButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="rounded-sm transition-colors duration-(--motion-fast) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {label}
    </button>
  );
}
