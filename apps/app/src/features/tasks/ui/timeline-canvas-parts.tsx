// The Timeline's canvas pieces that draw no rows: the grid painted under them
// (one background, month lines, today) and the empty-state note over it.

import type { CSSProperties } from "react";

import { dayCenterX, type TimelineRange, xOfDay } from "../timeline-scale";

type GridProps = {
  range: TimelineRange;
  dw: number;
  today: number;
  unit: "day" | "week" | "month";
  style: CSSProperties;
  /** Year zoom: a line at each month's start. */
  yearMonths: readonly number[];
  /** The top tier's boundaries inside the drawn window, a stronger line. */
  strong: readonly number[];
};

export function TimelineGrid({ range, dw, today, unit, style, yearMonths, strong }: GridProps) {
  return (
    <div
      aria-hidden
      className="timeline-grid pointer-events-none absolute inset-y-0"
      data-unit={unit}
      data-weekends={unit === "day" ? "" : undefined}
      style={style}
    >
      {yearMonths.map((day) => (
        <span
          key={`m${day}`}
          className="absolute inset-y-0 w-px bg-timeline-grid"
          style={{ left: xOfDay(range, dw, day) }}
        />
      ))}
      {strong.map((day) => (
        <span
          key={day}
          className="absolute inset-y-0 w-px bg-timeline-grid-strong"
          style={{ left: xOfDay(range, dw, day) }}
        />
      ))}
      <span
        data-timeline-today=""
        className="absolute inset-y-0 w-px -translate-x-1/2 bg-primary"
        style={{ left: dayCenterX(range, dw, today) }}
      />
    </div>
  );
}

type EmptyProps = {
  /** No tasks in the scope at all (else: none has a date). */
  noTasks: boolean;
  canDrag: boolean;
  left: number;
  top: number;
};

export function TimelineEmptyNote({ noTasks, canDrag, left, top }: EmptyProps) {
  return (
    <div
      className="pointer-events-none absolute z-(--z-sticky) rounded-md bg-card/90 px-3 py-2"
      style={{ left, top }}
    >
      {/* The rows stay listed, with today's line and one sentence (71). */}
      <p className="font-sans text-sm text-foreground">
        {noTasks ? "No tasks here yet." : "Nothing has a date yet."}
      </p>
      <p className="font-sans text-xs text-muted-foreground">
        {noTasks
          ? "Tasks you give a date show up on the timeline."
          : canDrag
            ? "Click a day on a row, or open No date."
            : "Tasks show up here once they have a date."}
      </p>
    </div>
  );
}
