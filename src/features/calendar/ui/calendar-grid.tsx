// The Week/Day time grid. All vertical geometry rides `--cal-hour-h` (density-
// scaled) multiplied by REAL elapsed minutes from grid-layout.ts — DST days
// (23h/25h) render their own height and chip positions never drift; wall-clock
// inputs (working-hours prefs, "center on now") are converted through
// wallClockToRealMinutes/minutesIntoDay first. Inline styles here are
// runtime-computed geometry only (sanctioned); every color and radius is
// token-routed.
//
// Render economy: the 30s now-tick flows into the columns as ONE primitive
// (`nowMinutes` on today's column, null elsewhere) and DayColumn is memoized,
// so a tick re-renders today's column only — not the whole week.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { cn } from "@/lib/utils";
import {
  chipSpanInDay,
  dayGeometry,
  layoutDayChips,
  minutesIntoDay,
  wallClockToRealMinutes,
  type DayGeometry,
} from "../grid-layout";
import { localDayKey, type CalendarView, type TaskBlock } from "../lens";
import type { CalendarPrefs } from "../prefs";
import { TaskBlockChip } from "./task-block-chip";
import { formatHourLabel } from "./time-format";

const GUTTER_W = "3.25rem";
/** Chips shorter than this render the single-line compact layout. */
const COMPACT_BELOW_MINUTES = 40;
/** Stable identity for empty columns so the memoized DayColumn can bail out. */
const EMPTY_BLOCKS: TaskBlock[] = [];

type Props = {
  view: CalendarView;
  days: Date[];
  blocksByDay: Map<string, TaskBlock[]>;
  prefs: CalendarPrefs;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  canEdit: boolean;
  onToggleDone: (taskId: string) => void;
};

/** Re-render tick for the now-line; catches up on tab wake. */
function useNowTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    const onWake = () => setNow(new Date());
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [intervalMs]);
  return now;
}

/** CSS length for a minute offset: hour height × real hours. */
function y(minutes: number): string {
  return `calc(var(--cal-hour-h) * ${minutes / 60})`;
}

export function CalendarGrid({
  view,
  days,
  blocksByDay,
  prefs,
  loading,
  error,
  onRetry,
  canEdit,
  onToggleDone,
}: Props) {
  const now = useNowTick(30_000);
  const scrollRef = useRef<HTMLDivElement>(null);

  const geoms = useMemo(() => days.map(dayGeometry), [days]);
  const maxMinutes = useMemo(
    () => Math.max(...geoms.map((g) => g.totalMinutes)),
    [geoms],
  );
  // Gutter labels come from a full-height column so they align with its lines.
  // (Known cosmetic gap: on a DST week the 23h/25h column's own lines sit at
  // its real offsets, so the shared gutter reads an hour off for that one
  // column after the transition — the chips' own time labels stay truthful.)
  const refGeom = useMemo(
    () => geoms.find((g) => g.totalMinutes === maxMinutes) ?? geoms[0],
    [geoms, maxMinutes],
  );

  const todayKey = localDayKey(now);
  const hasAnyBlocks = useMemo(
    () => [...blocksByDay.values()].some((list) => list.length > 0),
    [blocksByDay],
  );

  // On open: center around now (or 9:00 when today isn't visible), in REAL
  // minutes so DST days center correctly. Not re-run on prev/next navigation —
  // only on mount and Day↔Week switches.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const current = new Date();
    const todayVisible = days.some((d) => localDayKey(d) === todayKey);
    const targetMinutes = todayVisible
      ? (minutesIntoDay(current.getTime(), dayGeometry(current)) ?? 9 * 60)
      : 9 * 60;
    const pxPerMinute = scroller.scrollHeight / maxMinutes;
    scroller.scrollTop = Math.max(
      0,
      targetMinutes * pxPerMinute - scroller.clientHeight / 2,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const columns = `${GUTTER_W} repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <div className="mb-2 flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>Couldn't load your tasks — the grid may be incomplete.</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* day headers */}
      <div
        className="grid shrink-0 border-b border-border pb-1.5"
        style={{ gridTemplateColumns: columns }}
      >
        <div aria-hidden />
        {days.map((day) => {
          const isToday = localDayKey(day) === todayKey;
          return (
            <div
              key={localDayKey(day)}
              className={cn(
                "flex items-baseline gap-1.5 px-2 text-sm",
                isToday
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <span>
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span className={cn(!isToday && "text-muted-foreground/70")}>
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* the hours grid */}
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: columns, height: y(maxMinutes) }}
        >
          {/* hour gutter */}
          <div className="relative" aria-hidden>
            {refGeom.hourMarks.slice(1).map((mark, i) => (
              <span
                key={`${mark.minuteOfDay}-${i}`}
                className="absolute right-2 -translate-y-1/2 text-2xs text-muted-foreground"
                style={{ top: y(mark.minuteOfDay) }}
              >
                {formatHourLabel(mark.hour)}
              </span>
            ))}
          </div>

          {days.map((day, i) => {
            const key = localDayKey(day);
            const isToday = key === todayKey;
            return (
              <DayColumn
                key={key}
                geom={geoms[i]}
                blocks={blocksByDay.get(key) ?? EMPTY_BLOCKS}
                prefs={prefs}
                nowMinutes={
                  isToday ? minutesIntoDay(now.getTime(), geoms[i]) : null
                }
                canEdit={canEdit}
                onToggleDone={onToggleDone}
                showLoadingChips={loading && !hasAnyBlocks && i < 2}
                emptyHint={
                  isToday && !loading && !error && !hasAnyBlocks
                    ? "Nothing scheduled — tasks with a time land here."
                    : null
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const DayColumn = memo(function DayColumn({
  geom,
  blocks,
  prefs,
  nowMinutes,
  canEdit,
  onToggleDone,
  showLoadingChips,
  emptyHint,
}: {
  geom: DayGeometry;
  blocks: TaskBlock[];
  prefs: CalendarPrefs;
  /** Real minutes into this day for the now-line; null off-today. */
  nowMinutes: number | null;
  canEdit: boolean;
  onToggleDone: (taskId: string) => void;
  showLoadingChips: boolean;
  emptyHint: string | null;
}) {
  const layout = useMemo(
    () =>
      layoutDayChips(
        blocks.map((b) => ({ id: b.taskId, startMs: b.startMs, endMs: b.endMs })),
      ),
    [blocks],
  );
  const byId = useMemo(
    () => new Map(blocks.map((b) => [b.taskId, b])),
    [blocks],
  );
  // Wall-clock prefs → real minutes (DST-correct wash bounds).
  const washTop = wallClockToRealMinutes(prefs.workStartMinute, geom);
  const washBottom = wallClockToRealMinutes(prefs.workEndMinute, geom);

  return (
    <div
      data-day-col
      className="relative border-l border-border"
      style={{ height: y(geom.totalMinutes) }}
    >
      {/* off-hours wash (the invisible working-hours bound, §10) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 bg-muted/40"
        style={{ height: y(washTop) }}
      />
      {washBottom < geom.totalMinutes ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-muted/40"
          style={{ height: y(geom.totalMinutes - washBottom) }}
        />
      ) : null}

      {/* hour lines */}
      {geom.hourMarks.slice(1).map((mark, i) => (
        <div
          key={`${mark.minuteOfDay}-${i}`}
          aria-hidden
          className="absolute inset-x-0 border-t border-border"
          style={{ top: y(mark.minuteOfDay) }}
        />
      ))}

      {/* task blocks */}
      {layout.placed.map((p) => {
        const block = byId.get(p.id);
        if (!block) return null;
        const span = chipSpanInDay(block.startMs, block.endMs, geom);
        if (!span) return null;
        return (
          <div
            key={p.id}
            className="absolute z-[1] pl-px pr-0.5"
            style={{
              top: y(span.topMinutes),
              height: `max(${y(span.heightMinutes)}, 1.375rem)`,
              left: `${(p.col / p.cols) * 100}%`,
              width: `${100 / p.cols}%`,
            }}
          >
            <TaskBlockChip
              title={block.title}
              startMs={block.startMs}
              endMs={block.endMs}
              done={block.done}
              compact={span.heightMinutes < COMPACT_BELOW_MINUTES}
              canEdit={canEdit}
              onToggleDone={() => onToggleDone(block.taskId)}
            />
          </div>
        );
      })}

      {/* "+N" overflow (popover list arrives with the chip popover, CAL-2) */}
      {layout.overflow.map((o, i) => {
        const span = chipSpanInDay(o.startMs, o.endMs, geom);
        if (!span) return null;
        const titles = o.ids
          .map((id) => byId.get(id)?.title)
          .filter(Boolean)
          .join(", ");
        return (
          <div
            key={`overflow-${i}`}
            title={titles}
            className="absolute right-0.5 z-[2] rounded-md border border-border bg-popover px-1 text-2xs text-muted-foreground"
            style={{ top: y(span.topMinutes) }}
          >
            +{o.ids.length}
          </div>
        );
      })}

      {/* loading shimmer */}
      {showLoadingChips ? (
        <>
          <div
            aria-hidden
            className="absolute inset-x-1 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
            style={{ top: y(9 * 60), height: y(60) }}
          />
          <div
            aria-hidden
            className="absolute inset-x-1 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
            style={{ top: y(13 * 60), height: y(90) }}
          />
        </>
      ) : null}

      {/* now line — today's column only */}
      {nowMinutes != null ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-[3]"
          style={{ top: y(nowMinutes) }}
        >
          <div className="relative h-px bg-primary">
            <div className="absolute -left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
          </div>
        </div>
      ) : null}

      {/* quiet empty hint (spec §9) */}
      {emptyHint ? (
        <div className="pointer-events-none absolute inset-x-2 top-1/3 z-[1] text-center text-xs text-muted-foreground">
          {emptyHint}
        </div>
      ) : null}
    </div>
  );
});
