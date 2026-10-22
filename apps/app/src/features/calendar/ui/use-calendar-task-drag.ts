// Drag-to-schedule (the universal drag contract, AC6): a task row dragged from
// the panel onto a day column schedules it at the slot under the pointer.

import {
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { asDragPayload } from "../../../lib/drag-payload";
import type { Task } from "../../tasks/model";
import type { useTaskCommands } from "../../tasks/tasks-context";
import { dayGeometry } from "../grid-layout";
import { parseDayKey } from "../lens";

/** Default duration when a drop schedules a task that has none (AC6). */
const DEFAULT_DROP_MINUTES = 30;
const DROP_SNAP_MINUTES = 15;

type Input = {
  tasks: Task[];
  canEdit: boolean;
  commands: ReturnType<typeof useTaskCommands>;
};

export function useCalendarTaskDrag({ tasks, canEdit, commands }: Input) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const dragTask = dragTaskId ? tasks.find((t) => t.id === dragTaskId) : null;

  // The drop slot needs the REAL pointer position: dnd-kit's `delta` folds
  // auto-scroll compensation in, so activator+delta drifts by the scrolled
  // amount whenever the grid auto-scrolls mid-drag. Track the pointer raw.
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!dragTaskId) return;
    const onMove = (e: PointerEvent) => {
      dragPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    return () => document.removeEventListener("pointermove", onMove, { capture: true });
  }, [dragTaskId]);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragTaskId(null);
      const pointer = dragPointerRef.current;
      dragPointerRef.current = null;
      const payload = asDragPayload(e.active.data.current);
      if (!payload || payload.entityType !== "task") return;
      const overId = e.over ? String(e.over.id) : "";
      if (!overId.startsWith("cal-day:")) return;
      const dayKey = overId.slice("cal-day:".length);
      const day = parseDayKey(dayKey);
      if (!day) return;
      const colEl = document.querySelector<HTMLElement>(`[data-day-col][data-day-key="${dayKey}"]`);
      if (!colEl) return;
      const task = tasks.find((t) => t.id === payload.entityId);
      if (!task || !canEdit) return;
      const geom = dayGeometry(day);
      const rect = colEl.getBoundingClientRect();
      const activator = e.activatorEvent as PointerEvent | MouseEvent;
      const pointerY =
        pointer?.y ??
        (typeof activator?.clientY === "number" ? activator.clientY : rect.top) + e.delta.y;
      const frac = Math.min(Math.max((pointerY - rect.top) / rect.height, 0), 1);
      const rawMin = frac * geom.totalMinutes;
      // Duration clamps to the day so a fat-fingered estimate can't push the
      // start negative or paint past the grid bottom.
      const duration = Math.min(task.durationMinutes || DEFAULT_DROP_MINUTES, geom.totalMinutes);
      const startMin = Math.min(
        Math.max(Math.round(rawMin / DROP_SNAP_MINUTES) * DROP_SNAP_MINUTES, 0),
        geom.totalMinutes - duration,
      );
      commands.patchTask(task.id, {
        scheduledAt: new Date(geom.dayStartMs + startMin * 60_000).toISOString(),
        durationMinutes: duration,
      });
    },
    [commands, tasks, canEdit],
  );

  return {
    sensors,
    dragTask,
    onDragStart: (e: DragStartEvent) => {
      const payload = asDragPayload(e.active.data.current);
      setDragTaskId(payload?.entityType === "task" ? payload.entityId : null);
    },
    onDragEnd,
    onDragCancel: () => setDragTaskId(null),
  };
}
