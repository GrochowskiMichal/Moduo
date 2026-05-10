import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { WidgetInstance } from "../types";
import { WidgetShellEditProvider } from "./widgets/widget-shell";

type Props = {
  widget: WidgetInstance;
  gridSize: number;
  isLocked: boolean;
  onResize: (id: string, w: number, h: number) => void;
  onRemove: (id: string) => void;
  children: ReactNode;
};

export function WidgetContainer({ widget, gridSize, isLocked, onResize, onRemove, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: widget.id,
    data: { isWidget: true, widget },
    disabled: isLocked,
  });
  const [resizing, setResizing] = useState(false);

  const handleResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isLocked) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startW = widget.w;
    const startH = widget.h;

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const nextW = Math.max(2, startW + Math.round((moveEvent.clientX - startX) / gridSize));
      const nextH = Math.max(2, startH + Math.round((moveEvent.clientY - startY) / gridSize));
      onResize(widget.id, nextW, nextH);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setResizing(false);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    setResizing(true);
  };

  const style: CSSProperties = {
    position: "absolute",
    left: widget.x * gridSize,
    top: widget.y * gridSize,
    width: widget.w * gridSize - 8,
    height: widget.h * gridSize - 8,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.82 : 1,
    zIndex: isDragging || resizing ? 30 : 2,
    willChange: "transform, left, top",
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative overflow-hidden rounded-2xl border border-[#242424] bg-[#111111]">
      <div className="relative h-full min-h-0 overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
        <WidgetShellEditProvider
          value={{
            isLocked,
            onRemove: () => onRemove(widget.id),
            dragAttributes: attributes as unknown as Record<string, unknown>,
            dragListeners: listeners as Record<string, unknown>,
          }}
        >
          {children}
        </WidgetShellEditProvider>
      </div>
      {!isLocked ? (
        <div
          className="absolute bottom-0 right-0 z-20 h-6 w-6 cursor-se-resize opacity-0 transition-opacity group-hover:opacity-100"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute bottom-[5px] right-[5px] h-2 w-2 border-b-2 border-r-2 border-[#535353]" />
        </div>
      ) : null}
    </div>
  );
}
