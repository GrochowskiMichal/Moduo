import { motion } from "framer-motion";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { spanOf } from "../engine/grid-engine";
import {
  GRID_COLS,
  GRID_ROWS,
  type WidgetInstance,
  type WidgetSize,
} from "../engine/types";
import type { DragRender } from "../hooks/use-grid-drag";
import { useGridMotion } from "../motion";
import { WidgetFrame } from "./widget-frame";

// Motion tuning (transform factors, not design tokens — the DS has no scale scale).
/** Every widget eases down a hair in edit mode so the grid reads as "liftable" (AC4). */
const EDIT_SCALE = 0.985;
/** The dragged widget lifts slightly above the rest. */
const ACTIVE_SCALE = 1.03;
/** Instant transition — the dragged widget must track the finger 1:1, no lag. */
const INSTANT_FOLLOW = { duration: 0 } as const;

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
 * `preview` positions instead of the stored ones, the pushed neighbours FLIP-glide
 * to their new cells (framer `layout="position"`, timed by the motion tokens), and
 * the dragged widget is transform-offset to follow the finger 1:1 (its own layout
 * FLIP disabled so it never lags). Every cell stays a `motion.div` so the
 * active↔idle switch never remounts the widget body.
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
  // FLIP timing from the motion tokens — `duration` is 0s under
  // prefers-reduced-motion (the token zeroes itself), so the neighbour glides
  // collapse to instant. This is the grid's ONLY reduced-motion guard (AC12);
  // don't hardcode this transition or reduced-motion silently regresses.
  const motionSpec = useGridMotion();
  // While dragging, render the live preview layout; otherwise the stored one.
  const rendered = drag?.preview ?? widgets;

  return (
    <div ref={gridRef} className="grid h-full w-full grid-cols-8 grid-rows-4 gap-3">
      <GridLines editing={editing} />
      {rendered.map((widget) => {
        const isActive = drag?.activeId === widget.id;
        return (
          <motion.div
            key={widget.id}
            // The active widget follows the finger via a transform offset — no
            // layout FLIP on it (that would lag the cursor). Idle widgets FLIP.
            layout={isActive ? false : "position"}
            style={placementStyle(widget)}
            animate={
              isActive && drag
                ? { x: drag.transform.x, y: drag.transform.y, scale: ACTIVE_SCALE }
                : { x: 0, y: 0, scale: editing ? EDIT_SCALE : 1 }
            }
            transition={isActive ? INSTANT_FOLLOW : { duration: motionSpec.duration, ease: motionSpec.ease }}
            onPointerDown={(e) => onWidgetPointerDown?.(widget.id, e)}
            // A widget swallows its own wheel events so the pager only turns pages
            // over the grid BACKGROUND (spec assumption 11); DB-5 scrollable
            // widgets then consume the wheel naturally.
            onWheel={(e) => e.stopPropagation()}
            className={cn(
              "min-h-0 min-w-0",
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
          </motion.div>
        );
      })}
    </div>
  );
}
