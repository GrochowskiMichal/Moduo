import { useCallback, useSyncExternalStore } from "react";

/**
 * A live read of one attribute on <html>, where Settings writes the appearance
 * (`data-theme`, `data-density`…, lib/appearance.ts) and the motion choice
 * (`data-motion`, lib/preferences.ts). Re-renders when the attribute changes.
 */
export function useRootAttribute(name: string): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: [name] });
      return () => observer.disconnect();
    },
    [name],
  );
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.getAttribute(name),
    () => null,
  );
}
