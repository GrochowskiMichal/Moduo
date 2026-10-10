import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Focus for a dialog that an event opens rather than a `DialogTrigger` (a menu
 * item, a shortcut). Radix then has no trigger to refocus and drops focus on
 * <body> when it closes. This remembers what had focus as the dialog opened
 * and hands focus back there; pass the result to `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  // A layout effect runs before Radix moves focus into the dialog (its own
  // effect is a passive one), so this still sees the element that opened it.
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);
  return useCallback((event: Event) => {
    const target = opener.current;
    opener.current = null;
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus();
  }, []);
}
