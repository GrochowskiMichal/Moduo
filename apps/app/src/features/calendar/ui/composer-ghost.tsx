// The composer's draft on the grid (CALR-9, AC16): where the typed event will
// land, in the day column it falls on. It settles into place over
// --motion-base as the text or a ⇥ hop moves it.

import { useComposerDraft } from "../composer/draft-store";
import { type DayGeometry, GRID_LAYER, wallMinuteOf } from "../grid-layout";
import { gridY } from "./grid-units";
import { formatTimeOfDay } from "./time-format";

export function ComposerGhost({ geom }: { geom: DayGeometry }) {
  const draft = useComposerDraft();
  if (!draft || draft.endMs <= geom.dayStartMs || draft.startMs >= geom.dayEndMs) return null;
  const top = wallMinuteOf(draft.startMs, geom);
  const bottom = wallMinuteOf(draft.endMs, geom);
  return (
    <div
      aria-hidden
      data-composer-ghost
      className="pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-md border border-primary/50 bg-primary/15 px-1.5 py-0.5 transition-[top,height] duration-(--motion-base) ease-(--ease-out) motion-reduce:transition-none"
      style={{
        top: gridY(top),
        height: `max(${gridY(Math.max(bottom - top, 15))}, 1.125rem)`,
        zIndex: GRID_LAYER.pending,
      }}
    >
      <span className="block truncate text-2xs text-foreground">
        {draft.title || "New event"}
        <span className="text-muted-foreground">
          {" · "}
          {formatTimeOfDay(draft.startMs)} – {formatTimeOfDay(draft.endMs)}
        </span>
      </span>
    </div>
  );
}
