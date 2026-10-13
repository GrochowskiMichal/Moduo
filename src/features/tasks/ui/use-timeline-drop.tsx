// A task dragged from the right panel's No date view onto the Timeline's
// canvas (Tasks v3 TV-TL2, REPLAN 70): the whole canvas is one drop target,
// and the day is the one under the pointer when it's let go. It sets only the
// due date, never the project (research §4).
//
// The drag is the page's one dnd-kit context (DF-22), so a drag from the
// right pane reaches the centre. Where it lands comes from the raw pointer,
// tracked while the drag runs and read against the canvas as it is at the
// drop (dnd-kit's delta folds its own auto-scroll in, gotchas/ui.md).

import {
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useDndMonitor,
  useDroppable,
} from "@dnd-kit/core";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DragOverlaySurface } from "../../../components/ui/drag-visuals";
import { formatWeekdayDate } from "../../../lib/time-format";
import type { Task } from "../model";
import { dateOfDay, dayAtX, type TimelineRange } from "../timeline-scale";
import { asTaskDrag, overlayBesideCursor } from "./dnd/task-dnd";
import { type CanvasStore, useDropDay } from "./timeline-drag-store";

/** The canvas's one droppable (`TaskDropTarget` "timeline-axis"). */
export const TIMELINE_DROP_ID = "timeline-axis";

type Geometry = { range: TimelineRange; dw: number; nameW: number };

export function useTimelineDrop({
  scrollerRef,
  store,
  geometry,
  canEdit,
  taskOf,
  onDrop,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  store: CanvasStore;
  geometry: RefObject<Geometry>;
  canEdit: boolean;
  taskOf: (id: string) => Task | null;
  /** Make the task due on the day. */
  onDrop: (taskId: string, day: number) => void;
}): { setDropRef: (el: HTMLElement | null) => void; overlay: ReactNode } {
  const { setNodeRef } = useDroppable({
    id: TIMELINE_DROP_ID,
    data: { type: "timeline-axis" },
    disabled: !canEdit,
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ onDrop, taskOf });
  useEffect(() => {
    latest.current = { onDrop, taskOf };
  });

  /** The day under a pointer over the canvas (right of the name column), or null. */
  const dayAt = useCallback(
    (at: { x: number; y: number }): number | null => {
      const el = scrollerRef.current;
      const geo = geometry.current;
      if (!el || !geo) return null;
      const box = el.getBoundingClientRect();
      const left = box.left + geo.nameW;
      if (at.x < left || at.x > box.right || at.y < box.top || at.y > box.bottom) return null;
      return dayAtX(geo.range, geo.dw, at.x - left + el.scrollLeft);
    },
    [scrollerRef, geometry],
  );

  // While a No date drag runs, follow the raw pointer and show its day.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      store.setDrop(dayAt(pointer.current));
    };
    document.addEventListener("pointermove", onMove, true);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      store.setDrop(null);
    };
  }, [dragging, dayAt, store]);

  const fromNoDate = (event: { active: { data: { current?: unknown } } }) => {
    const drag = asTaskDrag(event.active.data.current);
    return drag?.from === "no-date" ? drag.taskId : null;
  };

  useDndMonitor({
    onDragStart: (event: DragStartEvent) => {
      const id = fromNoDate(event);
      if (!id) return;
      pointer.current = null;
      setDragging(id);
    },
    onDragEnd: (event: DragEndEvent) => {
      const id = fromNoDate(event);
      setDragging(null);
      if (!id || event.over?.id !== TIMELINE_DROP_ID || !pointer.current) return;
      const day = dayAt(pointer.current);
      if (day !== null) latest.current.onDrop(id, day);
    },
    onDragCancel: () => setDragging(null),
  });

  const task = dragging ? latest.current.taskOf(dragging) : null;
  const overlay =
    typeof document !== "undefined"
      ? createPortal(
          <DragOverlay modifiers={dragging ? [overlayBesideCursor] : undefined}>
            {task ? <NoDateOverlay title={task.title || "Untitled"} /> : null}
          </DragOverlay>,
          document.body,
        )
      : null;
  return { setDropRef: setNodeRef, overlay };
}

/** The dragged task, and the day it would land on once it's over the canvas. */
function NoDateOverlay({ title }: { title: string }) {
  const day = useDropDay();
  return (
    <DragOverlaySurface className="w-64">
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {day !== null ? (
        <span className="shrink-0 font-sans text-xs text-muted-foreground">
          Due {formatWeekdayDate(dateOfDay(day))}
        </span>
      ) : null}
    </DragOverlaySurface>
  );
}
