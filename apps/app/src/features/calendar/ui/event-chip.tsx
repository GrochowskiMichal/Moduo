// The event chip — a calendar entry on the grid, the house calendar chip
// (CALR-1, AC7): every event, native or mirrored, takes its calendar's tinted
// surface with a hairline in its hue (`.cal-chip` over the [data-label]
// tokens), title first and the time a step smaller. A one-line chip reads
// "title  start" and drops the time before the title truncates. Past events
// dim and lose the hairline; the selected one gets the ring. The meeting in
// progress carries the now line across faintly, under its text (AC10).
// CALR-3: an event of an account that didn't sync carries the sync mark and
// keeps full strength; a change waiting to sync carries the cloud-off mark.
// CALR-14: focus time is a quiet band (`.cal-chip[data-kind="focus"]`) with a
// "Focus" eyebrow, and a task mark when it holds a task.

import { CircleDashed, CloudOff, Crosshair, Lock, RefreshCwOff, Repeat } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { focusChipTitle } from "../focus-item";
import { hueAttrs } from "../hue";
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
  /** Its account didn't sync: the sync mark, at full strength (CALR-3). */
  stale?: boolean;
  /** A change to it waits to sync: the cloud-off mark (CALR-3). */
  waiting?: boolean;
  /** Day view's prep in the chip's free width (CALR-12): people, notes, follow-up, where. */
  aside?: ReactNode;
  /** Focus time (CALR-14): the band, the eyebrow; `holdsTask` adds the task mark. */
  focus?: boolean;
  holdsTask?: boolean;
  /** An offer's held time (CALR-19): dashed. */
  held?: boolean;
};

/** The chip's tooltip: what it is, when, and what's true of it. */
function chipTooltip(
  title: string,
  timeLabel: string,
  continuation: string | null,
  notes: Record<string, boolean>,
): string {
  const flags = Object.entries(notes)
    .filter(([, on]) => on)
    .map(([note]) => note);
  return [title, timeLabel, continuation, ...flags].filter(Boolean).join(" · ");
}

/** `data-*` flags that are present only when true. */
function onlyTrue(flags: Record<string, boolean>): Record<string, true | undefined> {
  return Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v || undefined]));
}

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
  stale = false,
  waiting = false,
  aside = null,
  focus = false,
  holdsTask = false,
  held = false,
}: Props) {
  const live = nowFraction != null;
  const timeLabel = allDay ? "All day" : `${formatTimeOfDay(startMs)} – ${formatTimeOfDay(endMs)}`;
  const marks = (
    <>
      <SyncMarks stale={stale} waiting={waiting} />
      {holdsTask ? (
        <CircleDashed
          role="img"
          aria-label="Holds a task"
          data-mark="task"
          className="size-icon-xs shrink-0 self-center text-muted-foreground"
        />
      ) : null}
    </>
  );
  return (
    <div
      data-chip="event"
      {...hueAttrs(hue)}
      data-kind={focus ? "focus" : held ? "hold" : undefined}
      {...onlyTrue({
        "data-past": past,
        "data-selected": selected,
        "data-live": live,
        "data-private": locked,
        "data-stale": stale,
        "data-waiting": waiting,
      })}
      title={chipTooltip(title, timeLabel, continuation, {
        "read-only": readOnly,
        "not synced": stale,
        "waiting to sync": waiting,
        "holds a task": holdsTask,
      })}
      className={cn(
        "cal-chip relative flex h-full w-full flex-col overflow-hidden rounded-md border px-1.5 py-0.5 text-left",
        "transition-[filter] duration-(--motion-fast) ease-(--ease-out)",
        selected && "ring-2 ring-ring",
        held && "border-dashed",
        compact && "py-0",
      )}
    >
      {live ? <NowTick fraction={nowFraction} /> : null}
      <WithAside aside={aside}>
        {compact ? (
          <ChipOneLine
            title={focusChipTitle(title, focus)}
            time={continuation ?? (allDay ? null : formatTimeOfDay(startMs))}
            locked={locked}
            marks={marks}
          />
        ) : (
          <ChipStacked
            title={title}
            time={timeLabel}
            recurring={recurring}
            continuation={continuation}
            locked={locked}
            marks={marks}
            focus={focus}
          />
        )}
      </WithAside>
      {live ? <span className="sr-only">, happening now</span> : null}
    </div>
  );
}

/** The chip's text, and beside it (when there is one) the prep in the free width. */
function WithAside({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  if (!aside) return <>{children}</>;
  return (
    <div className="relative flex min-w-0 items-start gap-3">
      <div className="flex min-w-0 max-w-3/5 shrink-0 flex-col">{children}</div>
      <div data-chip-aside className="flex min-w-0 flex-1 justify-start overflow-hidden">
        {aside}
      </div>
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
  marks,
}: {
  title: string;
  time: string | null;
  locked: boolean;
  marks: ReactNode;
}) {
  return (
    <div
      data-chip-line
      className="cal-chip-line relative flex flex-wrap items-baseline gap-x-1.5 overflow-hidden text-xs"
    >
      {/* The lock and marks ride with the title as one item, so they never
          push it onto the clipped second row. */}
      <span className="inline-flex min-w-0 max-w-full items-center gap-1">
        {locked ? <PrivateLock /> : null}
        {marks}
        <span data-chip-title className="min-w-0 truncate text-foreground">
          {title}
        </span>
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
  marks,
  focus,
}: {
  title: string;
  time: string;
  recurring: boolean;
  continuation: string | null;
  locked: boolean;
  marks: ReactNode;
  focus: boolean;
}) {
  return (
    <>
      {focus ? (
        <span
          data-focus-eyebrow
          className="relative flex items-center gap-1 text-2xs text-muted-foreground"
        >
          <Crosshair aria-hidden className="size-icon-xs shrink-0" />
          Focus
        </span>
      ) : null}
      <div className="relative flex min-w-0 items-center gap-1">
        <span data-chip-title className="min-w-0 flex-1 truncate text-xs text-foreground">
          {title}
        </span>
        {recurring ? (
          <Repeat aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" />
        ) : null}
        {locked ? <PrivateLock /> : null}
        {marks}
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

/** The stale mark (its account didn't sync) and the cloud-off mark (waiting to sync). */
function SyncMarks({ stale, waiting }: { stale: boolean; waiting: boolean }) {
  return (
    <>
      {stale ? (
        <RefreshCwOff
          role="img"
          aria-label="Not synced"
          data-mark="stale"
          className="size-icon-xs shrink-0 self-center text-warning"
        />
      ) : null}
      {waiting ? (
        <CloudOff
          role="img"
          aria-label="Waiting to sync"
          data-mark="waiting"
          className="size-icon-xs shrink-0 self-center text-muted-foreground"
        />
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
