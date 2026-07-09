// DB-8 — factory for a fresh widget instance (gallery add). Seeds the type's
// default size + config from the catalog; the engine places it (x/y).

import type { WidgetInstance, WidgetSize, WidgetType } from "../engine/types";
import { defaultConfigFor, defaultSizeFor } from "./catalog";

function newWidgetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Webview without crypto.randomUUID (none of our targets) — collision-safe enough.
  return `w-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function newWidgetInstance(type: WidgetType, size?: WidgetSize): WidgetInstance {
  return {
    id: newWidgetId(),
    type,
    size: size ?? defaultSizeFor(type),
    x: 0,
    y: 0,
    config: defaultConfigFor(type),
  };
}
