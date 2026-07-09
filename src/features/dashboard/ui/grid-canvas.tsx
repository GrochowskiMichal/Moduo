import type { WidgetInstance } from "../engine/types";
import { spanOf } from "../engine/grid-engine";
import { WidgetFrame } from "./widget-frame";

/**
 * The fixed 8×4 grid (AC1). A CSS grid of eight `1fr` columns × four `1fr` rows
 * fills the content area edge-to-edge and never scrolls — resizing the window
 * only rescales the cells; the composition never reflows. Each widget is a grid
 * child placed by its stored (x, y) + size span via inline grid-placement
 * (runtime geometry — the one sanctioned inline-style use). DB-3 adds the
 * edit-mode grid lines + drag; this layer is the static render.
 */
export function GridCanvas({ widgets }: { widgets: WidgetInstance[] }) {
  return (
    <div className="grid h-full w-full grid-cols-8 grid-rows-4 gap-3">
      {widgets.map((widget) => {
        const { w, h } = spanOf(widget.size);
        return (
          <div
            key={widget.id}
            style={{
              gridColumn: `${widget.x + 1} / span ${w}`,
              gridRow: `${widget.y + 1} / span ${h}`,
            }}
          >
            <WidgetFrame widget={widget} />
          </div>
        );
      })}
    </div>
  );
}
