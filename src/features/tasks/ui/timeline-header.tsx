// The Timeline's time header (TV-TL1, REPLAN 69): two tiers, sticky — months
// above (years at Year), days, weeks or months below — with the Today pill,
// and the optional third tier "Due per week" (REPLAN 67, AC2.7): quiet
// numbers, no heat colours, the busiest week a step brighter. The corner over
// the name column holds its resize handle (200–480 px). No text is ever
// rotated (46a).

import {
  type PointerEvent as ReactPointerEvent,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import { cn } from "../../../lib/utils";
import {
  bottomTier,
  dayCenterX,
  type HeaderCell,
  strongLines,
  weekStartOf,
  xOfDay,
} from "../timeline-scale";
import {
  TimelineViewportContext,
  TimelineWindowContext,
  useTimelineGeometry,
} from "./timeline-marks";

/** Below this width a cell's label would crowd its neighbours: it stays blank. */
function labelFits(text: string, width: number): boolean {
  return width >= text.length * 7 + 6;
}

/**
 * The px of a header cell still on screen past the name column, given the
 * first day on screen: a month that has mostly scrolled away under the
 * column keeps only its last days.
 */
export function shownWidth(cell: HeaderCell, firstDayOnScreen: number, dw: number): number {
  return Math.max(0, cell.end - Math.max(cell.start, firstDayOnScreen) + 1) * dw;
}

/**
 * A month's (or year's) name, sticky at the name column's edge. When less of
 * the month is left on screen than its name needs, the name goes (it would
 * show only a fragment, "…ber", sliding under the column). It redraws only
 * when that flips, never on every scroll frame.
 */
function TopLabel({ cell, width }: { cell: HeaderCell; width: number }) {
  const { dw } = useTimelineGeometry();
  const viewport = useContext(TimelineViewportContext);
  const text = labelFits(cell.label, width) ? cell.label : cell.label.slice(0, 3);
  const fits = useSyncExternalStore(viewport.subscribe, () =>
    labelFits(text, shownWidth(cell, viewport.get().from, dw)),
  );
  if (!fits) return null;
  return (
    <span
      className="sticky ps-2 font-sans text-xs font-medium whitespace-nowrap text-muted-foreground"
      style={{ left: "var(--timeline-name-w)" }}
    >
      {text}
    </span>
  );
}

export function TimelineHeader({
  topCells,
  weekStartsOn,
  dueCounts,
  onResizeStart,
}: {
  /** The top tier's cells (months, or years at Year). */
  topCells: readonly HeaderCell[];
  weekStartsOn: number;
  /** Due per week, by each week's first day; null when it's off. */
  dueCounts: ReadonlyMap<number, number> | null;
  onResizeStart: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const { range, dw, zoom, today, nameHidden } = useTimelineGeometry();
  const drawn = useContext(TimelineWindowContext);
  const units = useMemo(
    () => bottomTier(zoom, drawn, today, weekStartsOn),
    [zoom, drawn, today, weekStartsOn],
  );
  const strong = useMemo(() => strongLines(zoom, drawn), [zoom, drawn]);
  const weeks = useMemo(() => {
    if (!dueCounts) return [];
    const out: Array<{ start: number; count: number }> = [];
    for (let s = weekStartOf(drawn.from, weekStartsOn); s <= drawn.to; s += 7) {
      out.push({ start: s, count: dueCounts.get(s) ?? 0 });
    }
    return out;
  }, [dueCounts, drawn, weekStartsOn]);
  const busiest = weeks.reduce((m, w) => Math.max(m, w.count), 0);
  const todayX = dayCenterX(range, dw, today);

  return (
    <div data-timeline-header="" className="flex w-full bg-card shadow-[0_1px_0_var(--hairline)]">
      <div
        className={cn(
          "sticky left-0 z-[3] flex w-(--timeline-name-w) shrink-0 flex-col justify-end bg-card",
          nameHidden ? "overflow-hidden" : "border-r border-hairline",
        )}
      >
        {dueCounts && !nameHidden ? (
          <span className="flex h-(--ctrl-h-xs) items-center ps-4 font-sans text-xs text-subtle-foreground">
            Due per week
          </span>
        ) : null}
        {nameHidden ? null : (
          // The name column's edge: drag to resize it (200–480 px). A mouse
          // affordance; the keyboard hides the column with ⇧[.
          <span
            aria-hidden
            data-timeline-resize=""
            onPointerDown={onResizeStart}
            className="absolute inset-y-0 -right-1 z-[1] w-2 cursor-col-resize"
          />
        )}
      </div>
      <div className="relative min-w-0 flex-1" aria-hidden>
        {/* A month's name slides out under the name column's edge: fade it there. */}
        <div className="sticky left-(--timeline-name-w) z-[2] h-0 w-6">
          <span className="pointer-events-none absolute top-0 left-0 h-(--ctrl-h-xs) w-6 bg-linear-to-r from-card to-transparent" />
        </div>
        {/* Months (years at Year): the label stays in view while its month is. */}
        <div className="relative h-(--ctrl-h-xs)">
          {topCells.map((cell) => {
            const left = xOfDay(range, dw, cell.start);
            const width = (cell.end - cell.start + 1) * dw;
            return (
              <div
                key={cell.start}
                className="absolute inset-y-0 flex items-center"
                style={{ left, width }}
              >
                {labelFits(cell.label.slice(0, 3), width) ? (
                  <TopLabel cell={cell} width={width} />
                ) : null}
              </div>
            );
          })}
          <span
            className="absolute top-1 flex h-4 -translate-x-1/2 items-center rounded-full bg-primary px-1.5 font-sans text-2xs font-medium whitespace-nowrap text-primary-foreground"
            style={{ left: todayX }}
          >
            Today
          </span>
        </div>
        {/* Days, weeks or months. */}
        <div className="relative h-(--ctrl-h-xs)">
          {units.map((cell) => {
            const left = xOfDay(range, dw, cell.start);
            const width = (cell.end - cell.start + 1) * dw;
            return (
              <span
                key={cell.start}
                className={cn(
                  "absolute inset-y-0 flex items-center justify-center font-sans text-2xs whitespace-nowrap tabular-nums",
                  cell.today
                    ? "font-semibold text-foreground"
                    : cell.weekend
                      ? "text-subtle-foreground"
                      : "text-muted-foreground",
                )}
                style={{ left, width }}
              >
                {labelFits(cell.label, width) ? cell.label : null}
              </span>
            );
          })}
        </div>
        {dueCounts ? (
          <div
            data-timeline-due-per-week=""
            className="relative h-(--ctrl-h-xs) border-t border-hairline"
          >
            {weeks.map((w) => {
              const left = xOfDay(range, dw, w.start);
              const width = 7 * dw;
              return (
                <span
                  key={w.start}
                  data-week={w.start}
                  className={cn(
                    // A hairline where each week starts, so a count reads as its week's.
                    "absolute inset-y-0 flex items-center justify-center font-sans text-2xs tabular-nums shadow-[inset_1px_0_0_var(--timeline-grid)]",
                    w.count > 0 && w.count === busiest
                      ? "font-semibold text-foreground"
                      : "text-subtle-foreground",
                  )}
                  style={{ left, width }}
                >
                  {w.count > 0 && labelFits(String(w.count), width) ? w.count : null}
                </span>
              );
            })}
          </div>
        ) : null}
        {strong.map((day) => (
          <span
            key={day}
            className="pointer-events-none absolute inset-y-0 w-px bg-timeline-grid-strong"
            style={{ left: xOfDay(range, dw, day) }}
          />
        ))}
      </div>
    </div>
  );
}
