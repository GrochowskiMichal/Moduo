// The Month view (CALR-12, AC12): six week rows. Each cell has its date (today
// in the pill; the date opens the day) with the day's open due count beside
// it; the week's all-day items run as bars under the date row; then the day's
// lines, one-offs before routines, and "N more" opening the day when they
// don't fit. The past dims everywhere, bars included. Layout is
// `month-layout.ts`; this file measures how many lines a cell fits and draws.
// Inline styles are runtime grid placement only (columns, rows, spans).

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { type EventChip, eventHue } from "../events";
import type { DueChip, TaskBlock } from "../lens";
import { layoutMonth, type MonthCell, type MonthLine, monthOf } from "../month-layout";
import { DueList } from "./day-header";
import { EventChipView } from "./event-chip";
import { formatTimeOfDay } from "./time-format";

type Props = {
  days: readonly Date[];
  now: Date;
  eventsByDay: ReadonlyMap<string, readonly EventChip[]>;
  allDayByDay: ReadonlyMap<string, readonly EventChip[]>;
  blocksByDay: ReadonlyMap<string, readonly TaskBlock[]>;
  dueByDay: ReadonlyMap<string, readonly DueChip[]>;
  accountHues: Record<string, string>;
  selectedOccurrenceKey: string | null;
  onSelectOccurrence: (key: string | null) => void;
  onEventClick: (chip: EventChip, rect: DOMRect) => void;
  onTaskClick: (block: TaskBlock, rect: DOMRect) => void;
  /** The date or "N more": show that day in Day view. */
  onOpenDay: (day: Date) => void;
  onDueClick?: (taskId: string) => void;
  /** Schedule (S) in a date's due list; absent for a view-only reader. */
  onScheduleDue?: (taskId: string, day: Date) => void;
  /** Accounts that didn't sync: their items carry the sync mark (CALR-3). */
  staleAccountIds?: ReadonlySet<string>;
};

/** Lines a cell fits before it is measured (and in tests, which lay nothing out). */
const DEFAULT_CAPACITY = 4;
const NONE: ReadonlySet<string> = new Set();
const NOOP = () => {};

function dayLabel(day: Date): string {
  return day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** How many lines fit under a cell's date row, from the grid's height and one line's. */
function useCellCapacity() {
  const ref = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const cell = root.querySelector<HTMLElement>("[data-month-cell]");
      const probe = root.querySelector<HTMLElement>("[data-month-probe]");
      const lines = cell?.querySelector<HTMLElement>("[data-month-lines]");
      if (!cell || !probe || !lines || probe.offsetHeight === 0) return;
      const gap = Number.parseFloat(getComputedStyle(lines).rowGap) || 0;
      const pad = Number.parseFloat(getComputedStyle(cell).paddingBottom) || 0;
      const room = cell.clientHeight - pad - (lines.offsetTop - cell.offsetTop);
      const next = Math.max(1, Math.floor((room + gap) / (probe.offsetHeight + gap)));
      setCapacity((cur) => (cur === next ? cur : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  return { ref, capacity };
}

export function CalendarMonth({
  days,
  now,
  eventsByDay,
  allDayByDay,
  blocksByDay,
  dueByDay,
  accountHues,
  selectedOccurrenceKey,
  onSelectOccurrence,
  onEventClick,
  onTaskClick,
  onOpenDay,
  onDueClick = NOOP,
  onScheduleDue,
  staleAccountIds = NONE,
}: Props) {
  const { ref, capacity } = useCellCapacity();
  const weeks = useMemo(
    () =>
      layoutMonth({
        days,
        month: monthOf({ days: [...days] }),
        now,
        eventsByDay,
        allDayByDay,
        blocksByDay,
        dueByDay,
        capacity,
      }),
    [days, now, eventsByDay, allDayByDay, blocksByDay, dueByDay, capacity],
  );
  const cols = weeks[0]?.cells.length ?? 7;
  const columns = `repeat(${cols}, minmax(0, 1fr))`;
  const pickEvent = useCallback(
    (chip: EventChip, el: HTMLElement) => {
      onSelectOccurrence(chip.occurrenceKey);
      onEventClick(chip, el.getBoundingClientRect());
    },
    [onSelectOccurrence, onEventClick],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        aria-hidden
        className="grid shrink-0 border-b border-border"
        style={{ gridTemplateColumns: columns }}
      >
        {weeks[0]?.cells.map((c) => (
          <div
            key={c.dayKey}
            className="px-2 pb-1.5 text-2xs font-medium tracking-wide text-subtle-foreground"
          >
            {c.day.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div
        ref={ref}
        role="region"
        aria-label={monthOf({ days: [...days] }).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        })}
        className="relative grid min-h-0 flex-1 grid-rows-6"
      >
        {/* one line's height, for measuring how many fit */}
        <div
          aria-hidden
          data-month-probe
          className="pointer-events-none invisible absolute h-(--ctrl-h-xs)"
        />
        {weeks.map((week) => (
          <div
            key={week.cells[0]?.dayKey}
            data-month-week
            className="relative min-h-0 border-b border-border"
          >
            <div className="grid h-full min-h-0" style={{ gridTemplateColumns: columns }}>
              {week.cells.map((cell) => (
                <MonthDay
                  key={cell.dayKey}
                  cell={cell}
                  accountHues={accountHues}
                  selectedOccurrenceKey={selectedOccurrenceKey}
                  staleAccountIds={staleAccountIds}
                  onPickEvent={pickEvent}
                  onTaskClick={onTaskClick}
                  onOpenDay={onOpenDay}
                  onDueClick={onDueClick}
                  onScheduleDue={onScheduleDue}
                />
              ))}
            </div>
            {/* the bars sit over the week's days, under their dates */}
            {week.bars.length > 0 ? (
              <div
                className="pointer-events-none absolute inset-x-0 top-8.5 grid gap-y-0.5"
                style={{ gridTemplateColumns: columns }}
              >
                {week.bars.map((bar) => (
                  <button
                    key={bar.chip.occurrenceKey}
                    type="button"
                    data-chip="event"
                    className="pointer-events-auto relative block h-(--ctrl-h-xs) min-w-0 px-1 text-left"
                    style={{
                      gridColumn: `${bar.startCol + 1} / span ${bar.span}`,
                      gridRow: bar.row + 1,
                    }}
                    onClick={(e) => pickEvent(bar.chip, e.currentTarget)}
                  >
                    <EventChipView
                      title={bar.chip.title}
                      startMs={bar.chip.startMs}
                      endMs={bar.chip.endMs}
                      compact
                      allDay
                      continuation={bar.lengthLabel}
                      hue={eventHue(bar.chip, accountHues)}
                      readOnly={bar.chip.readOnly}
                      recurring={bar.chip.recurring}
                      selected={selectedOccurrenceKey === bar.chip.occurrenceKey}
                      past={bar.past}
                      locked={bar.chip.locked}
                      focus={bar.chip.focus}
                      holdsTask={bar.chip.holdsTask}
                      stale={
                        bar.chip.sourceAccountId !== null &&
                        staleAccountIds.has(bar.chip.sourceAccountId)
                      }
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One day; memoised, so a selection or a tick redraws only the days it touches. */
const MonthDay = memo(function MonthDay({
  cell,
  accountHues,
  selectedOccurrenceKey,
  staleAccountIds,
  onPickEvent,
  onTaskClick,
  onOpenDay,
  onDueClick,
  onScheduleDue,
}: {
  cell: MonthCell;
  accountHues: Record<string, string>;
  selectedOccurrenceKey: string | null;
  staleAccountIds: ReadonlySet<string>;
  onPickEvent: (chip: EventChip, el: HTMLElement) => void;
  onTaskClick: (block: TaskBlock, rect: DOMRect) => void;
  onOpenDay: (day: Date) => void;
  onDueClick: (taskId: string) => void;
  onScheduleDue?: (taskId: string, day: Date) => void;
}) {
  const label = dayLabel(cell.day);
  const weekend = cell.day.getDay() === 0 || cell.day.getDay() === 6;
  return (
    <div
      role="group"
      aria-label={label}
      data-month-cell={cell.dayKey}
      data-past={cell.past || undefined}
      data-today={cell.today || undefined}
      aria-current={cell.today ? "date" : undefined}
      className={cn(
        "flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-l border-border px-1 pb-1.5 pt-1 first:border-l-0",
        weekend && "bg-muted/40",
      )}
    >
      <div className="flex h-7 min-w-0 shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label={`Open ${label}`}
          onClick={() => onOpenDay(cell.day)}
          className={cn(
            "inline-grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-1.5 font-display text-sm font-semibold tabular-nums transition-colors duration-(--motion-fade) ease-(--ease-out) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            cell.today
              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
              : cn(
                  "hover:bg-state-hover hover:text-foreground",
                  !cell.inMonth || cell.past ? "text-subtle-foreground" : "text-foreground",
                ),
          )}
        >
          {cell.day.getDate() === 1
            ? cell.day.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : cell.day.getDate()}
        </button>
        {cell.due.length > 0 ? (
          <DueList
            day={cell.day}
            due={cell.due}
            onOpenTask={onDueClick}
            onSchedule={onScheduleDue ? (id) => onScheduleDue(id, cell.day) : null}
          />
        ) : null}
      </div>
      <div data-month-lines className="flex min-h-0 flex-col gap-0.5">
        {Array.from({ length: cell.barRows }, (_, i) => (
          <div key={`bar-${i}`} aria-hidden className="h-(--ctrl-h-xs) shrink-0" />
        ))}
        {cell.lines.map((line) => (
          <MonthLineButton
            key={line.key}
            line={line}
            hue={line.kind === "event" ? eventHue(line.chip, accountHues) : "gray"}
            selected={line.kind === "event" && selectedOccurrenceKey === line.chip.occurrenceKey}
            stale={
              line.kind === "event" &&
              line.chip.sourceAccountId !== null &&
              staleAccountIds.has(line.chip.sourceAccountId)
            }
            onPickEvent={onPickEvent}
            onTaskClick={onTaskClick}
          />
        ))}
        {cell.more > 0 ? (
          <button
            type="button"
            aria-label={`${cell.more} more on ${label}`}
            onClick={() => onOpenDay(cell.day)}
            className="flex h-(--ctrl-h-xs) shrink-0 items-center rounded-sm px-1 text-left text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {cell.more} more
          </button>
        ) : null}
      </div>
    </div>
  );
});

/** One line in a cell: the calendar's dot, the start, the title. Your work is ringed. */
function MonthLineButton({
  line,
  hue,
  selected,
  stale,
  onPickEvent,
  onTaskClick,
}: {
  line: MonthLine;
  hue: string;
  selected: boolean;
  stale: boolean;
  onPickEvent: (chip: EventChip, el: HTMLElement) => void;
  onTaskClick: (block: TaskBlock, rect: DOMRect) => void;
}) {
  const item = line.kind === "event" ? line.chip : line.block;
  const title = item.title || "Untitled";
  const time = formatTimeOfDay(item.startMs);
  return (
    <button
      type="button"
      data-chip={line.kind}
      data-past={line.past || undefined}
      aria-label={`${title}, ${time}${line.kind === "task" ? ", your task" : ""}${stale ? ", not synced" : ""}`}
      onClick={(e) =>
        line.kind === "event"
          ? onPickEvent(line.chip, e.currentTarget)
          : onTaskClick(line.block, e.currentTarget.getBoundingClientRect())
      }
      className={cn(
        "flex h-(--ctrl-h-xs) min-w-0 shrink-0 items-center gap-1.5 rounded-sm px-1 text-left text-xs transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-state-active ring-2 ring-ring",
      )}
    >
      {line.kind === "event" ? (
        <span
          aria-hidden
          data-label={hue}
          className={cn("cal-swatch size-1.5 shrink-0 rounded-full", line.past && "opacity-50")}
        />
      ) : (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full border border-timeline-outline"
        />
      )}
      <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">{time}</span>
      {/* The past steps down to the muted ink (no opacity, so it keeps its contrast). */}
      <span
        className={cn("min-w-0 truncate", line.past ? "text-muted-foreground" : "text-foreground")}
      >
        {title}
      </span>
    </button>
  );
}
