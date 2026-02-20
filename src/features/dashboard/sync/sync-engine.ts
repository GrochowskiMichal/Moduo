import { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { dashboardLocalDB, DashboardOutboxEntry, DashboardOutboxOp, DashboardViewRow, DashboardWidgetRow, getDashboardMetaValue, setDashboardMetaValue } from "../db/local-db";
import { WidgetConfig } from "../types";

type StatusListener = (status: "syncing" | "synced" | "offline" | "error") => void;
type ChangeListener = () => void;

interface RemoteView {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  position: string;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RemoteWidget {
  id: string;
  workspace_id: string;
  owner_id: string;
  view_id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const BOOTSTRAP_LIMIT = 1000;
const MAX_BOOTSTRAP_PAGES = 10;
const RECONCILE_INTERVAL_MS = 15_000;
const FLUSH_DEBOUNCE_MS = 450;

function nowIso(): string {
  return new Date().toISOString();
}

function mapView(row: RemoteView): DashboardViewRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    name: row.name,
    position: row.position,
    isLocked: row.is_locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRemoteView(row: DashboardViewRow): RemoteView {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_id: row.ownerId,
    name: row.name,
    position: row.position,
    is_locked: row.isLocked,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

function mapWidget(row: RemoteWidget): DashboardWidgetRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    viewId: row.view_id,
    type: row.type,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    config: row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRemoteWidget(row: DashboardWidgetRow): RemoteWidget {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_id: row.ownerId,
    view_id: row.viewId,
    type: row.type,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    config: row.config,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

function cursorKey(scopeKey: string, entity: string): string {
  return `dashboard_cursor:${scopeKey}:${entity}`;
}

async function pullViews(supabase: SupabaseClient, workspaceId: string, scopeKey: string): Promise<boolean> {
  let changed = false;
  let after = await getDashboardMetaValue(cursorKey(scopeKey, "views"));

  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("dashboard_views_bootstrap", {
      p_workspace_id: workspaceId,
      p_after_updated_at: after,
      p_limit: BOOTSTRAP_LIMIT,
    });
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as RemoteView[];
    if (!rows.length) break;

    await dashboardLocalDB.views.bulkPut(rows.map(mapView));
    changed = true;

    const latest = rows[rows.length - 1]?.updated_at;
    if (latest) {
      after = latest;
      await setDashboardMetaValue(cursorKey(scopeKey, "views"), latest);
    }

    if (rows.length < BOOTSTRAP_LIMIT) break;
  }

  return changed;
}

async function pullWidgets(supabase: SupabaseClient, workspaceId: string, scopeKey: string): Promise<boolean> {
  let changed = false;
  let after = await getDashboardMetaValue(cursorKey(scopeKey, "widgets"));

  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("dashboard_widgets_bootstrap", {
      p_workspace_id: workspaceId,
      p_after_updated_at: after,
      p_limit: BOOTSTRAP_LIMIT,
    });
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as RemoteWidget[];
    if (!rows.length) break;

    await dashboardLocalDB.widgets.bulkPut(rows.map(mapWidget));
    changed = true;

    const latest = rows[rows.length - 1]?.updated_at;
    if (latest) {
      after = latest;
      await setDashboardMetaValue(cursorKey(scopeKey, "widgets"), latest);
    }

    if (rows.length < BOOTSTRAP_LIMIT) break;
  }

  return changed;
}

export class DashboardSyncEngine {
  private readonly clientId = crypto.randomUUID();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly changeListeners = new Set<ChangeListener>();
  private onlineHandler?: () => void;
  private offlineHandler?: () => void;
  private isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private started = false;
  private destroyed = false;
  private reconciling = false;
  private readonly scopeKey: string;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
    private readonly workspaceId: string
  ) {
    this.scopeKey = `${userId}:${workspaceId}`;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitStatus(status: "syncing" | "synced" | "offline" | "error"): void {
    for (const listener of this.statusListeners) listener(status);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  async start(): Promise<void> {
    if (this.started || this.destroyed) return;
    this.started = true;

    if (typeof window !== "undefined") {
      this.onlineHandler = () => {
        this.isOnline = true;
        this.requestSync();
      };
      this.offlineHandler = () => {
        this.isOnline = false;
        this.emitStatus("offline");
      };
      window.addEventListener("online", this.onlineHandler);
      window.addEventListener("offline", this.offlineHandler);
    }

    await this.subscribeRealtime();
    await this.reconcile();

    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
  }

  destroy(): void {
    this.destroyed = true;
    this.started = false;
    if (this.onlineHandler && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    if (this.offlineHandler && typeof window !== "undefined") {
      window.removeEventListener("offline", this.offlineHandler);
    }
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.realtimeChannel) {
      void this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
  }

  async enqueue(op: DashboardOutboxOp, payload: unknown): Promise<void> {
    await dashboardLocalDB.outbox.put({
      id: `${this.clientId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      scopeKey: this.scopeKey,
      workspaceId: this.workspaceId,
      ownerId: this.userId,
      op,
      payload,
      createdAt: nowIso(),
    });

    this.requestSync();
  }

  requestSync(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.reconcile();
    }, FLUSH_DEBOUNCE_MS);
  }

  private async subscribeRealtime(): Promise<void> {
    if (this.realtimeChannel || this.destroyed) return;

    const applyRealtime = async (table: "dashboard_views" | "dashboard_widgets", payload: any) => {
      if (this.destroyed) return;
      const type = payload.eventType as "INSERT" | "UPDATE" | "DELETE";

      if (type === "DELETE") {
        const oldRow = payload.old as { id?: string };
        if (!oldRow?.id) return;
        if (table === "dashboard_views") await dashboardLocalDB.views.delete(oldRow.id);
        if (table === "dashboard_widgets") await dashboardLocalDB.widgets.delete(oldRow.id);
        this.emitChange();
        return;
      }

      const row = payload.new;
      if (!row) return;

      if (table === "dashboard_views") await dashboardLocalDB.views.put(mapView(row as RemoteView));
      if (table === "dashboard_widgets") await dashboardLocalDB.widgets.put(mapWidget(row as RemoteWidget));
      this.emitChange();
    };

    this.realtimeChannel = this.supabase
      .channel(`dashboard-sync-${this.workspaceId}-${this.clientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dashboard_views",
          filter: `workspace_id=eq.${this.workspaceId}`,
        },
        (payload) => {
          void applyRealtime("dashboard_views", payload);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dashboard_widgets",
          filter: `workspace_id=eq.${this.workspaceId}`,
        },
        (payload) => {
          void applyRealtime("dashboard_widgets", payload);
        }
      )
      .subscribe();
  }

  private async applyOutboxEntry(entry: DashboardOutboxEntry): Promise<void> {
    switch (entry.op) {
      case "upsert_view": {
        const view = entry.payload as DashboardViewRow;
        const { error } = await this.supabase
          .from("dashboard_views")
          .upsert(toRemoteView(view), { onConflict: "id" });
        if (error) throw error;
        return;
      }
      case "delete_view": {
        const payload = entry.payload as { viewId: string; deletedAt: string };
        const { error } = await this.supabase
          .from("dashboard_views")
          .update({ deleted_at: payload.deletedAt })
          .eq("id", payload.viewId)
          .eq("workspace_id", this.workspaceId);
        if (error) throw error;
        return;
      }
      case "upsert_widget": {
        const widget = entry.payload as DashboardWidgetRow;
        const { error } = await this.supabase
          .from("dashboard_widgets")
          .upsert(toRemoteWidget(widget), { onConflict: "id" });
        if (error) throw error;
        return;
      }
      case "delete_widget": {
        const payload = entry.payload as { widgetId: string; deletedAt: string };
        const { error } = await this.supabase
          .from("dashboard_widgets")
          .update({ deleted_at: payload.deletedAt })
          .eq("id", payload.widgetId)
          .eq("workspace_id", this.workspaceId);
        if (error) throw error;
        return;
      }
      default:
        return;
    }
  }

  private async flushOutbox(): Promise<boolean> {
    const pending = (
      await dashboardLocalDB.outbox.where("scopeKey").equals(this.scopeKey).toArray()
    ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    
    if (!pending.length) return false;

    let changed = false;

    for (const entry of pending) {
      await this.applyOutboxEntry(entry);
      await dashboardLocalDB.outbox.delete(entry.id);
      changed = true;
    }

    return changed;
  }

  async reconcile(): Promise<void> {
    if (this.destroyed || this.reconciling) return;
    this.reconciling = true;

    if (!this.isOnline) {
      this.emitStatus("offline");
      this.reconciling = false;
      return;
    }

    this.emitStatus("syncing");

    try {
      let changed = false;
      changed = (await this.flushOutbox()) || changed;
      changed = (await pullViews(this.supabase, this.workspaceId, this.scopeKey)) || changed;
      changed = (await pullWidgets(this.supabase, this.workspaceId, this.scopeKey)) || changed;
      if (changed) this.emitChange();
      this.emitStatus("synced");
    } catch {
      this.emitStatus("error");
    } finally {
      this.reconciling = false;
    }
  }
}
