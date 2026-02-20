import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { WidgetConfig, WidgetInstance } from "../types";
import { WidgetContainer } from "./widget-container";
import { NotesWidget } from "./widgets/notes-widget";
import { TasksWidget } from "./widgets/tasks-widget";
import { ClockWidget } from "./widgets/clock-widget";

interface DashboardGridProps {
  widgets: WidgetInstance[];
  gridSize: number;
  onResize?: (id: string, w: number, h: number) => void;
  onRemove?: (id: string) => void;
  onUpdateConfig?: (id: string, config: Partial<WidgetConfig>) => void;
  isLocked: boolean;
}

export function DashboardGrid({ widgets, gridSize, onResize, onRemove, onUpdateConfig, isLocked }: DashboardGridProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: "dashboard-grid",
    disabled: isLocked,
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative w-full h-full bg-transparent transition-colors ${
        isOver && !isLocked ? "bg-[#111111]/50" : ""
      }`}
      style={{
        backgroundImage: !isLocked ? `radial-gradient(#2a2a2a 1px, transparent 1px)` : 'none',
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }}
    >
      {widgets.map((widget) => (
        <WidgetContainer 
          key={widget.id} 
          widget={widget} 
          gridSize={gridSize} 
          onResize={onResize}
          isLocked={isLocked}
        >
          {widget.type === "notes" && (
            <NotesWidget 
              config={widget.config} 
              onUpdateConfig={(config) => onUpdateConfig?.(widget.id, config)}
              isLocked={isLocked}
            />
          )}
          {widget.type === "tasks" && (
            <TasksWidget 
              config={widget.config}
              onUpdateConfig={(config) => onUpdateConfig?.(widget.id, config)}
              isLocked={isLocked}
            />
          )}
          {widget.type === "clock" && (
            <ClockWidget 
              config={widget.config}
              onUpdateConfig={(config) => onUpdateConfig?.(widget.id, config)}
              isLocked={isLocked}
            />
          )}
        </WidgetContainer>
      ))}
      {widgets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[#2a3041] pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-2">👋</div>
            <div className="text-sm font-medium">Your board is empty</div>
            <div className="text-xs mt-1 text-[#5f6c87]">
              {isLocked ? "Unlock the dashboard to add widgets." : "Drag widgets from the left panel"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
