// Reusable drag-and-drop layer for the Tasks module.
//
// One typed vocabulary so every surface (queue reorder, board reorder/move,
// the List's reorder-or-nest, the rail's drop targets, and future ones like a
// calendar slot) speaks the same language instead of re-deriving sensors,
// payloads, and the drag handle per view:
//   • `taskDrag` / `asTaskDrag` — the payload every draggable task carries.
//   • `TaskDropTarget` — a discriminated union of where a task can land; new
//     surfaces add a variant + a branch in their drop handler, nothing else.
//   • `useTaskDndSensors` — shared pointer + keyboard sensors (a11y reorder).
//   • `SortableTask` / `DraggableTask` — wrappers that hand the row its drag
//     listeners + activator ref so the whole row is the activator (no grip).
//   • DS-4's drag visuals (`DRAG_SOURCE`, `DROP_TARGET`, `InsertionLine`,
//     `NestPreview`, `DragOverlaySurface`) are the one look (tasks-v2 U4-5).
//
// dnd-kit does the geometry; this module is the shared contract on top of it.

import {
  type CollisionDetection,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type SensorDescriptor,
  type SensorOptions,
  useDndMonitor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";

import { DRAG_SOURCE } from "../../../../components/ui/drag-visuals";
import { cn } from "../../../../lib/utils";

// ── drag payload ─────────────────────────────────────────────────────────────

/** Where a dragged task originated (lets a target react to cross-surface drags). */
export type TaskDragSource = "list" | "board" | "queue" | "tray";

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
 * sites stay untouched. The List has no droppables: it resolves reorder-or-nest
 * from the raw pointer (`dnd/drop-mode.ts`); the rail's are `dnd/rail-drop.ts`.
 */
export type TaskDropTarget =
  // Board column → move (and re-rank to the column end on a bare column drop).
  | { type: "column"; dim: "status" | "bucket"; value: string }
  // The Timeline's lanes region — ONE droppable for the whole axis; the drop
  // day is derived from the raw tracked pointer at drop time (dnd-kit's delta
  // folds auto-scroll in — gotchas.md), not from per-day droppables.
  | { type: "timeline-axis" };
// Future, additive: | { type: "calendar-slot"; startsAt: string }

export function asTaskDropTarget(data: unknown): TaskDropTarget | null {
  const t = (data as { type?: unknown } | null)?.type;
  return t === "column" || t === "timeline-axis" ? (data as TaskDropTarget) : null;
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
export function useTaskDndSensors(opts?: { sortable?: boolean; keyboard?: boolean }) {
  const sortable = opts?.sortable ?? true;
  // `keyboard: false` for surfaces whose DROP resolution is pointer-derived
  // (the timeline axis): a keyboard "lift" there could never commit, and a
  // drag affordance that silently no-ops is worse than none.
  const keyboard = opts?.keyboard ?? true;
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(
      KeyboardSensor,
      keyboard
        ? sortable
          ? { coordinateGetter: sortableKeyboardCoordinates }
          : undefined
        : { keyboardCodes: { start: [], cancel: [], end: [] } },
    ),
  );
}

// ── external-context monitor (DF-22) ─────────────────────────────────────────

/**
 * Binds a view's drag handlers to a DndContext owned by an ANCESTOR (the tasks
 * page's one app-level context) instead of the view providing its own — the
 * NO-7b pattern (gotchas §Drag-to-link). Must render inside that context.
 *
 * DF-22 collapses the Tasks list/board/hub into one context so a center-pane
 * task drag can reach the right-pane hub. Each view keeps its OWN reorder/nest
 * handlers (spatially disjoint — each acts only when the drop is over its own
 * surface) and subscribes through this monitor; the page provides the single
 * context + collision + sensors. Renders nothing.
 */
export function TaskDndMonitor({
  onDragStart,
  onDragEnd,
  onDragCancel,
}: {
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: (event: DragCancelEvent) => void;
}) {
  useDndMonitor({ onDragStart, onDragEnd, onDragCancel });
  return null;
}

/**
 * A drag boundary that is EITHER a self-owned `<DndContext>` ("internal", the
 * default — stories/standalone mounts) OR a {@link TaskDndMonitor} that
 * subscribes to an ancestor context ("external" — DF-22, the tasks page's one
 * app-level context). The same reorder/nest children render inside either; only
 * the ownership of the context (and thus the sensors/collision) moves.
 *
 * External mode ignores `sensors`/`collisionDetection` — the ancestor supplies
 * them. Keep the passed values as the internal-mode fallback so a view stays
 * fully functional on its own.
 */
export function DndBoundary({
  dndMode,
  sensors,
  collisionDetection,
  onDragStart,
  onDragEnd,
  onDragCancel,
  children,
}: {
  dndMode: "internal" | "external";
  sensors: SensorDescriptor<SensorOptions>[];
  collisionDetection: CollisionDetection;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: (event: DragCancelEvent) => void;
  children: ReactNode;
}) {
  if (dndMode === "external") {
    return (
      <>
        <TaskDndMonitor
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        />
        {children}
      </>
    );
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {children}
    </DndContext>
  );
}

// ── sortable wrapper ─────────────────────────────────────────────────────────

/**
 * Attach to the element the drag listeners are spread on (the row root). It
 * makes that element the only keyboard activator: dnd-kit's keyboard sensor
 * starts a drag only when Space/Enter is pressed ON the activator. Without it,
 * Space/Enter bubbling up from a button inside the row (the check-off, the
 * queue toggle) starts a keyboard drag and swallows the button (tasks-v2 Q1-2).
 */
export type DragActivatorRef = (element: HTMLElement | null) => void;

type SortableTaskRender = (slot: {
  /** dnd-kit listeners — spread on the row root so the WHOLE row is the drag
   * activator (no separate grip). A 6px activation distance (see
   * {@link useTaskDndSensors}) keeps plain clicks selecting/opening the row. */
  dragListeners: DraggableSyntheticListeners;
  /** Set on the same element as `dragListeners` — see {@link DragActivatorRef}. */
  dragActivatorRef: DragActivatorRef;
  isDragging: boolean;
}) => ReactNode;

/**
 * Wraps a sortable task row/card: owns the sortable node ref + transform and
 * hands the drag listeners + activator ref back for the child to put on the
 * whole row. The source stays in its slot dimmed (DRAG_SOURCE) while the
 * overlay follows the pointer and its neighbours animate apart.
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
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({
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
      className={cn(isDragging && ["relative z-10", DRAG_SOURCE], className)}
    >
      {render({ dragListeners: listeners, dragActivatorRef: setActivatorNodeRef, isDragging })}
    </div>
  );
}

// ── draggable wrapper (the List: reorder or nest) ────────────────────────────

type DraggableTaskRender = (slot: {
  /** dnd-kit listeners — spread on the row root so the WHOLE row is the drag
   * activator. */
  dragListeners: DraggableSyntheticListeners;
  /** Set on the same element as `dragListeners` — see {@link DragActivatorRef}. */
  dragActivatorRef: DragActivatorRef;
  isDragging: boolean;
}) => ReactNode;

/**
 * Wraps a List row as a plain drag source. There's no droppable: where it
 * lands (before/after a row, nested under one, into a group) is resolved from
 * the raw pointer against the rows' boxes (`dnd/drop-mode.ts`), and the rail
 * and the hub are their own droppables. The source stays put, dimmed.
 */
export function DraggableTask({
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
  render: DraggableTaskRender;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({
    id,
    data: taskDrag(id, from),
    disabled,
  });
  return (
    <div ref={setNodeRef} className={cn(isDragging && DRAG_SOURCE, className)}>
      {render({ dragListeners: listeners, dragActivatorRef: setActivatorNodeRef, isDragging })}
    </div>
  );
}
