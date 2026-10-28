// The event chip — a calendar entry on the grid, the house calendar chip
// (CALR-1, AC7): every event, native or mirrored, takes its calendar's tinted
// surface with a hairline in its hue (`.cal-chip` over the [data-label]
// tokens), title first and the time a step smaller. A one-line chip reads
// "title  start" and drops the time before the title truncates. Past events
// dim and lose the hairline; the selected one gets the ring. The meeting in
// progress carries the now line across faintly, under its text (AC10).

import { Lock, Repeat } from "lucide-react";

import { cn } from "@/lib/utils";

import { formatTimeOfDay } from "./time-format";

/** Chips with less visible height than this render the one-line layout. */
export const COMPACT_BELOW_MINUTES = 40;

type Props = {
  title: string;
  startMs: number;
  endMs: number;
  /** The calendar's label hue (gray for Your calendar). */
  hue: string;
  /** One line: title then start time. */
  compact: boolean;
  /** Mirrored and view-only: says so in the tooltip. */
  readOnly: boolean;
  recurring: boolean;
  selected: boolean;
  past: boolean;
  allDay?: boolean;
  /** "→ Thu 7:10" / "from Wed 22:40" on an overnight event's pieces. */
  continuation?: string | null;
  /** Where now sits inside a meeting in progress (0–1); null otherwise. */
  nowFraction?: number | null;
  /** Your own private event (CALR-15): a lock. */
  locked?: boolean;
};

export function EventChipView({
  title,
  startMs,
  endMs,
  hue,
  compact,
  readOnly,
  recurring,
  selected,
  past,
  allDay = false,
  continuation = null,
  nowFraction = null,
  locked = false,
}: Props) {
  const live = nowFraction != null;
  const timeLabel = allDay ? "All day" : `${formatTimeOfDay(startMs)} – ${formatTimeOfDay(endMs)}`;
  return (
    <div
      data-chip="event"
      data-label={hue}
      data-past={past || undefined}
      data-selected={selected || undefined}
      data-live={live || undefined}
      data-private={locked || undefined}
      title={[title, timeLabel, continuation, readOnly ? "read-only" : null]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "cal-chip relative flex h-full w-full flex-col overflow-hidden rounded-md border px-1.5 py-0.5 text-left",
        "transition-[filter,opacity] duration-(--motion-fast) ease-(--ease-out)",
        selected && "ring-2 ring-ring",
        compact && "py-0",
      )}
    >
      {live ? <NowTick fraction={nowFraction} /> : null}
      {compact ? (
        <ChipOneLine
          title={title}
          time={continuation ?? (allDay ? null : formatTimeOfDay(startMs))}
          locked={locked}
        />
      ) : (
        <ChipStacked
          title={title}
          time={timeLabel}
          recurring={recurring}
          continuation={continuation}
          locked={locked}
        />
      )}
      {live ? <span className="sr-only">, happening now</span> : null}
    </div>
  );
}

/** The faint now line and its tick across the meeting in progress, under its text. */
function NowTick({ fraction }: { fraction: number }) {
  return (
    <div
      aria-hidden
      data-now-tick
      className="cal-now-tick pointer-events-none absolute inset-x-0"
      style={{ top: `${Math.min(Math.max(fraction, 0), 1) * 100}%` }}
    />
  );
}

/** "title  start" on one line; when both don't fit, the time wraps onto the
 *  clipped second row, so it goes before the title truncates. */
function ChipOneLine({
  title,
  time,
  locked,
}: {
  title: string;
  time: string | null;
  locked: boolean;
}) {
  return (
    <div
      data-chip-line
      className="cal-chip-line relative flex flex-wrap items-baseline gap-x-1.5 overflow-hidden text-xs"
    >
      {locked ? <PrivateLock /> : null}
      <span data-chip-title className="min-w-0 max-w-full truncate text-foreground">
        {title}
      </span>
      {time ? (
        <span
          data-chip-time
          data-drop="first"
          className="shrink-0 text-2xs text-muted-foreground tabular-nums"
        >
          {time}
        </span>
      ) : null}
    </div>
  );
}

function ChipStacked({
  title,
  time,
  recurring,
  continuation,
  locked,
}: {
  title: string;
  time: string;
  recurring: boolean;
  continuation: string | null;
  locked: boolean;
}) {
  return (
    <>
      <div className="relative flex min-w-0 items-center gap-1">
        <span data-chip-title className="min-w-0 flex-1 truncate text-xs text-foreground">
          {title}
        </span>
        {recurring ? (
          <Repeat aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" />
        ) : null}
        {locked ? <PrivateLock /> : null}
      </div>
      <span
        data-chip-time
        className="relative truncate text-2xs text-muted-foreground tabular-nums"
      >
        {time}
      </span>
      {continuation ? (
        <span className="relative truncate text-2xs text-muted-foreground">{continuation}</span>
      ) : null}
    </>
  );
}

function PrivateLock() {
  return (
    <Lock
      role="img"
      aria-label="Private"
      className="size-icon-xs shrink-0 self-center text-muted-foreground"
    />
  );
}
