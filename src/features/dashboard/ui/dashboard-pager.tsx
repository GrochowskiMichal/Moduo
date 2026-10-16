import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { DashboardLayout, WidgetSize } from "../engine/types";
import type { DragRender } from "../hooks/use-grid-drag";
import { GridCanvas } from "./grid-canvas";

/** Accumulated horizontal wheel travel (px) that trips a page turn. */
const WHEEL_THRESHOLD = 60;
/** Ignore further wheel this long after a turn, so trackpad momentum can't skip pages (assumption 11). */
const WHEEL_LOCKOUT_MS = 350;
/** Computed `overflow-x` values that let a box scroll sideways under a wheel. */
const SCROLLS_X = new Set(["auto", "scroll", "overlay"]);
/** What can take focus inside a page (its widgets' controls). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DashboardPagerProps {
  layout: DashboardLayout;
  activeIndex: number;
  editing: boolean;
  drag: DragRender | null;
  gridRef: React.Ref<HTMLDivElement>;
  onWidgetPointerDown: (id: string, event: React.PointerEvent) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetSize) => void;
  /** A sideways swipe over the grid (anything but a sideways scroller) asked to turn the page. */
  onPage: (dir: -1 | 1) => void;
}

/**
 * Whether the wheel's target sits in a box that scrolls sideways (MOD-163): a
 * computed `overflow-x` of auto / scroll and content wider than the box, between
 * the target and the pager's viewport. Such a box takes the swipe whether or
 * not it is at its end, so its overflow never turns the page.
 */
function scrollsSideways(target: Node, boundary: Element): boolean {
  for (
    let el: Element | null = target instanceof Element ? target : target.parentElement;
    el && el !== boundary;
    el = el.parentElement
  ) {
    if (el.scrollWidth > el.clientWidth && SCROLLS_X.has(getComputedStyle(el).overflowX)) {
      return true;
    }
  }
  return false;
}

/**
 * The horizontal pager (AC5): every page is a full-bleed layer offset by
 * `(index − active)·100%` via an inline transform, slid by a CSS transition timed
 * to `--motion-base` (0s under reduced motion → instant, AC12). The transform is
 * the *inline style* target, so — unlike a JS/rAF tween — the layer can never
 * freeze mid-slide; the transition is purely cosmetic. Only the ACTIVE page is
 * interactive + edit-wired: the others are `inert`, so Tab never walks into a
 * page off screen (MOD-161: focusing one scrolled the viewport sideways and
 * left two half pages under the first page's dot). The viewport clips rather
 * than hides, so it is no scroll container and nothing can shift it. Paging
 * with ←/→ while a widget has focus hands focus to the new page's first control
 * (else it would fall out of the now inert page to the body). A sideways swipe
 * pages over the gaps and over any widget (MOD-163) — deltaX-dominant, threshold
 * + lockout — except over a box that scrolls sideways itself: that box keeps the
 * whole swipe, and what runs past its end is swallowed, never turned into a page
 * (one gesture never does two things). A mostly vertical wheel never pages, so a
 * widget's own vertical list scrolls as before.
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(activeIndex);

  // Runs after the commit that made the old page inert, before the browser
  // moves focus out of it. `preventScroll`: the new page is still sliding in.
  useLayoutEffect(() => {
    const from = shownRef.current;
    shownRef.current = activeIndex;
    if (from === activeIndex) return;
    const layers = viewportRef.current?.children;
    const outgoing = layers?.[from];
    const incoming = layers?.[activeIndex];
    const focused = document.activeElement;
    if (!outgoing || !incoming || !focused || !outgoing.contains(focused)) return;
    incoming.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, [activeIndex]);

  const handleWheel = (e: React.WheelEvent) => {
    const viewport = viewportRef.current;
    // A wheel over a widget's portalled popover bubbles here through React;
    // only one over the pages themselves may turn them.
    if (!viewport || !(e.target instanceof Node) || !viewport.contains(e.target)) return;
    // Vertical-dominant wheel is left alone (a widget's list scrolls; the grid
    // never does); only a horizontal-dominant swipe pages.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
      accum.current = 0;
      return;
    }
    // A widget that scrolls sideways keeps the swipe, to its end and past it.
    if (scrollsSideways(e.target, viewport)) {
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
    <div
      ref={viewportRef}
      className="relative min-h-0 w-full flex-1 overflow-clip"
      onWheel={handleWheel}
    >
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
            inert={!isActive}
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
