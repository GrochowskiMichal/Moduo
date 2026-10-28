// A booking link's open times, dashed on the week while its view is open
// (CALR-17, AC31). Lives in the hours grid's own CSS grid, like the placement
// layer; decoration only, so it never catches the pointer. Inline styles are
// geometry only.

import { cn } from "@/lib/utils";

import type { OpenTime } from "../booking/availability";
import { chipSpanInDay, dayGeometry } from "../grid-layout";
import { localDayKey } from "../lens";
import { gridY } from "./grid-units";

export function BookingOpenLayer({
  days,
  times,
  picked,
}: {
  days: Date[];
  times: readonly OpenTime[];
  /** Offer mode (CALR-19): the picked times fill; the rest is the cursor. */
  picked?: readonly number[];
}) {
  return (
    <>
      {days.map((day, col) => {
        const geom = dayGeometry(day);
        return (
          <div
            key={localDayKey(day)}
            aria-hidden
            className="pointer-events-none absolute inset-0"
            // Column 1 is the hour gutter.
            style={{ gridColumn: `${col + 2} / span 1`, gridRow: "1 / span 1" }}
          >
            {times.map((t) => {
              const span = chipSpanInDay(t.startMs, t.endMs, geom);
              if (!span) return null;
              return (
                <div
                  key={t.startMs}
                  data-open-time=""
                  data-picked={picked?.includes(t.startMs) || undefined}
                  className={cn(
                    "pointer-events-none absolute inset-x-0.5 rounded-md border border-dashed border-primary/60",
                    picked && "border-2 border-primary",
                    picked?.includes(t.startMs) && "bg-primary/10",
                  )}
                  style={{ top: gridY(span.topMinutes), height: gridY(span.heightMinutes) }}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}
