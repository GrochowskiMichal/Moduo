import { useCallback, useEffect, useMemo, useState } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import { dashboardLocalDB, DashboardViewRow, DashboardWidgetRow } from "../db/local-db";
import { DashboardSyncEngine } from "../sync/sync-engine";
import { WidgetConfig, WidgetInstance, WidgetType } from "../types";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export type UseDashboardState = {
  views: DashboardViewRow[];
  widgets: Record<string, WidgetInstance[]>; // key is viewId
  activeViewId: string | null;
  loading: boolean;
  syncStatus: "syncing" | "synced" | "offline" | "error";
  setActiveViewId: (viewId: string) => void;
  createView: (name: string) => Promise<string | null>;
  updateView: (viewId: string, patch: Partial<DashboardViewRow>) => Promise<void>;
  deleteView: (viewId: string) => Promise<void>;
  addWidget: (viewId: string, type: WidgetType, x: number, y: number) => Promise<string | null>;
  updateWidget: (widgetId: string, patch: Partial<DashboardWidgetRow>) => Promise<void>;
  deleteWidget: (widgetId: string) => Promise<void>;
};

type UseDashboardParams = {
  supabase: SupabaseClient | null;
  userId: string | null;
  workspaceId: string | null;
};

export function useDashboard(params: UseDashboardParams): UseDashboardState {
  const { supabase, userId, workspaceId } = params;

  const [views, setViews] = useState<DashboardViewRow[]>([]);
  const [widgets, setWidgets] = useState<Record<string, WidgetInstance[]>>({});
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"syncing" | "synced" | "offline" | "error">("synced");

  const syncEngine = useMemo(() => {
    if (!supabase || !userId || !workspaceId) return null;
    return new DashboardSyncEngine(supabase, userId, workspaceId);
  }, [supabase, userId, workspaceId]);

  const loadLocal = useCallback(async () => {
    if (!workspaceId) return;

    const [viewRows, widgetRows] = await Promise.all([
      dashboardLocalDB.views.where("workspaceId").equals(workspaceId).toArray(),
      dashboardLocalDB.widgets.where("workspaceId").equals(workspaceId).toArray(),
    ]);

    const activeViews = viewRows
      .filter((v) => !v.deletedAt)
      .sort((a, b) => a.position.localeCompare(b.position));

    // Create default view if none exists
    if (activeViews.length === 0 && userId) {
       const timestamp = nowIso();
       const defaultView: DashboardViewRow = {
         id: safeId(),
         workspaceId,
         ownerId: userId,
         name: "Main Dashboard",
         position: "z0",
         isLocked: false,
         createdAt: timestamp,
         updatedAt: timestamp,
         deletedAt: null,
       };
       
       await dashboardLocalDB.views.put(defaultView);
       
       // Queue for sync
       const clientId = crypto.randomUUID();
       await dashboardLocalDB.outbox.put({
          id: `${clientId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          scopeKey: `${userId}:${workspaceId}`,
          workspaceId,
          ownerId: userId,
          op: "upsert_view",
          payload: defaultView,
          createdAt: timestamp,
       });

       activeViews.push(defaultView);
    }

    const activeWidgets = widgetRows.filter((w) => !w.deletedAt);
    
    const widgetsByView: Record<string, WidgetInstance[]> = {};
    activeWidgets.forEach((w) => {
      if (!widgetsByView[w.viewId]) {
        widgetsByView[w.viewId] = [];
      }
      widgetsByView[w.viewId].push({
        id: w.id,
        type: w.type as WidgetType,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        config: w.config,
      });
    });

    setViews(activeViews);
    setWidgets(widgetsByView);

    // Set initial active view if none selected
    setActiveViewId((current) => {
      if (current && activeViews.some((v) => v.id === current)) return current;
      return activeViews[0]?.id ?? null;
    });
  }, [workspaceId, userId]);

  useEffect(() => {
    if (!syncEngine || !workspaceId) {
      setViews([]);
      setWidgets({});
      setLoading(false);
      return;
    }

    let active = true;

    const stopStatus = syncEngine.onStatus(setSyncStatus);
    const stopChange = syncEngine.onChange(() => {
      void loadLocal();
    });

    const run = async () => {
      setLoading(true);
      try {
        await loadLocal();
        await syncEngine.start();
        // Load again after sync start to catch any immediate updates or bootstrap results
        await loadLocal();
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
      stopStatus();
      stopChange();
      syncEngine.destroy();
    };
  }, [loadLocal, syncEngine, workspaceId]);

  const createView = useCallback(async (name: string) => {
    if (!userId || !workspaceId || !syncEngine) return null;

    const position = `z${Date.now()}`; 
    const timestamp = nowIso();

    const view: DashboardViewRow = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      name,
      position,
      isLocked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    setViews((prev) => [...prev, view]);
    setActiveViewId(view.id);
    
    await dashboardLocalDB.views.put(view);
    await syncEngine.enqueue("upsert_view", view);
    
    return view.id;
  }, [syncEngine, userId, workspaceId]);

  const updateView = useCallback(async (viewId: string, patch: Partial<DashboardViewRow>) => {
    if (!syncEngine || !workspaceId) return;

    const current = views.find((v) => v.id === viewId);
    if (!current) return;

    const updated: DashboardViewRow = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };

    setViews((prev) => prev.map((v) => (v.id === viewId ? updated : v)));
    
    await dashboardLocalDB.views.put(updated);
    await syncEngine.enqueue("upsert_view", updated);
  }, [syncEngine, views, workspaceId]);

  const deleteView = useCallback(async (viewId: string) => {
    if (!syncEngine || !workspaceId) return;

    const deletedAt = nowIso();
    const current = views.find((v) => v.id === viewId);
    if (!current) return;

    const updated = { ...current, deletedAt, updatedAt: deletedAt };

    setViews((prev) => prev.filter((v) => v.id !== viewId));
    if (activeViewId === viewId) setActiveViewId(null);

    await dashboardLocalDB.views.put(updated);
    await syncEngine.enqueue("delete_view", { viewId, deletedAt });
  }, [activeViewId, syncEngine, views, workspaceId]);

  const addWidget = useCallback(async (viewId: string, type: WidgetType, x: number, y: number) => {
    if (!userId || !workspaceId || !syncEngine) return null;

    const timestamp = nowIso();
    const widget: DashboardWidgetRow = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      viewId,
      type,
      x,
      y,
      w: 6,
      h: 4,
      config: {},
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    setWidgets((prev) => ({
      ...prev,
      [viewId]: [...(prev[viewId] || []), {
        id: widget.id,
        type: widget.type as WidgetType,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        config: widget.config,
      }],
    }));

    await dashboardLocalDB.widgets.put(widget);
    await syncEngine.enqueue("upsert_widget", widget);
    
    return widget.id;
  }, [syncEngine, userId, workspaceId]);

  const updateWidget = useCallback(async (widgetId: string, patch: Partial<DashboardWidgetRow>) => {
    if (!syncEngine || !workspaceId) return;

    // Need to find which view this widget belongs to
    const widgetRow = await dashboardLocalDB.widgets.get(widgetId);
    if (!widgetRow) return;

    const updated: DashboardWidgetRow = {
      ...widgetRow,
      ...patch,
      updatedAt: nowIso(),
    };

    setWidgets((prev) => {
      const viewWidgets = prev[widgetRow.viewId] || [];
      return {
        ...prev,
        [widgetRow.viewId]: viewWidgets.map((w) => 
          w.id === widgetId 
            ? { ...w, ...patch } as WidgetInstance 
            : w
        ),
      };
    });

    await dashboardLocalDB.widgets.put(updated);
    await syncEngine.enqueue("upsert_widget", updated);
  }, [syncEngine, workspaceId]);

  const deleteWidget = useCallback(async (widgetId: string) => {
    if (!syncEngine || !workspaceId) return;

    const widgetRow = await dashboardLocalDB.widgets.get(widgetId);
    if (!widgetRow) return;

    const deletedAt = nowIso();
    const updated = { ...widgetRow, deletedAt, updatedAt: deletedAt };

    setWidgets((prev) => {
      const viewWidgets = prev[widgetRow.viewId] || [];
      return {
        ...prev,
        [widgetRow.viewId]: viewWidgets.filter((w) => w.id !== widgetId),
      };
    });

    await dashboardLocalDB.widgets.put(updated);
    await syncEngine.enqueue("delete_widget", { widgetId, deletedAt });
  }, [syncEngine, workspaceId]);

  return {
    views,
    widgets,
    activeViewId,
    loading,
    syncStatus,
    setActiveViewId,
    createView,
    updateView,
    deleteView,
    addWidget,
    updateWidget,
    deleteWidget,
  };
}
