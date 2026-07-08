// The event chip — a calendar entry on the grid. Visually distinct from task
// blocks (DESIGN_BRIEF §2): events carry their calendar color (Moduo = the
// primary tint at low chroma), task blocks stay muted/outline. Past events
// dim serenely; never red, nothing pulses.

import { Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatTimeOfDay } from "./time-format";

type Props = {
  title: string;
  startMs: number;
  endMs: number;
  compact: boolean;
  external: boolean;
  recurring: boolean;
  selected: boolean;
  past: boolean;
  allDay?: boolean;
  /** External chips carry their account hue (a bounded label name); native
   * (Moduo) events stay on the primary tint. */
  colorLabel?: string;
};

export function EventChipView({
  title,
  startMs,
  endMs,
  compact,
  external,
  recurring,
  selected,
  past,
  allDay = false,
  colorLabel,
}: Props) {
  const timeLabel = allDay
    ? "All day"
    : `${formatTimeOfDay(startMs)} – ${formatTimeOfDay(endMs)}`;
  return (
    <div
      data-chip="event"
      data-label={external ? colorLabel : undefined}
      title={`${title} · ${timeLabel}${external ? " · read-only" : ""}`}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border px-1.5 py-0.5 text-left",
        "transition-colors duration-(--motion-fast) ease-(--ease-out)",
        external
          ? "cal-chip-external"
          : "border-primary/35 bg-primary/10 hover:bg-primary/15",
        past && "opacity-60",
        selected && "ring-2 ring-ring",
        compact && "flex-row items-center gap-1.5 py-0",
      )}
    >
      <div className={cn("flex min-w-0 items-center gap-1", compact && "contents")}>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{title}</span>
        {recurring ? (
          <Repeat aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" />
        ) : null}
      </div>
      {!compact ? (
        <span className="truncate text-2xs text-muted-foreground">{timeLabel}</span>
      ) : null}
    </div>
  );
}
