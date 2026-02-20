import React, { useState, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { createPortal } from "react-dom";
import { WidgetInstance, WidgetType, WidgetConfig } from "../types";
import { WidgetsPanel } from "./widgets-panel";
import { DashboardGrid } from "./dashboard-grid";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { useDashboardContext } from "../../dashboard/providers/dashboard-provider";

const GRID_SIZE = 40;

export function DashboardWorkspace() {
  const { 
    activeViewId, 
    widgets: widgetsByView, 
    views,
    updateView,
    addWidget,
    updateWidget,
    deleteWidget
  } = useDashboardContext();

  const currentWidgets = activeViewId ? (widgetsByView[activeViewId] || []) : [];
  const activeView = views.find(v => v.id === activeViewId);
  const isLocked = activeView?.isLocked ?? true;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragData, setActiveDragData] = useState<any>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const onDragStart = (event: DragStartEvent) => {
    if (isLocked) return;
    setActiveId(String(event.active.id));
    setActiveDragData(event.active.data.current);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    if (isLocked || !activeViewId) return;
    const { active, over } = event;
    const dragData = active.data.current;

    setActiveId(null);
    setActiveDragData(null);

    if (!over) return;

    // Handle new widget drop
    if (dragData?.isSource) {
      const type = dragData.type as WidgetType;
      
      const finalRect = active.rect.current.translated;
      const gridRect = gridRef.current?.getBoundingClientRect();

      let x = 0;
      let y = 0;

      if (finalRect && gridRect) {
        x = Math.round((finalRect.left - gridRect.left) / GRID_SIZE);
        y = Math.round((finalRect.top - gridRect.top) / GRID_SIZE);
      }
      
      await addWidget(activeViewId, type, Math.max(0, x), Math.max(0, y));
    }
    
    // Handle existing widget move
    if (dragData?.isWidget) {
       const widgetId = active.id as string;
       const widget = currentWidgets.find(w => w.id === widgetId);
       if (!widget) return;
       
       const deltaX = Math.round(event.delta.x / GRID_SIZE);
       const deltaY = Math.round(event.delta.y / GRID_SIZE);
       
       const newX = Math.max(0, widget.x + deltaX);
       const newY = Math.max(0, widget.y + deltaY);

       if (newX !== widget.x || newY !== widget.y) {
         await updateWidget(widgetId, { x: newX, y: newY });
       }
    }
  };

  const handleUpdateConfig = useCallback(async (id: string, config: Partial<WidgetConfig>) => {
    // Merge with existing config
    const widget = currentWidgets.find(w => w.id === id);
    if (!widget) return;
    await updateWidget(id, { config: { ...widget.config, ...config } });
  }, [currentWidgets, updateWidget]);

  const handleRemoveWidget = useCallback(async (id: string) => {
    if (isLocked) return;
    await deleteWidget(id);
  }, [isLocked, deleteWidget]);

  const handleResize = useCallback(async (id: string, w: number, h: number) => {
    if (isLocked) return;
    await updateWidget(id, { w: Math.max(2, w), h: Math.max(2, h) });
  }, [isLocked, updateWidget]);

  const handleToggleLock = useCallback(async () => {
    if (!activeViewId) return;
    await updateView(activeViewId, { isLocked: !isLocked });
  }, [activeViewId, isLocked, updateView]);

  if (!activeViewId && views.length > 0) {
    // If we have views but none active, loading or sync issue.
    // Ideally useDashboard handles this, but we can render loading.
    return <div className="flex-1 bg-[#0C0C0C]" />;
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <FeaturePanelsShell
        feature="dashboard"
        left={<WidgetsPanel activeView={activeView} isLocked={isLocked} onToggleLock={handleToggleLock} />}
        center={
          <div className="h-full w-full relative" ref={gridRef}>
            <DashboardGrid 
              widgets={currentWidgets} 
              gridSize={GRID_SIZE} 
              onUpdateConfig={handleUpdateConfig}
              onRemove={handleRemoveWidget}
              onResize={handleResize}
              isLocked={isLocked}
            />
          </div>
        }
      />

      {/* Drag Overlay */}
      {typeof document !== "undefined" && createPortal(
        <DragOverlay>
          {activeId && activeDragData?.isSource ? (
            <div className="bg-[#111111] p-3 rounded-lg border border-[#2a2a2a] shadow-xl w-[200px] opacity-80 cursor-grabbing">
               <div className="font-medium text-[#e5ecff]">{activeDragData.label || activeDragData.type}</div>
            </div>
          ) : activeId && activeDragData?.isWidget ? (
            <div 
              className="bg-[#111111] rounded-xl border border-[#333333] shadow-2xl opacity-90 flex items-center justify-center"
              style={{
                width: activeDragData.widget.w * GRID_SIZE,
                height: activeDragData.widget.h * GRID_SIZE,
              }}
            >
               <div className="text-[#94a6cc] font-medium text-xs">Moving {activeDragData.widget.type}...</div>
            </div>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  );
}
