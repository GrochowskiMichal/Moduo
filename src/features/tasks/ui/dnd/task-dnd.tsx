// Reusable drag-and-drop layer for the Tasks module.
//
// One typed vocabulary so every surface (queue reorder, board reorder/move,
// drag-onto-task → subtask, and future drop targets like a calendar slot or a
// cross-surface task sidebar) speaks the same language instead of re-deriving
// sensors, payloads, and the drag handle per view:
//   • `taskDrag` / `asTaskDrag` — the payload every draggable task carries.
//   • `TaskDropTarget` — a discriminated union of where a task can land; new
//     surfaces add a variant + a branch in their drop handler, nothing else.
//   • `useTaskDndSensors` — shared pointer + keyboard sensors (a11y reorder).
//   • `SortableTask` / `NestableTask` — wrappers that hand the row its drag
//     listeners so the whole row is the activator (no separate grip).
//
// dnd-kit does the geometry; this module is the shared contract on top of it.

import { useCallback, type CSSProperties, type ReactNode } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "../../../../lib/utils";

// ── drag payload ─────────────────────────────────────────────────────────────

/** Where a dragged task originated (lets a target react to cross-surface drags). */
export type TaskDragSource = "list" | "board" | "queue";

/** The `data` every draggable task carries on its dnd-kit node. */
export type TaskDragData = { type: "task"; taskId: string; from: TaskDragSource };

export function taskDrag(taskId: string, from: TaskDragSource): TaskDragData {
  return { type: "task", taskId, from };
}

/** Narrow an `active.data.current` (or `over` data) back to a task payload. */
export function asTaskDrag(data: unknown): TaskDragData | null {
  return data && typeof data === "object" && (data as { type?: unknown }).type === "task"
    ? (data as TaskDragData)
    : null;
}

// ── drop targets ─────────────────────────────────────────────────────────────

/**
 * Every place a task can be dropped, as a discriminated union. A sortable item
 * (queue/board card) is identified by its own task id and handled by dnd-kit's
 * sortable directly — these variants are the *non-sortable* targets a surface
 * sets on `useDroppable({ data })`. Adding a surface (e.g. a calendar slot) is a
 * new variant here + one branch in that surface's `onDragEnd`; existing call
 * sites stay untouched.
 */
export type TaskDropTarget =
  // Drop onto another task → make the dragged task its subtask (one level).
  | { type: "onto-task"; taskId: string }
  // Board column → move (and re-rank to the column end on a bare column drop).
  | { type: "column"; dim: "status" | "bucket"; value: string };
// Future, additive: | { type: "calendar-slot"; startsAt: string }

export function asTaskDropTarget(data: unknown): TaskDropTarget | null {
  const t = (data as { type?: unknown } | null)?.type;
  return t === "onto-task" || t === "column" ? (data as TaskDropTarget) : null;
}

// ── sensors ──────────────────────────────────────────────────────────────────

/**
 * Shared sensors: a small pointer activation distance (so a click still selects
 * / opens the row without starting a drag) plus a keyboard sensor for accessible
 * dragging (focus the grip, Space to lift, arrows to move).
 *
 * `sortable` (default) wires the keyboard sensor to dnd-kit's sortable coordinate
 * getter — correct for reorder lists inside a `SortableContext`. Drag-onto-target
 * surfaces (e.g. nesting) have no sortable context, so they pass `sortable:false`
 * to fall back to the default step-and-detect keyboard behaviour.
 */
export function useTaskDndSensors(opts?: { sortable?: boolean }) {
  const sortable = opts?.sortable ?? true;
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(
      KeyboardSensor,
      sortable ? { coordinateGetter: sortableKeyboardCoordinates } : undefined,
    ),
  );
}

// ── collision detection ──────────────────────────────────────────────────────

/**
 * Pointer-first collision strategy for drag-*onto*-target surfaces (nesting),
 * where a droppable's rect can be taller than its own row: an expanded parent's
 * `onto-task` node encloses its visible children (see {@link NestableTask}), so
 * its geometric centre sits down among them. Plain `closestCenter` then
 * mis-resolves a hover over a lower child to the *next sibling* (whose centre is
 * nearer the pointer), nesting under the wrong parent. `pointerWithin` asks the
 * precise question instead — which droppable actually contains the pointer — and
 * only falls back to `closestCenter` when there is no pointer (keyboard dragging)
 * or it sits outside every droppable. This is the dnd-kit-recommended combo for
 * high-precision drop-onto-target semantics.
 *
 * Reorder surfaces (Queue/board) stay on plain `closestCenter`: their droppables
 * are one row tall, so centre distance is the right proxy and the sortable
 * keyboard path expects it.
 */
export const pointerFirstCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  return pointerHits.length > 0 ? pointerHits : closestCenter(args);
};

// ── sortable wrapper ─────────────────────────────────────────────────────────

type SortableTaskRender = (slot: {
  /** dnd-kit listeners — spread on the row root so the WHOLE row is the drag
   * activator (no separate grip). A 6px activation distance (see
   * {@link useTaskDndSensors}) keeps plain clicks selecting/opening the row. */
  dragListeners: DraggableSyntheticListeners;
  isDragging: boolean;
}) => ReactNode;

/**
 * Wraps a sortable task row/card: owns the sortable node ref + transform and
 * hands the drag listeners back for the child to spread on the whole row. The
 * dragged item lifts (raised z + reduced opacity) while its neighbours animate
 * apart — the insertion affordance comes free from the sortable strategy.
 */
export function SortableTask({
  id,
  from,
  disabled,
  className,
  render,
}: {
  id: string;
  from: TaskDragSource;
  disabled?: boolean;
  className?: string;
  render: SortableTaskRender;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    data: taskDrag(id, from),
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "relative z-10 opacity-60", className)}
    >
      {render({ dragListeners: listeners, isDragging })}
    </div>
  );
}

// ── nestable wrapper (drag-onto-task → subtask) ──────────────────────────────

type NestableTaskRender = (slot: {
  /** dnd-kit listeners — spread on the row root so the WHOLE childless row is
   * the drag activator. Undefined when this row can't be dragged (has children). */
  dragListeners: DraggableSyntheticListeners;
  /** A valid drop is currently hovering this row → caller paints the target. */
  isOver: boolean;
  isDragging: boolean;
}) => ReactNode;

/**
 * Wraps a row that can be dragged *onto another row* to nest it (set parent),
 * and/or receive such a drop. Unlike {@link SortableTask} there is no
 * reordering: the row is a plain draggable plus an `onto-task` droppable on the
 * same node. The two capabilities are gated independently —
 *   • `canDrag` — only a childless task may become a subtask (one level), so the
 *     handle (and lift) appear only when true;
 *   • `canDrop` — only a valid parent target for the in-flight drag; the caller
 *     recomputes this per render against the active task and toggles it, so
 *     invalid rows never register as `over`.
 */
export function NestableTask({
  id,
  from,
  canDrag = true,
  canDrop = true,
  className,
  render,
}: {
  id: string;
  from: TaskDragSource;
  canDrag?: boolean;
  canDrop?: boolean;
  className?: string;
  render: NestableTaskRender;
}) {
  const {
    setNodeRef: setDragRef,
    listeners,
    isDragging,
  } = useDraggable({ id, data: taskDrag(id, from), disabled: !canDrag });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `onto:${id}`,
    data: { type: "onto-task", taskId: id } satisfies TaskDropTarget,
    disabled: !canDrop,
  });
  // Same DOM node is both the drag source and the drop target.
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-50", className)}>
      {render({ dragListeners: listeners, isOver, isDragging })}
    </div>
  );
}
