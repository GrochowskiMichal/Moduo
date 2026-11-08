// One Tab stop for a group of controls (specs/mail-improve.md §6): the rail and the tab
// strip. The current item (aria-current, aria-selected, else the last focused, else
// the first) is the stop; arrow keys, Home and End move inside. Disabled and
// aria-hidden controls are skipped; aria-disabled ones stay reachable so first run
// can say why they're dimmed. Keys it handles are claimed (`preventDefault`), so the
// page's j/k and ↓/↑ bindings never see them.

import { type KeyboardEvent, type RefObject, useCallback, useLayoutEffect, useRef } from "react";

export type RovingAxis = "vertical" | "horizontal";

const NEXT: Record<RovingAxis, string> = { vertical: "ArrowDown", horizontal: "ArrowRight" };
const PREV: Record<RovingAxis, string> = { vertical: "ArrowUp", horizontal: "ArrowLeft" };

function stops(root: HTMLElement, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      !el.closest('[aria-hidden="true"]') &&
      !el.closest("[data-roving-skip]"),
  );
}

export function useRoving(
  ref: RefObject<HTMLElement | null>,
  { axis, selector = "button" }: { axis: RovingAxis; selector?: string },
) {
  const active = useRef<HTMLElement | null>(null);

  const sync = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const list = stops(root, selector);
    if (list.length === 0) return;
    const current =
      (active.current && list.includes(active.current) ? active.current : null) ??
      list.find((el) => el.getAttribute("aria-current") === "page") ??
      list.find((el) => el.getAttribute("aria-selected") === "true") ??
      list[0]!;
    active.current = current;
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      const next = el === current ? 0 : -1;
      if (el.tabIndex !== next) el.tabIndex = next;
    }
  }, [ref, selector]);

  // Every render: items come and go (accounts expand, tabs fold).
  useLayoutEffect(sync);

  const onFocus = useCallback(
    (e: { target: EventTarget }) => {
      const root = ref.current;
      if (!root || !(e.target instanceof HTMLElement)) return;
      if (stops(root, selector).includes(e.target)) {
        active.current = e.target;
        sync();
      }
    },
    [ref, selector, sync],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const root = ref.current;
      if (!root || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const { key } = e;
      if (key !== NEXT[axis] && key !== PREV[axis] && key !== "Home" && key !== "End") return;
      const list = stops(root, selector);
      const at = list.findIndex((el) => el === e.target || el.contains(e.target as Node));
      if (at < 0) return;
      const to =
        key === "Home"
          ? 0
          : key === "End"
            ? list.length - 1
            : key === NEXT[axis]
              ? Math.min(list.length - 1, at + 1)
              : Math.max(0, at - 1);
      e.preventDefault();
      e.stopPropagation();
      active.current = list[to]!;
      sync();
      list[to]!.focus();
    },
    [ref, selector, axis, sync],
  );

  return { onKeyDown, onFocus };
}
