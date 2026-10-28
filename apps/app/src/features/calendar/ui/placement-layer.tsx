// What placing a task draws over the hours grid (CALR-5, AC20): free time that
// fits the task as a soft wash, outlined only under the pointer, and the lifted
// task where ↵ would put it (as "Focus · title" once F made it focus time). A click in the wash places it there. Lives in the
// hours grid's own CSS grid, like the cursor, so it scrolls with the hours;
// inline styles are geometry only.

import { useLayoutEffect, useRef, useState } from "react";

import type { BusyInterval } from "../gap-finder";
import { chipSpanInDay, dayGeometry, GRID_LAYER } from "../grid-layout";
import { localDayKey } from "../lens";
import type { Placement } from "../place-task";
import { slotAtPointer } from "../place-task";
import { gridY } from "./grid-units";
import { formatTimeOfDay } from "./time-format";

type Props = {
  days: Date[];
  placement: Placement;
  title: string;
  /** Free stretches that fit, per day key. */
  freeByDay: ReadonlyMap<string, readonly BusyInterval[]>;
  onPlaceAt: (startMs: number) => void;
};

const MIN = 60_000;

export function PlacementLayer({ days, placement, title, freeByDay, onPlaceAt }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    draftRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [placement.startMs]);

  const endMs = placement.startMs + placement.durationMinutes * MIN;
  return (
    <>
      {days.map((day, col) => {
        const key = localDayKey(day);
        const geom = dayGeometry(day);
        const slots = freeByDay.get(key) ?? [];
        const draft = chipSpanInDay(placement.startMs, endMs, geom);
        const hoverSpan =
          hover !== null
            ? chipSpanInDay(hover, hover + placement.durationMinutes * MIN, geom)
            : null;
        return (
          <div
            key={key}
            className="pointer-events-none absolute inset-0"
            // Column 1 is the hour gutter.
            style={{ gridColumn: `${col + 2} / span 1`, gridRow: "1 / span 1" }}
          >
            {slots.map((slot) => {
              const span = chipSpanInDay(slot.startMs, slot.endMs, geom);
              if (!span) return null;
              const at = (clientY: number, el: HTMLElement) => {
                const rect = el.getBoundingClientRect();
                const frac = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
                const ms = slot.startMs + frac * (slot.endMs - slot.startMs);
                return slotAtPointer(slot, ms, placement.durationMinutes);
              };
              return (
                <div
                  key={slot.startMs}
                  data-free-slot=""
                  aria-hidden
                  className="pointer-events-auto absolute inset-x-0 cursor-copy bg-primary/10"
                  style={{ top: gridY(span.topMinutes), height: gridY(span.heightMinutes) }}
                  // The grid's background would start drawing a new event.
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => setHover(at(e.clientY, e.currentTarget))}
                  onPointerLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlaceAt(at(e.clientY, e.currentTarget));
                  }}
                />
              );
            })}
            {hoverSpan ? (
              <div
                aria-hidden
                className="absolute inset-x-0.5 rounded-md border border-primary/60"
                style={{
                  top: gridY(hoverSpan.topMinutes),
                  height: gridY(hoverSpan.heightMinutes),
                  zIndex: GRID_LAYER.ghost,
                }}
              />
            ) : null}
            {draft ? (
              <div
                ref={draftRef}
                data-placement-draft=""
                data-kind={placement.kind === "focus" ? "focus" : undefined}
                className="absolute inset-x-0.5 overflow-hidden rounded-md border border-primary bg-primary/15 px-1.5 py-0.5"
                style={{
                  top: gridY(draft.topMinutes),
                  height: `max(${gridY(draft.heightMinutes)}, 1.125rem)`,
                  zIndex: GRID_LAYER.pending,
                }}
              >
                <span className="block truncate text-2xs text-foreground">
                  {placement.kind === "focus" ? `Focus · ${title}` : title} ·{" "}
                  {formatTimeOfDay(placement.startMs)} – {formatTimeOfDay(endMs)}
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
