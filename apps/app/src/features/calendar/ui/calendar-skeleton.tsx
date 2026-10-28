// Loading skeletons in the last known shape (CALR-3, AC4). The all-day lane's
// skeleton is the real lane's frame (same container, same row track), so when
// the events land in the same number of rows the hours below don't move.
// Plan's skeleton draws each remembered group with its rows.

import { Skeleton } from "../../../components/ui/skeleton";

/** Must match AllDayLane's container classes: the frame is the promise. */
export const ALL_DAY_LANE_CLASS = "grid shrink-0 border-b border-border py-1";

export function AllDayLaneSkeleton({
  days,
  columns,
  rows,
}: {
  days: number;
  /** The grid's column template (gutter + days). */
  columns: string;
  rows: number;
}) {
  if (rows <= 0) return null;
  return (
    <div
      data-allday-lane
      data-allday-rows={rows}
      aria-hidden
      className={ALL_DAY_LANE_CLASS}
      style={{ gridTemplateColumns: columns }}
    >
      <div className="flex flex-col items-end gap-0.5 pr-1.5 text-2xs text-subtle-foreground">
        <span className="flex h-(--ctrl-h-xs) items-center">all-day</span>
      </div>
      <div
        className="relative grid gap-y-0.5"
        style={{
          gridColumn: `2 / span ${days}`,
          gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, var(--ctrl-h-xs))`,
        }}
      >
        {Array.from({ length: days }, (_, col) => (
          <div
            key={`col:${col}`}
            className="border-l border-border"
            style={{ gridColumn: col + 1, gridRow: "1 / -1" }}
          />
        ))}
        {Array.from({ length: rows }, (_, row) => (
          <Skeleton
            key={`bar:${row}`}
            className="mx-0.5"
            // A bar on the first day and one mid-week per row: a lane, not a wall.
            style={{
              gridColumn: `${((row * 3) % days) + 1} / span ${Math.min(2, days)}`,
              gridRow: row + 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function PlanSkeleton({ groups }: { groups: readonly number[] }) {
  return (
    <div aria-hidden className="flex flex-col gap-3" data-plan-skeleton>
      {groups.map((rows, g) => (
        <div key={`group:${g}`} data-plan-skeleton-group className="flex flex-col gap-1 px-1">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: rows }, (_, r) => (
            <div
              key={`row:${r}`}
              data-plan-skeleton-row
              className="flex items-center gap-2"
              style={{ minHeight: "var(--row-h-sm)" }}
            >
              <Skeleton className="size-3.5 shrink-0 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
