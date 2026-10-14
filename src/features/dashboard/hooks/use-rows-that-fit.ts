// How many list rows a widget body really holds (TV-H1 polish): its height
// over a drawn row's (plus the list's 2 px gap). The density budget
// (widget-density.ts) stays the floor; this lets a tall cell fill instead of
// stopping at three rows over empty space. Null until a row has been drawn.

import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

/** `gap-0.5` between a widget list's rows. */
const ROW_GAP_PX = 2;

/** Whole rows of `rowPx` (gap included) in `heightPx`; null without a row to go by. */
export function rowsThatFit(heightPx: number, rowPx: number): number | null {
  if (rowPx <= ROW_GAP_PX || heightPx <= 0) return null;
  return Math.floor(heightPx / rowPx);
}

export function useRowsThatFit(ref: RefObject<HTMLElement | null>): number | null {
  const [rows, setRows] = useState<number | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);

  const measure = (target: HTMLElement | null) => {
    if (!target) return;
    const row = target.querySelector<HTMLElement>("li");
    if (!row) return;
    const next = rowsThatFit(target.clientHeight, row.offsetHeight + ROW_GAP_PX);
    if (next !== null) setRows((prev) => (prev === next ? prev : next));
  };

  // After every render: the body may have just appeared, or its first row.
  useLayoutEffect(() => {
    if (ref.current !== el) setEl(ref.current);
    measure(ref.current);
  });

  // And whenever the cell changes size (a resize, a density change).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `measure` only reads the element it's given
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return rows;
}
