import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime";
import type { NoteMeta } from "../../notes/types";
import type { Task, TaskProject, TaskWorkflowState } from "../../tasks/types";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { useDashboard } from "../hooks/use-dashboard";
import type { WidgetType } from "../types";
import { DashboardGrid } from "./dashboard-grid";
import {
  DASHBOARD_VIEW_CHANGE_EVENT,
  readStoredDashboardActiveView,
  type DashboardViewChangeDetail,
} from "./layout-events";
import { WidgetsPanel } from "./widgets-panel";

const GRID_SIZE = 40;

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  notes: NoteMeta[];
  tasks: Task[];
  projects: TaskProject[];
  states: TaskWorkflowState[];
};

export function DashboardWorkspace({ runtime, workspaceId, notes, tasks, projects, states }: Props) {
  const [activeViewId, setActiveViewId] = useState<string | null>(() => readStoredDashboardActiveView(workspaceId));
  const { widgets, isLocked, isLoading, toggleLock, addWidget, moveWidget, resizeWidget, removeWidget, updateWidgetConfig } =
    useDashboard(workspaceId, activeViewId, runtime);
  const [activeDragData, setActiveDragData] = useState<any>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveViewId(readStoredDashboardActiveView(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onViewChange = (event: Event) => {
      const detail = (event as CustomEvent<DashboardViewChangeDetail>).detail;
      if (detail?.viewId) setActiveViewId(detail.viewId);
    };
    window.addEventListener(DASHBOARD_VIEW_CHANGE_EVENT, onViewChange);
    return () => window.removeEventListener(DASHBOARD_VIEW_CHANGE_EVENT, onViewChange);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const onDragStart = (event: DragStartEvent) => {
    if (isLocked) return;
    setActiveDragData(event.active.data.current);
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (isLocked) return;
    const dragData = event.active.data.current;
    setActiveDragData(null);
    if (!event.over || !dragData) return;

    if (dragData.isSource) {
      const type = dragData.type as WidgetType;
      const finalRect = event.active.rect.current.translated;
      const gridRect = gridRef.current?.getBoundingClientRect();
      let x = 0;
      let y = 0;
      if (finalRect && gridRect) {
        x = Math.round((finalRect.left - gridRect.left) / GRID_SIZE);
        y = Math.round((finalRect.top - gridRect.top) / GRID_SIZE);
      }
      addWidget(type, x, y);
      return;
    }

    if (dragData.isWidget) {
      const widget = widgets.find((entry) => entry.id === event.active.id);
      if (!widget) return;
      const nextX = Math.max(0, widget.x + Math.round(event.delta.x / GRID_SIZE));
      const nextY = Math.max(0, widget.y + Math.round(event.delta.y / GRID_SIZE));
      moveWidget(widget.id, nextX, nextY);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <FeaturePanelsShell
        feature="dashboard"
        left={<WidgetsPanel isLocked={isLocked} onToggleLock={toggleLock} />}
        center={
          <div ref={gridRef} className="h-full w-full">
            <DashboardGrid
              widgets={widgets}
              gridSize={GRID_SIZE}
              isLocked={isLocked}
              runtime={runtime}
              workspaceId={workspaceId}
              notes={notes}
              tasks={tasks}
              projects={projects}
              states={states}
              onResize={resizeWidget}
              onRemove={removeWidget}
              onUpdateConfig={updateWidgetConfig}
            />
          </div>
        }
      />

      {typeof document !== "undefined"
        ? createPortal(
            <DragOverlay dropAnimation={null}>
              {activeDragData?.isSource ? (
                <div className="rounded-xl border border-[#2a2a2a] bg-[#121212] px-3 py-2 text-[13px] text-[#e8e8e8]">
                  {activeDragData.label}
                </div>
              ) : null}
            </DragOverlay>,
            document.body
          )
        : null}
    </DndContext>
  );
}
