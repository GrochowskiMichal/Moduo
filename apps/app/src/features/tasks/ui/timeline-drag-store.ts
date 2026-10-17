// What the canvas shows while a drag runs, and the ghost a hover over an
// undated row shows (TV-TL2). A small store the marks subscribe to with a
// selector: a drag moves only the marks it holds, and the view and the other
// rows never redraw for it (TV-D11b's one-edit-one-row rule).

import { createContext, useContext, useSyncExternalStore } from "react";

import type { DaySpan } from "../timeline-rows";

/** The drag in progress, as the marks draw it. */
export type DragPreview =
  /** Points moved by `delta` days (several when a selection moves). */
  | { kind: "point"; taskIds: ReadonlySet<string>; leadId: string; delta: number }
  | { kind: "diamond"; sectionId: string; day: number }
  | { kind: "band"; sectionId: string; span: DaySpan }
  | { kind: "bar"; projectId: string; span: DaySpan }
  /** Drawing on an undated row: a point (start = end), a range, a bar. */
  | { kind: "draw"; rowKey: string; span: DaySpan };

/** The day under the pointer on an undated row you could date by a click. */
export type HoverGhost = { rowKey: string; day: number };

export type CanvasStore = {
  getDrag: () => DragPreview | null;
  setDrag: (next: DragPreview | null) => void;
  getHover: () => HoverGhost | null;
  setHover: (next: HoverGhost | null) => void;
  /** The task under the pointer (its dependency lines show, 70). */
  getHoverTask: () => string | null;
  setHoverTask: (next: string | null) => void;
  /** The day a task from the No date view would land on, while one is dragged over the canvas. */
  getDrop: () => number | null;
  setDrop: (next: number | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createCanvasStore(): CanvasStore {
  let drag: DragPreview | null = null;
  let hover: HoverGhost | null = null;
  let hoverTask: string | null = null;
  let drop: number | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getDrag: () => drag,
    setDrag: (next) => {
      if (next === drag) return;
      drag = next;
      emit();
    },
    getHover: () => hover,
    setHover: (next) => {
      if (next?.rowKey === hover?.rowKey && next?.day === hover?.day) return;
      hover = next;
      emit();
    },
    getHoverTask: () => hoverTask,
    setHoverTask: (next) => {
      if (next === hoverTask) return;
      hoverTask = next;
      emit();
    },
    getDrop: () => drop,
    setDrop: (next) => {
      if (next === drop) return;
      drop = next;
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const IDLE = createCanvasStore();

export const TimelineCanvasContext = createContext<CanvasStore>(IDLE);

/**
 * The drag, when it concerns this mark (`match`), else null. The answer is
 * the store's own object, so a mark the drag doesn't hold never redraws.
 */
export function useDragFor(match: (drag: DragPreview) => boolean): DragPreview | null {
  const store = useContext(TimelineCanvasContext);
  return useSyncExternalStore(store.subscribe, () => {
    const drag = store.getDrag();
    return drag && match(drag) ? drag : null;
  });
}

/** How many days a task's point is being moved (0: not by this drag). */
export function usePointDelta(taskId: string): number {
  const store = useContext(TimelineCanvasContext);
  return useSyncExternalStore(store.subscribe, () => {
    const drag = store.getDrag();
    return drag?.kind === "point" && drag.taskIds.has(taskId) ? drag.delta : 0;
  });
}

/** The task under the pointer, or null. */
export function useHoverTask(): string | null {
  const store = useContext(TimelineCanvasContext);
  return useSyncExternalStore(store.subscribe, store.getHoverTask);
}

/** The day a No date drag would land on, or null. */
export function useDropDay(): number | null {
  const store = useContext(TimelineCanvasContext);
  return useSyncExternalStore(store.subscribe, store.getDrop);
}

/** The hovered day on this row (its ghost), or null. */
export function useHoverDay(rowKey: string): number | null {
  const store = useContext(TimelineCanvasContext);
  return useSyncExternalStore(store.subscribe, () => {
    const hover = store.getHover();
    return hover?.rowKey === rowKey ? hover.day : null;
  });
}
