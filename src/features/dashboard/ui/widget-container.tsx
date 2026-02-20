import React, { useState, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { WidgetInstance } from "../types";

interface WidgetContainerProps {
  widget: WidgetInstance;
  gridSize: number; // pixel size of one grid unit
  onResize?: (id: string, w: number, h: number) => void;
  children: React.ReactNode;
  isLocked: boolean;
}

export function WidgetContainer({ widget, gridSize, onResize, children, isLocked }: WidgetContainerProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: widget.id,
    data: {
      type: widget.type,
      isWidget: true,
      widget,
    },
    disabled: isLocked,
  });

  const [isResizing, setIsResizing] = useState(false);

  // Resize logic
  useEffect(() => {
    if (!isResizing) return;
  }, [isResizing]);

  const handleResizeStart = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.stopPropagation(); // Prevent drag
    e.preventDefault();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = widget.w;
    const startH = widget.h;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const newW = Math.max(2, startW + Math.round(deltaX / gridSize));
      const newH = Math.max(2, startH + Math.round(deltaY / gridSize));
      
      if (newW !== widget.w || newH !== widget.h) {
         onResize?.(widget.id, newW, newH);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    setIsResizing(true);
  };

  const style: React.CSSProperties = {
    position: "absolute",
    left: widget.x * gridSize,
    top: widget.y * gridSize,
    width: widget.w * gridSize - 8, // gap
    height: widget.h * gridSize - 8, // gap
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging || isResizing ? 100 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-[#111111] rounded-xl border shadow-sm flex flex-col overflow-hidden group transition-all
        ${isResizing ? 'shadow-xl border-[#3a3a3a] z-50' : 'border-[#1e1e1e] hover:border-[#2a2a2a]'}
        ${isDragging ? 'shadow-xl border-[#3a3a3a] z-50' : ''}
      `}
    >
      {/* Drag Handle - Only visible if not locked */}
      {!isLocked && (
        <div
          {...listeners}
          {...attributes}
          className="h-6 bg-[#151515] w-full cursor-grab active:cursor-grabbing flex items-center justify-between px-2 opacity-0 group-hover:opacity-100 transition-opacity select-none border-b border-[#222]"
        >
          <span className="text-[10px] text-[#666] uppercase font-bold tracking-wider">{widget.type}</span>
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#333]" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#333]" />
          </div>
        </div>
      )}

      {/* Widget Content */}
      <div className="flex-1 overflow-hidden relative">
        {children}
        
        {/* Resize Overlay when resizing to prevent interaction with content */}
        {isResizing && <div className="absolute inset-0 z-50 bg-transparent" />}
      </div>

      {/* Resize Handle - Only visible if not locked */}
      {!isLocked && (
        <div
          className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1 z-50 opacity-0 group-hover:opacity-100 transition-opacity"
          onMouseDown={handleResizeStart}
        >
           <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
             <path d="M8 8H0L8 0V8Z" fill="#444"/>
           </svg>
        </div>
      )}
    </div>
  );
}
