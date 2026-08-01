// The hand-rolled pointer-drag machine for the dashboard grid (DB-3, AC3/AC4).
//
// Not dnd-kit (spec assumption 1): collision is pure math on a fixed 8×4 matrix,
// and we need a bespoke gesture machine anyway (long-press to enter edit mode,
// live push-preview against the pre-drag layout, snap-back on a non-fitting drop).
// The mechanics mirror the house pattern proven in calendar-grid / timeline-drag:
//   • a ref holds the authoritative gesture; React state mirrors only what renders;
//   • window-level pointer listeners are attached on press, removed on end;
//   • THREE exits — pointerup, pointercancel, and a `buttons === 0` self-heal on
//     move (a button released off-window otherwise strands the gesture);
//   • the grid rect is measured once on press into the gesture (it never scrolls);
//   • the SAME engine call (`resolveDrag`) drives the live preview and the commit,
//     so what you see is exactly what lands (WYSIWYG).

import { useCallback, useEffect, useRef, useState } from "react";

import { commitLayout, resolveDrag } from "../engine/grid-engine";
import type { WidgetInstance } from "../engine/types";
import {
  activeTransform,
  type Cell,
  cellMetrics,
  type GridMetrics,
  type Point,
  pointerToTargetCell,
} from "../grid-geometry";

/** Travel past which a press becomes a drag (and, in normal mode, cancels the long-press). */
const SLOP_PX = 6;
/** Hold time that turns a normal-mode press into edit mode + a drag (iOS long-press). */
const LONG_PRESS_MS = 450;

interface Gesture {
  widgetId: string;
  pointerId: number;
  downX: number;
  downY: number;
  originalCell: Cell;
  size: WidgetInstance["size"];
  metrics: GridMetrics;
  /** The layout as it was at press — every preview is resolved against THIS (wiggle-back restores it). */
  preDrag: WidgetInstance[];
  /** Armed = the gesture may drag (edit mode immediately; normal mode only after long-press fires). */
  armed: boolean;
  /** Started = travelled past slop → a real drag is underway (drives the render). */
  started: boolean;
  longPressTimer: number | null;
  /** Last VALID resolved layout (active pinned at its snapped cell). */
  preview: WidgetInstance[];
  /** The active widget's cell within `preview`. */
  activeCell: Cell;
}

/** What the canvas needs to render an in-flight drag; null when nothing is dragging. */
export interface DragRender {
  activeId: string;
  transform: Point;
  preview: WidgetInstance[];
}

export interface UseGridDragArgs {
  widgets: WidgetInstance[];
  editing: boolean;
  /** Commit a new layout after a successful drop (skipped when the drop changes nothing). */
  onCommit: (next: WidgetInstance[]) => void;
  /** A normal-mode long-press wants to enter edit mode. */
  onLongPress: () => void;
}

export interface UseGridDragResult {
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** Non-null only while actively dragging (past slop). */
  drag: DragRender | null;
  /** Wire to each draggable widget's `onPointerDown`. */
  startWidgetDrag: (widgetId: string, event: React.PointerEvent) => void;
}

/** Same id → same {x,y,size}? Used to skip a no-op commit (the byte-identical snap-back contract). */
function samePlacement(a: WidgetInstance[], b: WidgetInstance[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((w) => [w.id, w]));
  for (const w of a) {
    const o = byId.get(w.id);
    if (!o || o.x !== w.x || o.y !== w.y || o.size !== w.size) return false;
  }
  return true;
}

/** A press that lands on a real control (remove/resize button, input…) must not start a drag. */
function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest("button, a, input, textarea, select, [role='button'], [data-no-drag]"));
}

export function useGridDrag({
  widgets,
  editing,
  onCommit,
  onLongPress,
}: UseGridDragArgs): UseGridDragResult {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<DragRender | null>(null);

  // Keep the live inputs in refs so the window listeners (attached once per press)
  // never read a stale closure (the calendar/timeline pattern).
  const widgetsRef = useRef(widgets);
  const editingRef = useRef(editing);
  const onCommitRef = useRef(onCommit);
  const onLongPressRef = useRef(onLongPress);
  useEffect(() => {
    widgetsRef.current = widgets;
    editingRef.current = editing;
    onCommitRef.current = onCommit;
    onLongPressRef.current = onLongPress;
  });

  // Stable listener identities so add/removeEventListener pair up correctly.
  const handlersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: () => void;
    key: (e: KeyboardEvent) => void;
  } | null>(null);

  const teardown = useCallback(() => {
    const g = gestureRef.current;
    if (g?.longPressTimer != null) window.clearTimeout(g.longPressTimer);
    const h = handlersRef.current;
    if (h) {
      window.removeEventListener("pointermove", h.move);
      window.removeEventListener("pointerup", h.up);
      window.removeEventListener("pointercancel", h.cancel);
      window.removeEventListener("keydown", h.key, true);
      handlersRef.current = null;
    }
    document.body.style.userSelect = "";
    gestureRef.current = null;
    setDrag(null);
  }, []);

  /** Finish the gesture: commit the previewed layout (unless it changed nothing), or just drop it. */
  const endGesture = useCallback(
    (commit: boolean) => {
      const g = gestureRef.current;
      // `g.preview` is reassigned ONLY on a successful `resolveDrag`, so
      // `preview === preDrag` (by reference) means every target was rejected — a
      // non-fitting drop must leave the layout byte-identical (AC3) and never
      // commit. When a valid preview exists, `samePlacement` still skips the
      // no-op case (dragged out and back to the exact start).
      if (commit && g && g.started && g.preview !== g.preDrag) {
        const next = commitLayout(g.preview);
        if (!samePlacement(next, g.preDrag)) onCommitRef.current(next);
      }
      teardown();
    },
    [teardown],
  );

  const startWidgetDrag = useCallback(
    (widgetId: string, event: React.PointerEvent) => {
      if (event.button !== 0) return; // primary button only
      if (gestureRef.current) return; // one gesture at a time
      if (isInteractiveTarget(event.target)) return; // a control press, not a drag
      const grid = gridRef.current;
      if (!grid) return;
      const widget = widgetsRef.current.find((w) => w.id === widgetId);
      if (!widget) return;

      const rect = grid.getBoundingClientRect();
      const cs = getComputedStyle(grid);
      const colGap = Number.parseFloat(cs.columnGap) || 0;
      const rowGap = Number.parseFloat(cs.rowGap) || 0;
      const metrics = cellMetrics(rect, colGap, rowGap);

      const isEditing = editingRef.current;
      const gesture: Gesture = {
        widgetId,
        pointerId: event.pointerId,
        downX: event.clientX,
        downY: event.clientY,
        originalCell: { x: widget.x, y: widget.y },
        size: widget.size,
        metrics,
        preDrag: widgetsRef.current,
        armed: isEditing,
        started: false,
        longPressTimer: null,
        preview: widgetsRef.current,
        activeCell: { x: widget.x, y: widget.y },
      };

      // Normal mode: arm a long-press that enters edit mode and lets the SAME
      // press flow straight into a drag (the gesture keeps running via refs +
      // window listeners, unaffected by the edit-mode re-render).
      if (!isEditing) {
        gesture.longPressTimer = window.setTimeout(() => {
          const cur = gestureRef.current;
          if (!cur || cur.started) return;
          cur.armed = true;
          onLongPressRef.current();
        }, LONG_PRESS_MS);
      }

      const move = (e: PointerEvent) => {
        const cur = gestureRef.current;
        if (!cur || e.pointerId !== cur.pointerId) return;
        if (e.buttons === 0) {
          endGesture(false); // self-heal: button released off-window
          return;
        }
        const delta: Point = { x: e.clientX - cur.downX, y: e.clientY - cur.downY };
        const travelled = Math.hypot(delta.x, delta.y);

        if (!cur.armed) {
          // Long-press still pending — travel means this was a scroll/swipe, not a
          // hold. Abandon the gesture (a future pager owns the swipe).
          if (travelled > SLOP_PX) endGesture(false);
          return;
        }
        if (!cur.started) {
          if (travelled <= SLOP_PX) return; // waiting for intent
          cur.started = true;
          document.body.style.userSelect = "none";
        }
        e.preventDefault();

        const target = pointerToTargetCell({
          originalCell: cur.originalCell,
          delta,
          size: cur.size,
          metrics: cur.metrics,
        });
        const resolved = resolveDrag(cur.preDrag, cur.widgetId, target);
        if (resolved) {
          cur.preview = resolved;
          const placed = resolved.find((w) => w.id === cur.widgetId);
          if (placed) cur.activeCell = { x: placed.x, y: placed.y };
        }
        const transform = activeTransform({
          originalCell: cur.originalCell,
          activeCell: cur.activeCell,
          delta,
          metrics: cur.metrics,
        });
        setDrag({ activeId: cur.widgetId, transform, preview: cur.preview });
      };

      const up = (e: PointerEvent) => {
        const cur = gestureRef.current;
        if (cur && e.pointerId !== cur.pointerId) return;
        endGesture(true);
      };
      const cancel = () => endGesture(false);
      const key = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        // Cancel the drag capture-first so Escape doesn't also exit edit mode.
        e.preventDefault();
        e.stopPropagation();
        endGesture(false);
      };

      handlersRef.current = { move, up, cancel, key };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      gestureRef.current = gesture;
    },
    [endGesture],
  );

  // Safety net: tear down any live gesture if the hook unmounts mid-drag.
  useEffect(() => teardown, [teardown]);

  return { gridRef, drag, startWidgetDrag };
}
