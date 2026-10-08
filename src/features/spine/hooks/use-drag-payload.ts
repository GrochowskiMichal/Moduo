// Connective-tissue spine — dnd-kit bindings for the drag-payload contract (CT-3).
//
// Thin hooks over dnd-kit's useDraggable/useDroppable that speak the universal
// DragPayload / DropLinkTarget vocabulary (src/lib/drag-payload.ts). A consumer
// inside a <DndContext> uses these to make any entity a drag source and any
// surface a link target; the contract decides acceptance + the relation kind.

import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  asDragPayload,
  type DragPayload,
  type DropLinkTarget,
  targetAccepts,
} from "@/lib/drag-payload";

/** Make an element an entity drag source. Spread `listeners`+`attributes` on it. */
export function useDragPayload(payload: DragPayload, opts: { disabled?: boolean } = {}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `drag:${payload.entityType}:${payload.entityId}`,
    data: payload,
    disabled: opts.disabled,
  });
  return { setNodeRef, listeners, attributes, isDragging };
}

/**
 * Make an element a link drop-target. `isOver` is true only when a currently
 * dragged, *accepted* payload hovers it (so the caller paints the drop ring only
 * for valid drops); `canDrop` reflects acceptance regardless of hover.
 */
export function useDropLinkTarget(target: DropLinkTarget, opts: { disabled?: boolean } = {}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `link:${target.entityType}:${target.entityId}`,
    data: target,
    disabled: opts.disabled,
  });
  const activePayload = asDragPayload(active?.data?.current);
  const canDrop = activePayload ? targetAccepts(target, activePayload) : false;
  return { setNodeRef, isOver: isOver && canDrop, canDrop, activePayload };
}
