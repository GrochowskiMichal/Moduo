import {
  closestCenter,
  closestCorners,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import {
  asDragPayload,
  asDropLinkTarget,
  isSelfDrop,
  targetAccepts,
} from "../../../../lib/drag-payload";
import { createLinkWithToast } from "../../../spine/ui/drop-link-toast";
import {
  isSideDroppable,
  RAIL_DROP_PREFIX,
  railCollision,
  railSortCollision,
} from "../../dnd/rail-drop";
import { asRailProject } from "../bucket-rail";
import { taskDragAnnouncements, useTaskDndSensors } from "../dnd/task-dnd";
import { TASK_DETAIL_REFRESH_EVENT } from "../task-detail-panel";
import { boardDropName } from "../use-board-folds";
import { TIMELINE_DROP_ID } from "../use-timeline-drop";
import type { PlanController } from "./use-tasks-plan-controller";

export function PlanDndHost({ c, children }: { c: PlanController; children: React.ReactNode }) {
  const { workspaceId, runtime, canEdit, place, bucketNameById, view, taskById, onRailDragEnd } = c;

  // ── DF-22: one app-level DndContext across the whole shell ──────────────────
  // Unifies the center views' reorder/nest with the right-pane hub (DF-8 shipped
  // the hub as a ready-but-sourceless drop target) so a task dragged from the
  // List or Board can be dropped on the selected task's hub to link it. The List
  // & Board render as `useDndMonitor` consumers (dndMode="external", the NO-7b
  // pattern). The Timeline (TV-TL2) is one too, for one drag only: a task from
  // the right panel's No date view onto its canvas (one droppable, the day from
  // the raw pointer at the drop). Its own marks drag with plain pointer events
  // (`use-timeline-canvas.ts`), never through this context.
  const pageSensors = useTaskDndSensors();
  // Refs so the collision fn (stable, empty-deps) always reads the live surface;
  // neither can change mid-drag (switching view/scope remounts the body).
  const viewRef = useRef(view);
  const selectionRef = useRef(place);
  useEffect(() => {
    viewRef.current = view;
    selectionRef.current = place;
  });
  // One collision for every surface. The hub (`link:*`) and the rail
  // (`rail:*`, TV-U4) win whenever the pointer is actually over one of their
  // droppables — prefix-filtered `pointerWithin`, so a drag near them never
  // snaps to them by distance. Otherwise each centre view keeps its OWN native
  // strategy over its OWN droppables (hub and rail filtered out): Board =
  // closestCorners; Queue reorder = closestCenter (NOT pointer-first — the
  // whole row is the drag activator, so an off-center grab makes the
  // dragged-rect-centre and the pointer diverge, changing the drop index). The
  // List has no droppables: it resolves reorder/nest/group from the raw
  // pointer itself (dnd/drop-mode.ts), so it finds nothing here.
  const appCollision = useCallback<CollisionDetection>((args) => {
    // A sidebar project being dragged sorts only among the project rows (TV-U6).
    if (asRailProject(args.active.data.current)) return railSortCollision(args);
    const linkContainers = args.droppableContainers.filter((c) => String(c.id).startsWith("link:"));
    if (linkContainers.length > 0) {
      const hubHits = pointerWithin({ ...args, droppableContainers: linkContainers });
      if (hubHits.length > 0) return hubHits;
    }
    const railHits = railCollision(args);
    if (railHits.length > 0) return railHits;
    const centerContainers = args.droppableContainers.filter((c) => !isSideDroppable(c.id));
    if (viewRef.current === "board") {
      return closestCorners({ ...args, droppableContainers: centerContainers });
    }
    if (selectionRef.current === "today") {
      return closestCenter({ ...args, droppableContainers: centerContainers });
    }
    // The Timeline's canvas takes a No date task only while the pointer is on it.
    if (viewRef.current === "timeline") {
      const canvas = centerContainers.filter((c) => c.id === TIMELINE_DROP_ID);
      return canvas.length > 0 ? pointerWithin({ ...args, droppableContainers: canvas }) : [];
    }
    return [];
  }, []);

  // What a screen reader hears during a drag, for every surface on the page:
  // titles and the names of the rows and columns, never ids (TV-U4).
  const dragAnnouncements = useMemo(() => {
    const taskName = (id: string) => {
      const task = taskById.get(id);
      return task ? `“${task.title || "Untitled"}”` : null;
    };
    const targetName = (id: string): string | null => {
      if (id.startsWith(`${RAIL_DROP_PREFIX}bucket:`)) {
        return bucketNameById(id.slice(`${RAIL_DROP_PREFIX}bucket:`.length));
      }
      if (id === `${RAIL_DROP_PREFIX}queue`) return "Focus";
      if (id === `${RAIL_DROP_PREFIX}mine`) return "My tasks";
      if (id.startsWith("link:")) return "the open task, to link them";
      // A Board column or lane cell: the name the board registered (TV-U11).
      if (id.startsWith("col:")) return boardDropName(id);
      if (id === TIMELINE_DROP_ID) return "the timeline, to give it a due date";
      return taskName(id);
    };
    return taskDragAnnouncements({ taskName: (id) => taskName(id) ?? "the task", targetName });
  }, [taskById, bucketNameById]);
  const onHubDragEnd = useCallback(
    (event: DragEndEvent) => {
      const payload = asDragPayload(event.active.data.current);
      const target = asDropLinkTarget(event.over?.data.current);
      if (!payload || !target) return;
      if (!runtime || !canEdit) return;
      if (isSelfDrop(payload, target)) {
        toast("You can’t link a task to itself");
        return;
      }
      if (!targetAccepts(target, payload)) return;
      void (async () => {
        // Guard a pre-existing edge: a fresh Undo toast on an already-linked pair
        // would delete a link the user didn't make in THIS gesture (FX-9 parity).
        try {
          const links = await runtime.spine.listLinks({
            workspaceId,
            entityType: target.entityType,
            entityId: target.entityId,
          });
          const already = links.some(
            (l) =>
              (l.sourceType === payload.entityType && l.sourceId === payload.entityId) ||
              (l.targetType === payload.entityType && l.targetId === payload.entityId),
          );
          if (already) {
            toast("Already linked");
            return;
          }
        } catch {
          // a failed pre-check must not block a legitimate link
        }
        await createLinkWithToast({
          runtime,
          workspaceId,
          source: payload,
          target,
          origin: "drag",
          onChanged: () => window.dispatchEvent(new CustomEvent(TASK_DETAIL_REFRESH_EVENT)),
        });
      })();
    },
    [runtime, workspaceId, canEdit],
  );
  return (
    <DndContext
      sensors={pageSensors}
      collisionDetection={appCollision}
      accessibility={{ announcements: dragAnnouncements }}
      onDragEnd={(event) => {
        // Spatially disjoint: each acts only when `over` is its own target.
        onHubDragEnd(event);
        onRailDragEnd(event);
      }}
    >
      {children}
    </DndContext>
  );
}
