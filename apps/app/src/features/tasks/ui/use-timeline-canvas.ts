// The Timeline's pointer work (Tasks v3 TV-TL2, REPLAN 70): drag a point, a
// diamond, a band or a bar (and a band's or a bar's ends), draw on a row with
// no date yet, and the ghost a hover shows there. One set of listeners on the
// scroller, not one per mark: a press finds what it grabbed through the
// marks' data attributes (timeline-marks.tsx).
//
// - A press turns into a drag after a few pixels; a plain click stays a click
//   (the row's own: it selects), except on an undated row, where it dates it.
// - Drags are horizontal only: nothing moves between rows, so a drag never
//   reassigns or refiles (70).
// - The day under the pointer is worked out from the raw pointer against the
//   scroller every time (never a stored delta): an edge scroll moves the canvas
//   under a still pointer (gotchas/ui.md), and the range can grow at its start.
// - Near the canvas's left or right edge the view scrolls by itself.
// - Esc cancels. The drop hands the result to `onCommit`; what it saves (one
//   store write, one Undo) is the view's.

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  autoScrollStep,
  DRAG_THRESHOLD_PX,
  drawnSpan,
  type DrawTarget,
  moveSpan,
  type SpanEdge,
  type TimelineGrab,
} from "../timeline-drag";
import type { DaySpan, TimelineRow } from "../timeline-rows";
import { dayAtX, type TimelineRange } from "../timeline-scale";
import type { CanvasStore, DragPreview } from "./timeline-drag-store";
import { drawableKind } from "./timeline-row";

/** What a finished drag (or a click on an undated row) asks the view to save. */
export type CanvasCommit =
  | { kind: "points"; taskId: string; taskIds: readonly string[]; delta: number }
  | { kind: "diamond"; sectionId: string; day: number }
  | { kind: "band"; sectionId: string; span: DaySpan }
  | { kind: "bar"; projectId: string; span: DaySpan }
  /** `clicked`: a click, not a drag (a project gets a bar as long as the zoom suggests). */
  | { kind: "draw"; target: DrawTarget; span: DaySpan; clicked: boolean };

/** What the handlers read at the moment they run (never a stale closure). */
export type CanvasLive = {
  range: TimelineRange;
  dw: number;
  nameW: number;
  rowOf: (key: string) => TimelineRow | undefined;
  /** May this person change this row's dates? */
  canDrag: (row: TimelineRow) => boolean;
  /** May this person change this task's dates (a selection moving with it)? */
  canEditTask: (taskId: string) => boolean;
  /** The selected tasks while two or more are (they move together). */
  selection: ReadonlySet<string>;
};

type Gesture = {
  pointerId: number;
  grab: TimelineGrab;
  rowKey: string;
  startX: number;
  startDay: number;
  lastX: number;
  lastY: number;
  active: boolean;
  frame: number;
  preview: DragPreview | null;
};

function drawTargetOf(row: TimelineRow): DrawTarget | null {
  const kind = drawableKind(row);
  if (kind === "task" && row.kind === "task") return { kind: "task", taskId: row.task.id };
  if (kind === "section" && row.kind === "section" && row.section) {
    return { kind: "section", sectionId: row.section.id };
  }
  if (kind === "project" && row.kind === "project") {
    return { kind: "project", projectId: row.project.id };
  }
  return null;
}

function edgeOf(el: Element | null): SpanEdge {
  const edge = el?.getAttribute("data-timeline-edge");
  return edge === "start" || edge === "end" ? edge : "move";
}

export function useTimelineCanvas({
  scrollerRef,
  store,
  live,
  onCommit,
  onDragRow,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  store: CanvasStore;
  live: RefObject<CanvasLive>;
  onCommit: (commit: CanvasCommit) => void;
  /** The row a drag holds (kept drawn while it runs), or null when it ends. */
  onDragRow: (rowKey: string | null) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const commitRef = useRef(onCommit);
  const dragRowRef = useRef(onDragRow);
  useEffect(() => {
    commitRef.current = onCommit;
    dragRowRef.current = onDragRow;
  });

  /** The day under a pointer's x, against the canvas as it is now. */
  const dayAt = useCallback(
    (clientX: number): number | null => {
      const el = scrollerRef.current;
      const geo = live.current;
      if (!el || !geo) return null;
      const left = el.getBoundingClientRect().left + geo.nameW;
      return dayAtX(geo.range, geo.dw, clientX - left + el.scrollLeft);
    },
    [scrollerRef, live],
  );

  /** What the drag shows for the pointer where it is now. */
  const previewOf = useCallback(
    (g: Gesture): DragPreview | null => {
      const day = dayAt(g.lastX);
      if (day === null) return g.preview;
      const delta = day - g.startDay;
      const { grab } = g;
      switch (grab.kind) {
        case "point":
          return {
            kind: "point",
            taskIds: new Set(grab.taskIds),
            leadId: grab.taskId,
            delta,
          };
        case "diamond":
          return { kind: "diamond", sectionId: grab.sectionId, day: grab.day + delta };
        case "band":
          return {
            kind: "band",
            sectionId: grab.sectionId,
            span: moveSpan(grab.span, grab.edge, delta),
          };
        case "bar":
          return {
            kind: "bar",
            projectId: grab.projectId,
            span: moveSpan(grab.span, grab.edge, delta),
          };
        case "draw":
          return {
            kind: "draw",
            rowKey: g.rowKey,
            span:
              grab.target.kind === "task" ? { start: day, end: day } : drawnSpan(grab.from, day),
          };
      }
    },
    [dayAt],
  );

  const show = useCallback(
    (g: Gesture) => {
      const next = previewOf(g);
      // Same place as the last frame: keep the object, so nothing redraws.
      if (sameish(next, g.preview)) return;
      g.preview = next;
      store.setDrag(next);
    },
    [previewOf, store],
  );

  const end = useCallback(
    (commit: boolean) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      cancelAnimationFrame(g.frame);
      const el = scrollerRef.current;
      el?.removeAttribute("data-dragging");
      if (g.active) {
        // The click that follows a drag isn't a click on the row.
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }
      const preview = g.active ? previewOf(g) : null;
      if (commit) {
        const result = commitOf(g, preview);
        if (result) commitRef.current(result);
      }
      // After the commit: its write is on show already (writes begin at once).
      store.setDrag(null);
      if (g.active) dragRowRef.current(null);
    },
    [previewOf, scrollerRef, store],
  );

  // The listeners a gesture puts on the document (the pointer may leave the scroller).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      if (!g.active) {
        if (Math.abs(e.clientX - g.startX) < DRAG_THRESHOLD_PX) return;
        g.active = true;
        store.setHover(null);
        scrollerRef.current?.setAttribute("data-dragging", "");
        dragRowRef.current(g.rowKey);
        const tick = () => {
          const now = gesture.current;
          const el = scrollerRef.current;
          const geo = live.current;
          if (!now?.active || !el || !geo) return;
          const rect = el.getBoundingClientRect();
          const { dx } = autoScrollStep(
            { x: now.lastX, y: now.lastY },
            { left: rect.left + geo.nameW, right: rect.right, top: rect.top, bottom: rect.bottom },
          );
          if (dx !== 0) {
            el.scrollLeft += dx;
            show(now);
          }
          now.frame = requestAnimationFrame(tick);
        };
        g.frame = requestAnimationFrame(tick);
      }
      show(g);
    };
    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      end(true);
    };
    const onCancel = (e: PointerEvent) => {
      if (gesture.current && e.pointerId === gesture.current.pointerId) end(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !gesture.current?.active) return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };
    // The window lost focus mid-press (⌘-Tab): its pointerup may never come.
    const onBlur = () => end(false);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      const g = gesture.current;
      if (g) cancelAnimationFrame(g.frame);
    };
  }, [end, show, store, scrollerRef, live]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || gesture.current) return;
      const geo = live.current;
      if (!geo || !(e.target instanceof Element)) return;
      const target = e.target;
      // Buttons on the track (a hint, the dependency mark) keep their clicks.
      if (!target.closest("[data-timeline-track]") || target.closest("button")) return;
      const rowEl = target.closest<HTMLElement>("[data-row-key]");
      const rowKey = rowEl?.dataset.rowKey;
      const row = rowKey ? geo.rowOf(rowKey) : undefined;
      if (!row || !rowKey || !geo.canDrag(row)) return;
      const day = dayAt(e.clientX);
      if (day === null) return;
      const grab = grabOf(target, row, day, geo);
      if (!grab) return;
      gesture.current = {
        pointerId: e.pointerId,
        grab,
        rowKey,
        startX: e.clientX,
        startDay: day,
        lastX: e.clientX,
        lastY: e.clientY,
        active: false,
        frame: 0,
        preview: null,
      };
    },
    [live, dayAt],
  );

  /** The ghost on an undated row: where a click would date it. */
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (gesture.current?.active || e.buttons !== 0) return;
      const geo = live.current;
      const target = e.target instanceof Element ? e.target : null;
      const track = target?.closest("[data-timeline-track]");
      const rowKey = track ? target?.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey : null;
      const row = rowKey && geo ? geo.rowOf(rowKey) : undefined;
      if (
        !row ||
        !rowKey ||
        !geo?.canDrag(row) ||
        !drawableKind(row) ||
        target?.closest("button")
      ) {
        store.setHover(null);
        return;
      }
      const day = dayAt(e.clientX);
      store.setHover(day === null ? null : { rowKey, day });
    },
    [live, dayAt, store],
  );

  const onPointerLeave = useCallback(() => store.setHover(null), [store]);

  /** Swallow the click a drag ends with (it isn't a click on the row). */
  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerLeave, onClickCapture };
}

/** What a press on the track grabbed, or null (a plain click). */
function grabOf(
  target: Element,
  row: TimelineRow,
  day: number,
  geo: CanvasLive,
): TimelineGrab | null {
  const mark = target.closest("[data-timeline-mark]");
  const kind = mark?.getAttribute("data-timeline-mark");
  if (mark && kind === "point" && row.kind === "task") {
    const id = row.task.id;
    // A selection moves together (70): the ones this person may move.
    const taskIds =
      geo.selection.size >= 2 && geo.selection.has(id)
        ? [...geo.selection].filter((t) => t === id || geo.canEditTask(t))
        : [id];
    return { kind: "point", taskId: id, taskIds };
  }
  if (mark && kind === "diamond") {
    const sectionId = mark.getAttribute("data-section-id");
    if (!sectionId) return null;
    const at =
      row.kind === "section" && row.section?.id === sectionId
        ? row.milestone
        : row.kind === "project"
          ? (row.bar?.milestones.find((m) => m.sectionId === sectionId)?.day ?? null)
          : null;
    return at === null ? null : { kind: "diamond", sectionId, day: at };
  }
  if (mark && kind === "band" && mark.hasAttribute("data-interactive")) {
    if (row.kind !== "section" || !row.section || !row.band) return null;
    return {
      kind: "band",
      sectionId: row.section.id,
      span: row.band,
      edge: edgeOf(target.closest("[data-timeline-edge]")),
    };
  }
  if (mark && kind === "bar" && row.kind === "project" && row.bar) {
    return {
      kind: "bar",
      projectId: row.project.id,
      span: { start: row.bar.start, end: row.bar.end },
      edge: edgeOf(target.closest("[data-timeline-edge]")),
      solid: row.bar.solid,
    };
  }
  if (mark) return null;
  const draw = drawTargetOf(row);
  return draw ? { kind: "draw", target: draw, from: day } : null;
}

/** What a finished gesture saves, or null when nothing changed. */
function commitOf(g: Gesture, preview: DragPreview | null): CanvasCommit | null {
  const { grab } = g;
  if (!g.active) {
    // A click: only an undated row is dated by one.
    if (grab.kind !== "draw") return null;
    return {
      kind: "draw",
      target: grab.target,
      span: { start: grab.from, end: grab.from },
      clicked: true,
    };
  }
  if (!preview) return null;
  if (preview.kind === "point" && grab.kind === "point") {
    return preview.delta === 0
      ? null
      : { kind: "points", taskId: grab.taskId, taskIds: grab.taskIds, delta: preview.delta };
  }
  if (preview.kind === "diamond" && grab.kind === "diamond") {
    return preview.day === grab.day
      ? null
      : { kind: "diamond", sectionId: grab.sectionId, day: preview.day };
  }
  if (preview.kind === "band" && grab.kind === "band") {
    return sameSpan(preview.span, grab.span)
      ? null
      : { kind: "band", sectionId: grab.sectionId, span: preview.span };
  }
  if (preview.kind === "bar" && grab.kind === "bar") {
    // An outlined bar becomes solid once it's moved: its dates are set now.
    return sameSpan(preview.span, grab.span)
      ? null
      : { kind: "bar", projectId: grab.projectId, span: preview.span };
  }
  if (preview.kind === "draw" && grab.kind === "draw") {
    return { kind: "draw", target: grab.target, span: preview.span, clicked: false };
  }
  return null;
}

function sameSpan(a: DaySpan, b: DaySpan): boolean {
  return a.start === b.start && a.end === b.end;
}

/** Two previews that draw the same (a pointer move within one day). */
function sameish(a: DragPreview | null, b: DragPreview | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case "point":
      return b.kind === "point" && a.delta === b.delta && a.leadId === b.leadId;
    case "diamond":
      return b.kind === "diamond" && a.day === b.day;
    case "band":
      return b.kind === "band" && sameSpan(a.span, b.span);
    case "bar":
      return b.kind === "bar" && sameSpan(a.span, b.span);
    case "draw":
      return b.kind === "draw" && a.rowKey === b.rowKey && sameSpan(a.span, b.span);
  }
}
