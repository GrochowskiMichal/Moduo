import { type RefObject, useEffect, useState } from "react";

/**
 * Whether focus is inside `ref`. A binding that should only fire while its
 * surface holds focus passes this as `enabled`, so the key stays free for a
 * wider scope otherwise (a declined key would not fall through).
 */
export function useFocusWithin(ref: RefObject<HTMLElement | null>): boolean {
  const [within, setWithin] = useState(false);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const update = () => setWithin(root.contains(document.activeElement));
    update();
    root.addEventListener("focusin", update);
    // focusout fires before the new element has focus; read it a tick later.
    const onOut = () => setTimeout(update, 0);
    root.addEventListener("focusout", onOut);
    return () => {
      root.removeEventListener("focusin", update);
      root.removeEventListener("focusout", onOut);
    };
  }, [ref]);
  return within;
}
