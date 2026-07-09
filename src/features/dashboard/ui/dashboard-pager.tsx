import { useRef } from "react";

import { cn } from "@/lib/utils";

import type { DashboardLayout, WidgetSize } from "../engine/types";
import type { DragRender } from "../hooks/use-grid-drag";
import { GridCanvas } from "./grid-canvas";

/** Accumulated horizontal wheel travel (px) that trips a page turn. */
const WHEEL_THRESHOLD = 60;
/** Ignore further wheel this long after a turn, so trackpad momentum can't skip pages (assumption 11). */
const WHEEL_LOCKOUT_MS = 350;

export interface DashboardPagerProps {
  layout: DashboardLayout;
  activeIndex: number;
  editing: boolean;
  drag: DragRender | null;
  gridRef: React.Ref<HTMLDivElement>;
  onWidgetPointerDown: (id: string, event: React.PointerEvent) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetSize) => void;
  /** A horizontal trackpad swipe over the grid background asked to turn the page. */
  onPage: (dir: -1 | 1) => void;
}

/**
 * The horizontal pager (AC5): every page is a full-bleed layer offset by
 * `(index − active)·100%` via an inline transform, slid by a CSS transition timed
 * to `--motion-base` (0s under reduced motion → instant, AC12). The transform is
 * the *inline style* target, so — unlike a JS/rAF tween — the layer can never
 * freeze mid-slide; the transition is purely cosmetic. Only the ACTIVE page is
 * interactive + edit-wired (others are `pointer-events-none` + aria-hidden). A
 * widget's own wheel is swallowed in GridCanvas, so this viewport's handler only
 * sees grid-background travel — deltaX-dominant, threshold + lockout — and pages.
 */
export function DashboardPager({
  layout,
  activeIndex,
  editing,
  drag,
  gridRef,
  onWidgetPointerDown,
  onRemove,
  onResize,
  onPage,
}: DashboardPagerProps) {
  const accum = useRef(0);
  const lockedUntil = useRef(0);

  const handleWheel = (e: React.WheelEvent) => {
    // Vertical-dominant wheel is left alone (the grid never scrolls); only a
    // horizontal-dominant swipe pages.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
      accum.current = 0;
      return;
    }
    const now = performance.now();
    if (now < lockedUntil.current) return;
    accum.current += e.deltaX;
    if (Math.abs(accum.current) >= WHEEL_THRESHOLD) {
      onPage(accum.current > 0 ? 1 : -1);
      accum.current = 0;
      lockedUntil.current = now + WHEEL_LOCKOUT_MS;
    }
  };

  return (
    <div className="relative min-h-0 w-full flex-1 overflow-hidden" onWheel={handleWheel}>
      {layout.pages.map((page, i) => {
        const isActive = i === activeIndex;
        return (
          <div
            key={page.id}
            className={cn(
              "absolute inset-0 transition-transform duration-(--motion-base) ease-(--ease-out)",
              !isActive && "pointer-events-none",
            )}
            style={{ transform: `translateX(${(i - activeIndex) * 100}%)` }}
            aria-hidden={!isActive}
          >
            <GridCanvas
              widgets={page.widgets}
              editing={isActive && editing}
              drag={isActive ? drag : null}
              gridRef={isActive ? gridRef : undefined}
              onWidgetPointerDown={isActive ? onWidgetPointerDown : undefined}
              onRemove={isActive ? onRemove : undefined}
              onResize={isActive ? onResize : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
