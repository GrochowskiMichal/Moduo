// A menu that scrolls says so (DS-6 follow-up, TV-U10): while a menu's list
// runs past its room and more items wait below, the menu carries
// `data-more-below`, and global.css fades its foot. Set straight on the node
// (no React state), so scrolling a long menu never redraws its items.

import { type Ref, useCallback, useEffect, useRef } from "react";

/** Whether a scroller has more to show below what's in view. */
export function hasMoreBelow(el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">) {
  return el.scrollHeight - el.scrollTop - el.clientHeight > 1;
}

/**
 * A ref for a menu's scrolling content: it keeps `data-more-below` right as
 * the menu opens, scrolls and resizes. Pass the consumer's own ref, and it's
 * set too.
 */
export function useMoreBelowRef<T extends HTMLElement>(forward?: Ref<T>): (node: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  const forwardRef = useRef(forward);
  useEffect(() => {
    forwardRef.current = forward;
  });
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback((node: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    const target = forwardRef.current;
    if (typeof target === "function") target(node);
    else if (target) (target as { current: T | null }).current = node;
    if (!node) return;
    const update = () => {
      if (hasMoreBelow(node)) node.setAttribute("data-more-below", "");
      else node.removeAttribute("data-more-below");
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    // Items arriving or leaving change the height without a resize of the box.
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mutations?.observe(node, { childList: true, subtree: true });
    cleanup.current = () => {
      node.removeEventListener("scroll", update);
      observer?.disconnect();
      mutations?.disconnect();
    };
  }, []);
}
