import { useCallback, useSyncExternalStore } from "react";

import { useRootAttribute } from "./use-root-attribute";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function useOsReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof matchMedia !== "function") return () => {};
    const query = matchMedia(REDUCE_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia === "function" && matchMedia(REDUCE_QUERY).matches,
    () => true,
  );
}

/**
 * Whether motion should stop, live: Settings' motion choice (`data-motion` on
 * <html>) over the OS's reduced-motion setting, the same two layers tokens.css
 * reads. For JS-driven animation that the CSS motion tokens can't reach
 * (canvas loops, third-party components).
 */
export function useReducedMotion(): boolean {
  const pref = useRootAttribute("data-motion");
  const osReduced = useOsReducedMotion();
  if (pref === "reduced") return true;
  if (pref === "full") return false;
  return osReduced;
}
