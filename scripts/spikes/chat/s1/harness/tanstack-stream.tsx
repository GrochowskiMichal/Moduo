"use no memo";
// TanStack Virtual keeps its state on one mutable object; the React Compiler
// would cache what this component reads from it as if it never changed, so
// this file (and only this file) opts out. The rows it draws stay compiled.

// CV-0 spike 1: the TanStack Virtual candidate for `MessageStream`.
// anchorTo "end" + followOnAppend, id keys, sticky day separators through the
// rangeExtractor, per-kind size estimates.

import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { flushSync } from "react-dom";
import { type Density, estimateRow, type StreamApi, type StreamProps } from "./model";
import { RowView } from "./rows";

export function TanstackStream({ rows, density, config, initial, onApi }: StreamProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const densityRef = useRef<Density>(density);
  densityRef.current = density;
  const activeSticky = useRef(-1);

  const stickyIndexes: number[] = [];
  for (let i = 0; i < rows.length; i++) if (rows[i]?.type === "day") stickyIndexes.push(i);

  const rangeExtractor = (range: Range) => {
    const shown = defaultRangeExtractor(range);
    let active = -1;
    // Binary search: the last separator at or above the first visible row.
    let lo = 0;
    let hi = stickyIndexes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((stickyIndexes[mid] as number) <= range.startIndex) {
        active = stickyIndexes[mid] as number;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    activeSticky.current = active;
    if (active >= 0 && !shown.includes(active)) {
      shown.unshift(active);
    }
    return shown;
  };

  // Stable per rows: the virtualizer's measurement memo is keyed on them, and
  // a new function every render re-walks every row on every scroll frame.
  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      return row ? estimateRow(row, densityRef.current) : 40;
    },
    [rows],
  );
  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    rangeExtractor,
    overscan: config.overscan,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    useFlushSync: config.useFlushSync,
    directDomUpdates: config.directDom,
  });

  if (config.adjust === "above") {
    // Compensate every size change entirely above the viewport, whatever the
    // scroll direction (TanStack skips them while scrolling backward).
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, v) =>
      item.start + item.size <= (v.scrollOffset ?? 0) + v.scrollAdjustments;
  } else {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
  }

  // The scroller is this component's own child: attached before layout effects.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (initial.kind === "end") virtualizer.scrollToEnd();
    else {
      const index = rows.findIndex((r) => r.key === initial.key);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
    }
  });

  useEffect(() => {
    const api: StreamApi = {
      lib: "tanstack",
      scroller: () => scrollRef.current,
      scrollToKey: (key, align) => {
        const index = virtualizer.options.getItemKey
          ? findIndex(virtualizer.options.count, virtualizer.options.getItemKey, key)
          : -1;
        if (index >= 0) virtualizer.scrollToIndex(index, { align });
      },
      scrollToEnd: () => virtualizer.scrollToEnd(),
      seedSizes: (sizes) => {
        for (const [key, size] of sizes) virtualizer.itemSizeCache.set(key, size);
      },
      debug: () => ({
        scrollOffset: virtualizer.scrollOffset,
        totalSize: virtualizer.getTotalSize(),
        direction: virtualizer.scrollDirection,
        cached: virtualizer.itemSizeCache.size,
      }),
      setDensityAnchored: (next) => {
        const el = scrollRef.current;
        if (!el) return;
        // 1. The anchor: the first message row wholly in view (the reader's).
        const top = el.getBoundingClientRect().top;
        const height = el.clientHeight;
        let anchorKey: string | null = null;
        let anchorTop = 0;
        for (const node of el.querySelectorAll<HTMLElement>("[data-key]")) {
          const key = node.dataset.key ?? "";
          if (node.dataset.sticky !== undefined || key.startsWith("d:")) continue;
          const r = node.getBoundingClientRect();
          const t = r.top - top;
          if (t >= 0 && r.bottom - top <= height && (anchorKey === null || t < anchorTop)) {
            anchorKey = key;
            anchorTop = t;
          }
        }
        // 2. Switch, forget every size (rows off screen keep the old density's
        //    sizes otherwise), re-measure what is drawn, all in this task.
        el.dataset.density = next;
        densityRef.current = next;
        virtualizer.measure();
        virtualizer.getTotalSize();
        for (const node of el.querySelectorAll<HTMLDivElement>("[data-index]")) {
          virtualizer.measureElement(node);
        }
        virtualizer.getTotalSize();
        // 3. Put the anchor back where it was, before the frame paints.
        if (anchorKey !== null) {
          const index = findIndex(
            virtualizer.options.count,
            virtualizer.options.getItemKey,
            anchorKey,
          );
          const item = virtualizer.measurementsCache[index];
          if (item) {
            const target = Math.max(0, item.start - anchorTop);
            el.scrollTop = target;
            virtualizer.scrollOffset = target;
            virtualizer.scrollAdjustments = 0;
          }
        }
        flushSync(rerender);
      },
    };
    onApi(api);
    return () => onApi(null);
  }, [onApi, virtualizer]);

  const items = virtualizer.getVirtualItems();
  return (
    <div
      ref={scrollRef}
      className="s1-scroller"
      data-density={density}
      data-anchor={config.overflowAnchor}
      data-contain={config.contain ? "" : undefined}
      data-imgbox={config.imageBox}
    >
      <div
        ref={config.directDom ? virtualizer.containerRef : undefined}
        className="s1-total"
        style={config.directDom ? undefined : { height: virtualizer.getTotalSize() }}
      >
        {items.map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          const sticky = v.index === activeSticky.current;
          return (
            <div
              key={v.key}
              data-key={row.key}
              data-index={v.index}
              data-sticky={sticky ? "" : undefined}
              ref={virtualizer.measureElement}
              className={sticky ? "s1-item s1-sticky" : "s1-item"}
              style={
                sticky || config.directDom ? undefined : { transform: `translateY(${v.start}px)` }
              }
            >
              <RowView row={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function findIndex(count: number, getKey: (i: number) => unknown, key: string): number {
  for (let i = count - 1; i >= 0; i--) if (getKey(i) === key) return i;
  return -1;
}
