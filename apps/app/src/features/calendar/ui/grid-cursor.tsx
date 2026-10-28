// The grid cursor (CALR-4, AC22): a 30-minute slot outlined on its day
// column, shown while the grid has focus. Lives in the hours grid's own CSS
// grid, so it scrolls with the hours; inline styles are geometry only.

import { useLayoutEffect, useRef } from "react";

import { CURSOR_MINUTES, type GridCursor } from "../grid-keys";
import { localDayKey } from "../lens";
import { gridY } from "./grid-units";

export function GridCursorMark({ cursor, days }: { cursor: GridCursor; days: Date[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const col = days.findIndex((d) => localDayKey(d) === cursor.dayKey);
  useLayoutEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [cursor.dayKey, cursor.minute]);
  if (col < 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none relative hidden group-focus-visible/grid:block"
      // Column 1 is the hour gutter; the cursor shares row 1 with the columns.
      style={{ gridColumn: col + 2, gridRow: 1 }}
    >
      <div
        ref={ref}
        data-grid-cursor=""
        className="absolute inset-x-px rounded-sm border-2 border-ring"
        style={{ top: gridY(cursor.minute), height: gridY(CURSOR_MINUTES) }}
      />
    </div>
  );
}
