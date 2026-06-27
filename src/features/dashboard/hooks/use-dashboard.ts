import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime";
import type { DashboardLayout, WidgetConfig, WidgetInstance, WidgetType } from "../types";

const VALID_WIDGET_TYPES = new Set<WidgetType>(["notes", "clock", "weather", "stock", "crypto", "pomodoro", "hydration", "countdown", "todolist", "job-tracker", "recently-linked", "contacts-needs-attention"]);

// redb namespace for all dashboard layouts.
const STORE_NS = "dashboard-layout";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Key used inside the redb kv namespace.
function redbKey(workspaceId: string | null, sceneId: string | null): string {
  return `${workspaceId ?? "global"}:${sceneId ?? "main"}`;
}

// Legacy localStorage key for one-time migration.
function legacyLocalStorageKey(workspaceId: string | null, sceneId: string | null): string {
  return `moduo:dashboard-layout:v1:${workspaceId ?? "global"}:${sceneId ?? "main"}`;
}

// Accepts either a raw JSON string (legacy localStorage) or an already-parsed
// object (from redb via Tauri invoke).
function parseLayout(raw: unknown): DashboardLayout | null {
  if (!raw) return null;
  try {
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<DashboardLayout>;
    if (!Array.isArray(parsed.widgets)) return null;
    const widgets = parsed.widgets
      .filter(
        (entry): entry is WidgetInstance =>
          !!entry &&
          typeof entry.id === "string" &&
          typeof entry.type === "string" &&
          VALID_WIDGET_TYPES.has(entry.type as WidgetType)
      )
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        x: Math.max(0, Number(entry.x ?? 0)),
        y: Math.max(0, Number(entry.y ?? 0)),
        w: Math.max(2, Number(entry.w ?? 6)),
        h: Math.max(2, Number(entry.h ?? 4)),
        config: entry.config ?? {},
      }));
    return { isLocked: parsed.isLocked ?? false, widgets };
  } catch {
    return null;
  }
}

type UseDashboardState = {
  layout: DashboardLayout;
  widgets: WidgetInstance[];
  isLocked: boolean;
  isLoading: boolean;
  toggleLock: () => void;
  addWidget: (type: WidgetType, x: number, y: number) => void;
  moveWidget: (id: string, nextX: number, nextY: number) => void;
  resizeWidget: (id: string, nextW: number, nextH: number) => void;
  removeWidget: (id: string) => void;
  updateWidgetConfig: (id: string, patch: Partial<WidgetConfig>) => void;
};

export function useDashboard(
  workspaceId: string | null,
  sceneId: string | null,
  runtime: ModuoRuntime | null
): UseDashboardState {
  const [layout, setLayout] = useState<DashboardLayout>({ isLocked: false, widgets: [] });
  const [isLoading, setIsLoading] = useState(true);

  // Guards the save effect: only true AFTER the async load for the current
  // key has resolved. Prevents the empty initial state from overwriting the
  // saved layout during the async gap.
  const isLoadedRef = useRef(false);

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!runtime || !workspaceId) {
      setLayout({ isLocked: false, widgets: [] });
      isLoadedRef.current = true;
      setIsLoading(false);
      return;
    }

    // Reset guard synchronously before starting the async fetch so the save
    // effect (which runs in the same render pass) cannot fire with stale data.
    isLoadedRef.current = false;
    setIsLoading(true);

    const key = redbKey(workspaceId, sceneId);

    runtime.localStore
      .get(STORE_NS, key)
      .then((raw) => {
        let parsed = parseLayout(raw);

        // One-time migration from the old localStorage-based storage.
        if (!parsed && typeof window !== "undefined") {
          const legacyRaw = window.localStorage.getItem(legacyLocalStorageKey(workspaceId, sceneId));
          parsed = parseLayout(legacyRaw);
          if (parsed) {
            // Persist to redb and clean up localStorage.
            runtime.localStore.set(STORE_NS, key, parsed).catch(console.error);
            window.localStorage.removeItem(legacyLocalStorageKey(workspaceId, sceneId));
          }
        }

        setLayout(parsed ?? { isLocked: false, widgets: [] });
        isLoadedRef.current = true;
        setIsLoading(false);
      })
      .catch(() => {
        setLayout({ isLocked: false, widgets: [] });
        isLoadedRef.current = true;
        setIsLoading(false);
      });
  }, [sceneId, workspaceId, runtime]);

  // ── Save ────────────────────────────────────────────────────────────────────
  // Skipped until isLoadedRef is true so we never overwrite a saved layout
  // with the empty initial state during async load.
  useEffect(() => {
    if (!runtime || !workspaceId || !isLoadedRef.current) return;
    runtime.localStore
      .set(STORE_NS, redbKey(workspaceId, sceneId), layout)
      .catch(console.error);
  }, [layout, sceneId, workspaceId, runtime]);

  const toggleLock = useCallback(() => {
    setLayout((current) => ({ ...current, isLocked: !current.isLocked }));
  }, []);

  const addWidget = useCallback((type: WidgetType, x: number, y: number) => {
    setLayout((current) => ({
      ...current,
      widgets: [
        ...current.widgets,
        { id: safeId(), type, x: Math.max(0, x), y: Math.max(0, y), w: 6, h: 5, config: {} },
      ],
    }));
  }, []);

  const moveWidget = useCallback((id: string, nextX: number, nextY: number) => {
    setLayout((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        widget.id === id ? { ...widget, x: Math.max(0, nextX), y: Math.max(0, nextY) } : widget
      ),
    }));
  }, []);

  const resizeWidget = useCallback((id: string, nextW: number, nextH: number) => {
    setLayout((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        widget.id === id ? { ...widget, w: Math.max(2, nextW), h: Math.max(2, nextH) } : widget
      ),
    }));
  }, []);

  const removeWidget = useCallback((id: string) => {
    setLayout((current) => ({ ...current, widgets: current.widgets.filter((widget) => widget.id !== id) }));
  }, []);

  const updateWidgetConfig = useCallback((id: string, patch: Partial<WidgetConfig>) => {
    setLayout((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        widget.id === id ? { ...widget, config: { ...widget.config, ...patch } } : widget
      ),
    }));
  }, []);

  return useMemo(
    () => ({
      layout,
      widgets: layout.widgets,
      isLocked: layout.isLocked,
      isLoading,
      toggleLock,
      addWidget,
      moveWidget,
      resizeWidget,
      removeWidget,
      updateWidgetConfig,
    }),
    [addWidget, isLoading, layout, moveWidget, removeWidget, resizeWidget, toggleLock, updateWidgetConfig]
  );
}
