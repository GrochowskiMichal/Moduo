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
//
// The pointer offset renders urgently (the dragged widget tracks the finger 1:1);
// a new push-preview and the drop render as transitions typed `dashboard-grid`,
// so the canvas's <ViewTransition>s glide the moved widgets (global.css times it).

import {
  addTransitionType,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { commitLayout, resolveDrag } from "../engine/grid-engine";
import type { WidgetInstance } from "../engine/types";
import {
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

/** Typed view transitions. Without them (WebKit before Safari 18.2) global.css can't
 * keep the page out of the snapshot, so the layout just changes in place. */
const CAN_GLIDE =
  typeof CSS !== "undefined" && CSS.supports?.("selector(:active-view-transition-type(a))");

/** Run a layout change as a view transition the canvas glides (see global.css). */
function glide(update: () => void) {
  if (!CAN_GLIDE) {
    update();
    return;
  }
  startTransition(() => {
    addTransitionType("dashboard-grid");
    update();
  });
}

interface Gesture {
  /** The page pressed on; the gesture commits only while it is still the active page. */
  pageId: string;
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
}

/** What the canvas needs to render an in-flight drag; null when nothing is dragging. */
export interface DragRender {
  activeId: string;
  /** The pointer's travel since the press: the active widget stays in its pre-drag cell, offset by this. */
  transform: Point;
  preview: WidgetInstance[];
}

export interface UseGridDragArgs {
  /** The page `widgets` belong to. A gesture never outlives its page: if the page changes mid-gesture it is dropped, uncommitted (MOD-163). */
  pageId: string;
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
  /** True from the press until release, including the armed window before a drag passes slop. */
  isGestureLive: () => boolean;
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
  pageId,
  widgets,
  editing,
  onCommit,
  onLongPress,
}: UseGridDragArgs): UseGridDragResult {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  // Split so a pointer move never carries a preview change out of its transition.
  const [pointer, setPointer] = useState<Pick<DragRender, "activeId" | "transform"> | null>(null);
  const [preview, setPreview] = useState<WidgetInstance[] | null>(null);
  const drag: DragRender | null = pointer && preview ? { ...pointer, preview } : null;

  // Keep the live inputs in refs so the window listeners (attached once per press)
  // never read a stale closure (the calendar/timeline pattern).
  const widgetsRef = useRef(widgets);
  const editingRef = useRef(editing);
  const onCommitRef = useRef(onCommit);
  const onLongPressRef = useRef(onLongPress);
  const pageIdRef = useRef(pageId);
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
    setPointer(null);
    setPreview(null);
  }, []);

  /** Finish the gesture: commit the previewed layout (unless it changed nothing), or just drop it. */
  const endGesture = useCallback(
    (commit: boolean) => {
      const g = gestureRef.current;
      // `g.preview` is reassigned ONLY on a successful `resolveDrag`, so
      // `preview === preDrag` (by reference) means every target was rejected — a
      // non-fitting drop must leave the layout byte-identical (AC3) and never
      // commit. When a valid preview exists, `samePlacement` still skips the
      // no-op case (dragged out and back to the exact start). A gesture whose
      // page is no longer the active one never commits (MOD-163).
      // The drop glides: the active widget from under the finger into its cell
      // (or back home), in the same transition as the commit.
      glide(() => {
        if (commit && g?.started && g.preview !== g.preDrag && g.pageId === pageIdRef.current) {
          const next = commitLayout(g.preview);
          if (!samePlacement(next, g.preDrag)) onCommitRef.current(next);
        }
        teardown();
      });
    },
    [teardown],
  );

  // MOD-163: a gesture belongs to the page it started on. If another page
  // becomes active mid-gesture, drop it uncommitted: its preview was resolved
  // against the old page's widgets, and `onCommit` now targets the new page, so
  // committing would overwrite the new page with them. A layout effect, so no
  // pointerup can land between the page change and the drop.
  useLayoutEffect(() => {
    pageIdRef.current = pageId;
    const g = gestureRef.current;
    if (g && g.pageId !== pageId) endGesture(false);
  }, [pageId, endGesture]);

  const isGestureLive = useCallback(() => gestureRef.current !== null, []);

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
        pageId: pageIdRef.current,
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
          setPreview(cur.preview);
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
          const moved = !samePlacement(resolved, cur.preview);
          cur.preview = resolved;
          if (moved) glide(() => setPreview(resolved));
        }
        setPointer({ activeId: cur.widgetId, transform: delta });
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

  return { gridRef, drag, startWidgetDrag, isGestureLive };
}
