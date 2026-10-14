import { useDroppable } from "@dnd-kit/core";

import { NavRow, type NavRowProps } from "../../../../components/ui/nav-row";
import { type RailDropTarget, railDroppableId } from "../../dnd/rail-drop";
import { asTaskDrag } from "./task-dnd";

/** Whether a drop of `taskId` on this rail row would change anything. */
export type RailDropAccepts = (target: RailDropTarget, taskId: string) => boolean;

/**
 * A Tasks rail row that takes task drops (tasks-v2 §8, TV-U4): a `rail:*`
 * droppable on the NavRow root, tinted with NavRow's drop-target state (DS-4's
 * DROP_TARGET) while a task it would accept hovers it. Render it only under
 * the page's DndContext — `useDroppable` needs one (gotchas/ui.md); the rail
 * falls back to a plain NavRow otherwise.
 */
export function RailDropRow({
  target,
  accepts,
  ...props
}: NavRowProps & { target: RailDropTarget; accepts: RailDropAccepts }) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: railDroppableId(target),
    data: target,
  });
  const drag = asTaskDrag(active?.data.current);
  const accepting = !!drag && isOver && accepts(target, drag.taskId);
  return <NavRow ref={setNodeRef} dropTarget={accepting} {...props} />;
}
