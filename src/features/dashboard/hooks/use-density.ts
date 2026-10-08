// DB-5 — the live density value for widget bodies (AC13). Reads the global
// `data-density` attribute the appearance system sets on <html> (appearance.ts)
// and re-renders when it changes, so a widget's row budget responds to the
// density picker without every widget re-subscribing to the full appearance hook.

import { useEffect, useState } from "react";

import { isWidgetDensity, type WidgetDensity } from "../widget-density";

function readDensity(): WidgetDensity {
  if (typeof document === "undefined") return "comfortable";
  const value = document.documentElement.getAttribute("data-density");
  return isWidgetDensity(value) ? value : "comfortable";
}

export function useDensity(): WidgetDensity {
  const [density, setDensity] = useState<WidgetDensity>(readDensity);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    // Sync once on mount (SSR/first-paint could differ from the applied attr).
    setDensity(readDensity());
    const observer = new MutationObserver(() => setDensity(readDensity()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-density"] });
    return () => observer.disconnect();
  }, []);

  return density;
}
