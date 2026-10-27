// The now line on today's column (CALR-1, AC10): it runs over every event card
// (GRID_LAYER.now); only the meeting in progress sits above it, carrying its
// own faint copy of the line under its title (event-chip.tsx).

import { GRID_LAYER } from "../grid-layout";

export function NowLine({ minutes }: { minutes: number }) {
  return (
    <div
      aria-hidden
      data-now-line
      className="pointer-events-none absolute inset-x-0"
      style={{ top: `calc(var(--cal-hour-h) * ${minutes / 60})`, zIndex: GRID_LAYER.now }}
    >
      <div className="relative h-px bg-primary">
        <div className="absolute -left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
      </div>
    </div>
  );
}
