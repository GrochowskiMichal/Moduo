// The all-day lane above the hours (CALR-2, AC3): at most two rows, so it never
// buries the hours. A multi-day item is one bar carrying its length ("2 days");
// past the cap the second row says per day "+N more", which opens that day's
// all-day list under the day. ⇧A (or the gutter toggle) shows every row, Less
// folds them back. Due tasks never sit here; the day headers count them.
// Inline styles are runtime grid placement only (columns, rows, spans).

import { useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { useAppHotkeys } from "../../../lib/hotkeys";
import { ALL_DAY_MAX_ROWS, layoutAllDayLane } from "../allday-lane";
import { type EventChip, eventHue } from "../events";
import { localDayKey } from "../lens";
import { ALL_DAY_LANE_CLASS } from "./calendar-skeleton";
import { EventChipView } from "./event-chip";

type Props = {
  days: readonly Date[];
  /** The grid's column template (gutter + days), shared with the headers and hours. */
  columns: string;
  allDayByDay: ReadonlyMap<string, readonly EventChip[]>;
  accountHues: Record<string, string>;
  selectedOccurrenceKey: string | null;
  /** The grid's ticking now: bars that ended dim. */
  nowMs: number;
  onPick: (chip: EventChip, rect: DOMRect) => void;
  /** Accounts that didn't sync: their bars carry the sync mark (CALR-3). */
  staleAccountIds?: ReadonlySet<string>;
  /** Events whose change waits to sync: the cloud-off mark. */
  waitingEventIds?: ReadonlySet<string>;
};

const NONE: ReadonlySet<string> = new Set();

export function AllDayLane({
  days,
  columns,
  allDayByDay,
  accountHues,
  selectedOccurrenceKey,
  nowMs,
  onPick,
  staleAccountIds = NONE,
  waitingEventIds = NONE,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const dayKeys = useMemo(() => days.map(localDayKey), [days]);
  const lane = useMemo(
    () => layoutAllDayLane(dayKeys, allDayByDay, { expanded }),
    [dayKeys, allDayByDay, expanded],
  );

  useAppHotkeys(
    {
      "calendar.all-day": (e) => {
        if (e.target instanceof Element && e.target.closest("[role='dialog'], [role='menu']")) {
          return false;
        }
        setExpanded((v) => !v);
      },
    },
    { enabled: lane.overflows },
  );

  if (lane.rows === 0) return null;
  const moreRow = lane.overflows && !expanded ? ALL_DAY_MAX_ROWS : null;

  return (
    <div
      data-allday-lane
      data-allday-rows={lane.rows}
      className={ALL_DAY_LANE_CLASS}
      style={{ gridTemplateColumns: columns }}
    >
      <div className="flex flex-col items-end gap-0.5 pr-1.5 text-2xs text-subtle-foreground">
        <span className="flex h-(--ctrl-h-xs) items-center">all-day</span>
        {lane.overflows ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Show two all-day rows (Shift A)" : "Show every all-day row (Shift A)"
            }
            className="inline-flex h-(--ctrl-h-xs) items-center whitespace-nowrap rounded-sm px-1 text-2xs text-subtle-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? "Less" : "⇧A"}
          </button>
        ) : null}
      </div>
      <div
        className="relative grid gap-y-0.5"
        style={{
          gridColumn: `2 / span ${days.length}`,
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${lane.rows}, var(--ctrl-h-xs))`,
        }}
      >
        {dayKeys.map((key, col) => (
          <div
            key={`col:${key}`}
            aria-hidden
            className="border-l border-border"
            style={{ gridColumn: col + 1, gridRow: "1 / -1" }}
          />
        ))}
        {lane.bars.map((bar) => (
          <button
            key={bar.chip.occurrenceKey}
            type="button"
            data-chip="event"
            className="relative block min-w-0 px-0.5 text-left"
            style={{ gridColumn: `${bar.startCol + 1} / span ${bar.span}`, gridRow: bar.row + 1 }}
            onClick={(e) => onPick(bar.chip, e.currentTarget.getBoundingClientRect())}
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
              past={bar.chip.endMs <= nowMs}
              locked={bar.chip.locked}
              stale={
                bar.chip.sourceAccountId !== null && staleAccountIds.has(bar.chip.sourceAccountId)
              }
              waiting={waitingEventIds.has(bar.chip.eventId)}
            />
          </button>
        ))}
        {moreRow !== null
          ? lane.hiddenByDay.map((hidden, col) =>
              hidden > 0 ? (
                <DayAllDayList
                  key={`more:${dayKeys[col]}`}
                  day={days[col]}
                  col={col}
                  row={moreRow}
                  hidden={hidden}
                  chips={allDayByDay.get(dayKeys[col]) ?? []}
                  accountHues={accountHues}
                  onPick={onPick}
                />
              ) : null,
            )
          : null}
      </div>
    </div>
  );
}

/** "+N more" for one day, opening that day's all-day list under it. */
function DayAllDayList({
  day,
  col,
  row,
  hidden,
  chips,
  accountHues,
  onPick,
}: {
  day: Date;
  col: number;
  row: number;
  hidden: number;
  chips: readonly EventChip[];
  accountHues: Record<string, string>;
  onPick: (chip: EventChip, rect: DOMRect) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = day.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${hidden} more all-day on ${label}`}
          className="mx-0.5 flex min-w-0 items-center rounded-sm px-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-state-active aria-expanded:text-foreground"
          style={{ gridColumn: col + 1, gridRow: row }}
        >
          +{hidden} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">All day · {label}</div>
        <div className="flex flex-col gap-0.5">
          {chips.map((chip) => (
            <button
              key={chip.occurrenceKey}
              type="button"
              className="block w-full text-left"
              onClick={(e) => {
                setOpen(false);
                onPick(chip, e.currentTarget.getBoundingClientRect());
              }}
            >
              <EventChipView
                title={chip.title}
                startMs={chip.startMs}
                endMs={chip.endMs}
                compact
                allDay
                hue={eventHue(chip, accountHues)}
                readOnly={chip.readOnly}
                recurring={chip.recurring}
                selected={false}
                past={false}
                locked={chip.locked}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
