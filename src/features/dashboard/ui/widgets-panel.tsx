import React from "react";
import { useDraggable } from "@dnd-kit/core";
import { WidgetType } from "../types";

// Helper component for draggable item
function DraggableWidgetSource({ type, label, icon, isLocked }: { type: WidgetType; label: string; icon: string; isLocked: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `new-widget-${type}`,
    data: {
      type,
      isSource: true,
      label, // Add label to data for DragOverlay
    },
    disabled: isLocked,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      className={`p-3 rounded-lg mb-2 border transition-colors select-none flex items-center gap-2
        ${isLocked 
          ? "bg-[#111111] border-[#1e1e1e] cursor-not-allowed opacity-50" 
          : "bg-[#151515] border-[#262626] cursor-grab active:cursor-grabbing hover:bg-[#1a1a1a]"}`}
      style={style}
      {...listeners}
      {...attributes}
    >
      <div className="flex-1">
        <div className="text-[#e5ecff] font-medium text-[13px]">{label}</div>
        <div className="text-[#7f8ca7] text-[11px] mt-0.5">{icon}</div>
      </div>
    </div>
  );
}

interface WidgetsPanelProps {
  activeView?: { name: string };
  isLocked: boolean;
  onToggleLock: () => void;
}

export function WidgetsPanel({ activeView, isLocked, onToggleLock }: WidgetsPanelProps) {
  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="text-[#94a6cc] text-[11px] font-semibold uppercase tracking-wider truncate pr-2">
          {activeView?.name ?? "Widgets"}
        </div>
        <button
          onClick={onToggleLock}
          className={`p-1.5 rounded-md transition-colors ${isLocked ? 'text-[#7f8ca7] hover:bg-[#1f1f1f] hover:text-[#e5ecff]' : 'text-[#f08f42] bg-[#f08f42]/10 hover:bg-[#f08f42]/20'}`}
          title={isLocked ? "Unlock dashboard" : "Lock dashboard"}
        >
          {isLocked ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
            </svg>
          )}
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto pr-1">
        <DraggableWidgetSource type="notes" label="Note" icon="Attach a note" isLocked={isLocked} />
        <DraggableWidgetSource type="tasks" label="Tasks" icon="Project or filtered tasks" isLocked={isLocked} />
        <DraggableWidgetSource type="clock" label="Clock" icon="World clocks" isLocked={isLocked} />
        
        <div className="mt-8 px-1">
          <div className="text-[#5f6c87] text-[11px] leading-relaxed">
            {isLocked 
              ? "Dashboard is locked. Unlock to add or rearrange widgets."
              : "Drag widgets onto the dashboard to customize your view."}
          </div>
        </div>
      </div>
    </div>
  );
}
