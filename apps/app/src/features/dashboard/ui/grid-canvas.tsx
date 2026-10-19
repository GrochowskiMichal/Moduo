import { type CSSProperties, ViewTransition } from "react";

import { cn } from "@/lib/utils";

import { spanOf } from "../engine/grid-engine";
import { GRID_COLS, GRID_ROWS, type WidgetInstance, type WidgetSize } from "../engine/types";
import type { DragRender } from "../hooks/use-grid-drag";
import { WidgetFrame } from "./widget-frame";

// Motion tuning (transform factors, not design tokens — the DS has no scale scale).
/** Every widget eases down a hair in edit mode so the grid reads as "liftable" (AC4). */
const EDIT_SCALE = 0.985;
/** The dragged widget lifts slightly above the rest. */
const ACTIVE_SCALE = 1.03;

/** Inline grid placement from a widget's cell + size span (the one sanctioned runtime-geometry style). */
function placementStyle(widget: WidgetInstance): CSSProperties {
  const { w, h } = spanOf(widget.size);
  return {
    gridColumn: `${widget.x + 1} / span ${w}`,
    gridRow: `${widget.y + 1} / span ${h}`,
  };
}

/** The faint 8×4 scaffold that fades in behind the widgets in edit mode (AC4). */
function GridLines({ editing }: { editing: boolean }) {
  const cells = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      cells.push(
        <div
          key={`${x}-${y}`}
          aria-hidden
          className={cn(
            "pointer-events-none rounded-md border border-dashed border-border/40",
            "transition-opacity duration-(--motion-fade) ease-(--ease-out)",
            editing ? "opacity-100" : "opacity-0",
          )}
          style={{ gridColumn: `${x + 1}`, gridRow: `${y + 1}` }}
        />,
      );
    }
  }
  return <>{cells}</>;
}

export interface GridCanvasProps {
  widgets: WidgetInstance[];
  editing?: boolean;
  drag?: DragRender | null;
  gridRef?: React.Ref<HTMLDivElement>;
  onWidgetPointerDown?: (id: string, event: React.PointerEvent) => void;
  onRemove?: (id: string) => void;
  onResize?: (id: string, size: WidgetSize) => void;
}

/**
 * The fixed 8×4 grid (AC1). A CSS grid of eight `1fr` columns × four `1fr` rows
 * fills the content area edge-to-edge and never scrolls — resizing only rescales
 * the cells; the composition never reflows. Each widget is a grid child placed by
 * its (x,y)+size span (DB-2).
 *
 * DB-3 layers on the edit/drag surface: while a drag is live we render its
 * `preview` positions instead of the stored ones, and the pushed neighbours glide
 * to their new cells: each cell sits in a React `<ViewTransition>`, the drag hook
 * sets a new preview inside a `dashboard-grid` transition, and global.css times
 * the glide with the motion tokens. The dragged widget stays in its pre-drag cell,
 * translated by the pointer's travel so it follows the finger 1:1; it opts out of
 * the glide while held (it would lag the cursor) and glides into place on the
 * drop. The cell element never changes type, so the active↔idle switch never
 * remounts the widget body.
 */
export function GridCanvas({
  widgets,
  editing = false,
  drag = null,
  gridRef,
  onWidgetPointerDown,
  onRemove,
  onResize,
}: GridCanvasProps) {
  // While dragging, render the live preview layout; otherwise the stored one.
  const rendered = drag?.preview ?? widgets;
  // The dragged widget's pre-drag placement: its translate is measured from there.
  const home = drag ? widgets.find((w) => w.id === drag.activeId) : undefined;

  // The gap is the panels' 8 (MOD-163). The drag reads it back off the
  // computed style at press, so the cell math follows it.
  return (
    <div ref={gridRef} className="grid h-full w-full grid-cols-8 grid-rows-4 gap-(--panel-gap)">
      <GridLines editing={editing} />
      {rendered.map((widget) => {
        const isActive = drag?.activeId === widget.id;
        // Geometry only (cell, pointer offset, lift), so it rides inline like the placement.
        const style: CSSProperties = {
          ...placementStyle(isActive && home ? home : widget),
          translate: isActive && drag ? `${drag.transform.x}px ${drag.transform.y}px` : undefined,
          scale: String(isActive ? ACTIVE_SCALE : editing ? EDIT_SCALE : 1),
        };
        return (
          // `default="none"`: only a layout change glides, never a mount or unmount.
          <ViewTransition
            key={widget.id}
            default="none"
            // Only the drag hook's transitions glide; a route change never does.
            update={isActive ? "none" : { "dashboard-grid": "dashboard-glide", default: "none" }}
          >
            <div
              style={style}
              // No wheel handler: a sideways swipe over a widget turns the page,
              // and the pager leaves one over a sideways scroller to it (MOD-163,
              // spec assumption 11).
              onPointerDown={(e) => onWidgetPointerDown?.(widget.id, e)}
              className={cn(
                "min-h-0 min-w-0",
                // The edit-mode ease-down eases; the held widget's lift is instant.
                !isActive && "transition-[scale] duration-(--motion-base) ease-(--ease-out)",
                editing && (isActive ? "cursor-grabbing" : "cursor-grab"),
                isActive && "z-[var(--z-sticky)] shadow-lg",
              )}
            >
              <WidgetFrame
                widget={widget}
                editing={editing}
                onRemove={onRemove}
                onResize={onResize}
              />
            </div>
          </ViewTransition>
        );
      })}
    </div>
  );
}
