// The grid's event card and the "+N" list (CALR-1). A card is positioned by
// the overlap layout (side by side, cascades, layers from grid-layout.ts) and
// renders the house chip; the meeting in progress rises over the now line.
// "+N" lists what didn't fit side by side, and a row opens it like a click.

import { type ReactNode, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { continuationLabel, type EventChip } from "../events";
import {
  type ChipSpan,
  type DayGeometry,
  GRID_LAYER,
  type PlacedChip,
  wallMinuteOf,
} from "../grid-layout";
import type { TaskBlock } from "../lens";
import { COMPACT_BELOW_MINUTES, EventChipView } from "./event-chip";
import { formatTimeOfDay } from "./time-format";

/** A grid chip under a gesture — either kind shares the engine. */
export type GestureTarget = { type: "event"; chip: EventChip } | { type: "task"; block: TaskBlock };

/** CSS length for a minute offset: hour height × hours. */
function y(minutes: number): string {
  return `calc(var(--cal-hour-h) * ${minutes / 60})`;
}

/** Minutes of a card left visible above the card that cascades over it. */
export function shownMinutes(
  coveredFromMs: number | null,
  span: ChipSpan,
  geom: DayGeometry,
): number {
  if (coveredFromMs == null) return span.heightMinutes;
  return Math.min(span.heightMinutes, wallMinuteOf(coveredFromMs, geom) - span.topMinutes);
}

export function GridEventCard({
  chip,
  span,
  placed,
  geom,
  hue,
  draggable,
  selected,
  nowMs,
  nowMinutes,
  onPointerDown,
  stale = false,
  waiting = false,
  aside = null,
}: {
  chip: EventChip;
  span: ChipSpan;
  placed: PlacedChip;
  geom: DayGeometry;
  hue: string;
  draggable: boolean;
  selected: boolean;
  /** Absolute now for past styling (see DayColumn). */
  nowMs: number;
  /** Now's wall-clock minute on today's column; null elsewhere. */
  nowMinutes: number | null;
  onPointerDown: (e: React.PointerEvent) => void;
  /** Its account didn't sync (CALR-3). */
  stale?: boolean;
  /** A change to it waits to sync (CALR-3). */
  waiting?: boolean;
  /** Day view's prep in the card's free width (CALR-12). */
  aside?: ReactNode;
}) {
  // The meeting in progress sits over the now line and carries it faintly
  // under its title (AC10).
  const live = nowMinutes != null && chip.startMs <= nowMs && nowMs < chip.endMs;
  return (
    <div
      data-chip="event"
      className={cn("absolute pl-px pr-0.5", draggable && "cursor-grab")}
      style={{
        top: y(span.topMinutes),
        height: `max(${y(span.heightMinutes)}, 1.375rem)`,
        left: `${placed.left * 100}%`,
        width: `${placed.width * 100}%`,
        zIndex: live ? GRID_LAYER.live : placed.layer,
      }}
      onPointerDown={onPointerDown}
    >
      <EventChipView
        title={chip.title}
        startMs={chip.startMs}
        endMs={chip.endMs}
        hue={hue}
        compact={shownMinutes(placed.coveredFromMs, span, geom) < COMPACT_BELOW_MINUTES}
        readOnly={chip.readOnly}
        recurring={chip.recurring}
        selected={selected}
        past={chip.endMs < nowMs}
        continuation={continuationLabel(chip, formatTimeOfDay)}
        nowFraction={live ? (nowMinutes - span.topMinutes) / Math.max(span.heightMinutes, 1) : null}
        locked={chip.locked}
        stale={stale}
        waiting={waiting}
        aside={aside}
      />
    </div>
  );
}

/** "+N" on a crowded slot: a short list of what didn't fit; a row opens it. */
export function OverflowList({
  top,
  rows,
  onPick,
}: {
  top: string;
  rows: GestureTarget[];
  onPick: (target: GestureTarget, rect: DOMRect) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-chip="overflow"
          aria-label={`${rows.length} more`}
          className="absolute right-0.5 rounded-md border border-border bg-popover px-1 text-2xs text-muted-foreground tabular-nums transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ top, zIndex: GRID_LAYER.overflow }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          +{rows.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" sideOffset={6} className="w-60 p-1">
        <ul className="flex flex-col">
          {rows.map((row) => (
            <OverflowRow
              key={row.type === "event" ? row.chip.occurrenceKey : row.block.blockId}
              row={row}
              onPick={() => {
                const rect = triggerRef.current?.getBoundingClientRect() ?? new DOMRect();
                setOpen(false);
                onPick(row, rect);
              }}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function OverflowRow({ row, onPick }: { row: GestureTarget; onPick: () => void }) {
  const item = row.type === "event" ? row.chip : row.block;
  return (
    <li>
      <button
        type="button"
        className="flex w-full min-w-0 items-baseline gap-2 rounded-sm px-2 py-1 text-left text-xs transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onPick}
      >
        <span className="min-w-0 flex-1 truncate text-foreground">{item.title || "Untitled"}</span>
        <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
          {formatTimeOfDay(item.startMs)} – {formatTimeOfDay(item.endMs)}
        </span>
      </button>
    </li>
  );
}
