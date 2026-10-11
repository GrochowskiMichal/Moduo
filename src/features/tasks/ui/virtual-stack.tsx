"use no memo";
// TanStack Virtual keeps its state on one mutable object; the React Compiler
// would cache what it reads from that object as if it never changed (a known
// clash with interior mutability), so this file opts out of the compiler.

// A vertical stack that draws only what's on screen (Tasks v3 TV-D11b, spec
// §Assumptions #8, AC12.4): the List's rows and each Board column's cards.
//
// - Short stacks (under `virtualizeFrom` items) draw every item in plain flow:
//   nothing to measure, find-in-page works, tests without layout see them all.
// - Long ones draw the visible items (plus `overscan`), each measured once
//   drawn, absolutely placed in a box as tall as the whole stack.
// - `stickyIndexes`: section headers. The one whose section is at the top of
//   the scroller stays drawn and sticks there while its section scrolls under
//   it (TanStack's sticky pattern: the active header is the only item in flow,
//   `position: sticky`); the next header takes over when it reaches the top.
// - `pinned`: items that must stay drawn wherever they are (the row being
//   dragged: dnd-kit loses a draggable that unmounts mid-drag).
// - `scrollTo`: bring an item into view (keyboard moves, a deep link), drawn
//   or not; `seq` asks again for the same item.

import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, type RefObject, useCallback, useEffect, useReducer, useRef } from "react";
import { cn } from "../../../lib/utils";

/** Below this many items a stack draws them all (they fit a screen or two). */
export const VIRTUALIZE_FROM = 120;

type Props<T> = {
  items: readonly T[];
  /** A stable key per item (a task id, a group key). */
  itemKey: (item: T, index: number) => string;
  /** A first guess at an item's height in px (corrected once it's drawn). */
  estimateSize: (item: T, index: number) => number;
  /** The scrolling element the stack lives in. */
  scrollRef: RefObject<HTMLElement | null>;
  render: (item: T, index: number, place: { sticky: boolean }) => ReactNode;
  stickyIndexes?: readonly number[];
  /** Classes for the item that is stuck at the top (its surface, its layer). */
  stickyClassName?: string;
  pinned?: readonly number[];
  /** Bring the item with this key into view (`seq` asks again for the same key). */
  scrollTo?: { key: string; seq: number; align?: "auto" | "center" } | null;
  /** Space between items in px (the virtual layout's `gap`; flow uses `gapClassName`). */
  gap?: number;
  gapClassName?: string;
  overscan?: number;
  /** Override the threshold (tests, a surface that always virtualizes). */
  virtualizeFrom?: number;
  className?: string;
};

const NO_INDEXES: readonly number[] = [];

export function VirtualStack<T>({
  items,
  itemKey,
  estimateSize,
  scrollRef,
  render,
  stickyIndexes = NO_INDEXES,
  stickyClassName,
  pinned = NO_INDEXES,
  scrollTo = null,
  gap = 0,
  gapClassName,
  overscan = 8,
  virtualizeFrom = VIRTUALIZE_FROM,
  className,
}: Props<T>) {
  const virtual = items.length >= virtualizeFrom;
  // The header whose section is at the top now (read while drawing).
  const activeSticky = useRef(-1);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const shown = new Set(defaultRangeExtractor(range));
      let active = -1;
      for (const index of stickyIndexes) {
        if (index <= range.startIndex) active = index;
        else break;
      }
      activeSticky.current = active;
      if (active >= 0) shown.add(active);
      for (const index of pinned) if (index >= 0 && index < range.count) shown.add(index);
      return [...shown].sort((a, b) => a - b);
    },
    [stickyIndexes, pinned],
  );

  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateSize(items[index] as T, index),
    getItemKey: (index) => itemKey(items[index] as T, index),
    rangeExtractor,
    overscan,
    gap,
    enabled: virtual,
    // React 19 warns about flushSync inside effects; a frame late is fine.
    useFlushSync: false,
  });

  // The scroller is usually an ancestor, whose ref React attaches after this
  // component's layout effects, where the virtualizer looks for it: the first
  // look finds nothing and draws nothing. Look again once everything is
  // attached.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (virtual && virtualizer.scrollElement !== scrollRef.current) rerender();
  });

  // Bring the asked item into view, once per ask (key + seq): drawn or not,
  // the virtualizer knows where it is. An ask whose item isn't listed yet (a
  // group still folded) waits for it; items moving later never scroll again.
  const lastScroll = useRef<{ key: string; seq: number } | null>(null);
  useEffect(() => {
    if (!scrollTo || !virtual) return;
    const last = lastScroll.current;
    if (last && last.key === scrollTo.key && last.seq === scrollTo.seq) return;
    const index = items.findIndex((item, i) => itemKey(item, i) === scrollTo.key);
    if (index < 0) return;
    lastScroll.current = { key: scrollTo.key, seq: scrollTo.seq };
    virtualizer.scrollToIndex(index, { align: scrollTo.align ?? "auto" });
  }, [scrollTo, virtual, items, itemKey, virtualizer]);

  if (!virtual) {
    return (
      <div className={cn("flex flex-col", gapClassName, className)}>
        {items.map((item, index) => {
          const sticky = stickyIndexes.includes(index);
          return (
            <div
              key={itemKey(item, index)}
              className={cn(sticky && "sticky top-0", sticky && stickyClassName)}
            >
              {render(item, index, { sticky })}
            </div>
          );
        })}
      </div>
    );
  }

  const shown = virtualizer.getVirtualItems();
  return (
    <div
      data-virtual-stack=""
      // shrink-0: in a flex column (a Board column) the box would shrink to
      // the screen, and the scroller would lose the length it scrolls through.
      className={cn("relative w-full shrink-0", className)}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {shown.map((v) => {
        const item = items[v.index] as T;
        const sticky = v.index === activeSticky.current;
        return (
          <div
            key={v.key}
            data-index={v.index}
            ref={virtualizer.measureElement}
            className={cn(
              "left-0 w-full",
              sticky ? cn("sticky top-0", stickyClassName) : "absolute top-0",
            )}
            style={sticky ? undefined : { transform: `translateY(${v.start}px)` }}
          >
            {render(item, v.index, { sticky })}
          </div>
        );
      })}
    </div>
  );
}
