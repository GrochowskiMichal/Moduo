// The Timeline's scroller: its size, the range of days the canvas spans (it
// grows both ways as you scroll), the window of days drawn, where the next
// render puts the scroll, and the zoom (⌘-scroll keeps the day under the
// pointer where it was).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { TasksDisplay } from "../display";
import {
  DAY_WIDTH,
  drawWindow,
  extendRange,
  initialRange,
  scrollLeftFor,
  stepZoom,
  type TimelineRange,
  type TimelineZoom,
  visibleDays,
  zoomAnchor,
} from "../timeline-scale";
import { createViewportStore } from "./timeline-marks";

/**
 * Where the next render puts the scroll: today, a kept day, or an added
 * start. An ask made with a new range waits for that range to be drawn (a
 * scope switch can change the zoom in the same render as it asks).
 */
export type PendingScroll =
  | { kind: "today"; range: TimelineRange }
  | { kind: "day"; day: number; at: number }
  | { kind: "shift"; days: number; range: TimelineRange }
  | null;

type Input = {
  today: number;
  /** The days the rows' marks cover: the first range is drawn around them. */
  extent: Parameters<typeof initialRange>[1];
  /** A new scope (or the first load) opens with today a quarter across. */
  scopeKey: string;
  loaded: boolean;
  zoom: TimelineZoom;
  nameW: number;
  display: TasksDisplay;
  onDisplayChange: (next: TasksDisplay) => void;
};

export function useTimelineViewport({
  today,
  extent,
  scopeKey,
  loaded,
  zoom,
  nameW,
  display,
  onDisplayChange,
}: Input) {
  const dw = DAY_WIDTH[zoom];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, header: 0 });
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () =>
      setSize((prev) => {
        const next = {
          width: el.clientWidth,
          height: el.clientHeight,
          header: headerRef.current?.offsetHeight ?? 0,
        };
        return prev.width === next.width &&
          prev.height === next.height &&
          prev.header === next.header
          ? prev
          : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (headerRef.current) observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);
  const trackWidth = Math.max(0, size.width - nameW);

  const [range, setRange] = useState<TimelineRange>(() => initialRange(today, extent));
  const [drawn, setDrawn] = useState(() => drawWindow({ from: today - 60, to: today + 60 }));
  // The days on screen now (whole days), for the off-screen hints only: a
  // store they subscribe to, so scrolling never redraws the view.
  const [viewport] = useState(() => createViewportStore({ from: today - 30, to: today + 30 }));
  const canvasW = range.days * dw;

  // The live values the scroll and wheel handlers read.
  const live = useRef({ range, dw, trackWidth, zoom, nameW });
  useLayoutEffect(() => {
    live.current = { range, dw, trackWidth, zoom, nameW };
  });
  const pending = useRef<PendingScroll>(null);

  const syncWindow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { range: r, dw: w, trackWidth: tw } = live.current;
    if (tw <= 0) return;
    // A new range is on its way: read nothing against the old one.
    const ask = pending.current;
    if (ask && ask.kind !== "day" && ask.range !== r) return;
    const shown = visibleDays(r, w, el.scrollLeft, tw);
    const grown = extendRange(r, shown, Math.ceil(tw / w) + 30);
    if (grown) {
      if (grown.shift > 0) {
        pending.current = { kind: "shift", days: grown.shift, range: grown.range };
      }
      setRange(grown.range);
    }
    const next = drawWindow(shown);
    setDrawn((prev) => (prev.from === next.from && prev.to === next.to ? prev : next));
    viewport.set(shown);
  }, [viewport]);

  // Open (a new scope, or once the tasks are in) with today a quarter across.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scope or the first load is the cue
  useLayoutEffect(() => {
    const next = initialRange(today, extent);
    pending.current = { kind: "today", range: next };
    setRange(next);
  }, [scopeKey, loaded]);

  // Apply what was asked once the range, zoom and size are drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each geometry change
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const ask = pending.current;
    if (!el || !ask || trackWidth <= 0) return;
    // Asked with a range that isn't drawn yet: wait for it.
    if (ask.kind !== "day" && ask.range !== range) return;
    pending.current = null;
    if (ask.kind === "today") el.scrollLeft = scrollLeftFor(range, dw, today, trackWidth);
    else if (ask.kind === "day") el.scrollLeft = Math.max(0, (ask.day - range.start) * dw - ask.at);
    else el.scrollLeft += ask.days * dw;
    syncWindow();
  }, [range, dw, trackWidth]);

  const onScroll = useRef(0);
  const handleScroll = useCallback(() => {
    if (onScroll.current) return;
    onScroll.current = requestAnimationFrame(() => {
      onScroll.current = 0;
      syncWindow();
    });
  }, [syncWindow]);
  useEffect(() => () => cancelAnimationFrame(onScroll.current), []);

  const scrollToToday = useCallback(
    (smooth: boolean) => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTo({
        left: scrollLeftFor(range, dw, today, trackWidth),
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [range, dw, today, trackWidth],
  );

  // Zoom keeps the day under the pointer where it was; from the control or
  // the keys, Today when it's on screen (else the middle).
  const changeZoom = useCallback(
    (next: TimelineZoom, clientX?: number) => {
      const el = scrollerRef.current;
      const { range: r, dw: w, trackWidth: tw, nameW: nw, zoom: z } = live.current;
      if (next === z) return;
      if (el) {
        const left = el.getBoundingClientRect().left + nw;
        const pointer = clientX === undefined ? undefined : clientX - left;
        const anchor = zoomAnchor(r, w, el.scrollLeft, tw, today, pointer);
        pending.current = { kind: "day", ...anchor };
      }
      onDisplayChange({ ...display, timelineZoom: next });
    },
    [display, onDisplayChange, today],
  );
  const changeZoomRef = useRef(changeZoom);
  useLayoutEffect(() => {
    changeZoomRef.current = changeZoom;
  });

  // ⌘-scroll (or a pinch) zooms (69). React's wheel listener is passive, so
  // the page's own zoom is stopped here.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let travel = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      travel += e.deltaY;
      if (Math.abs(travel) < 40) return;
      const out = travel > 0;
      travel = 0;
      changeZoomRef.current(stepZoom(live.current.zoom, out ? 1 : -1), e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Scroll sideways to a day (a hint's click), a quarter of the way across. */
  const scrollToDay = useCallback((day: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const { range: r, dw: w, trackWidth: tw } = live.current;
    el.scrollTo({ left: scrollLeftFor(r, w, day, tw), behavior: "smooth" });
  }, []);

  return {
    dw,
    scrollerRef,
    headerRef,
    size,
    trackWidth,
    range,
    drawn,
    viewport,
    canvasW,
    pending,
    handleScroll,
    scrollToToday,
    changeZoom,
    scrollToDay,
  };
}
