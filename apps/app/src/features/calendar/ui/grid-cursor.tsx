// The grid cursor (CALR-4, AC22): a 30-minute slot outlined on its day
// column (on a busy slot, the event under it: `cursorBox`), shown while the
// grid has focus. Lives in the hours grid's own CSS
// grid, so it scrolls with the hours; inline styles are geometry only.

import { useLayoutEffect, useRef } from "react";

import type { GridCursor } from "../grid-keys";
import { localDayKey } from "../lens";
import { gridY } from "./grid-units";

export function GridCursorMark({ cursor, days }: { cursor: GridCursor; days: Date[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const col = days.findIndex((d) => localDayKey(d) === cursor.dayKey);
  useLayoutEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [cursor.dayKey, cursor.minute]);
  const box = cursor.box;
  if (col < 0 || !box) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden group-focus-visible/grid:block"
      // Out of flow, so the day columns keep their places; the placement makes
      // its column the box it sits in (column 1 is the hour gutter).
      style={{ gridColumn: `${col + 2} / span 1`, gridRow: "1 / span 1" }}
    >
      <div
        ref={ref}
        data-grid-cursor=""
        className="absolute inset-x-px rounded-sm border-2 border-ring"
        style={{ top: gridY(box.minute), height: gridY(box.minutes) }}
      />
    </div>
  );
}
