import Dexie, { type Table } from "dexie";
import { WidgetConfig, WidgetInstance, DashboardView } from "../types";

export interface DashboardViewRow {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  position: string;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DashboardWidgetRow {
  id: string;
  workspaceId: string;
  ownerId: string;
  viewId: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type DashboardOutboxOp =
  | "upsert_view"
  | "delete_view"
  | "upsert_widget"
  | "delete_widget";

export interface DashboardOutboxEntry {
  id: string;
  scopeKey: string; // userId:workspaceId
  workspaceId: string;
  ownerId: string;
  op: DashboardOutboxOp;
  payload: unknown;
  createdAt: string;
}

type LocalMetaKV = {
  key: string;
  value: string;
};

export class DashboardLocalDB extends Dexie {
  views!: Table<DashboardViewRow, string>;
  widgets!: Table<DashboardWidgetRow, string>;
  outbox!: Table<DashboardOutboxEntry, string>;
  meta!: Table<LocalMetaKV, string>;

  constructor() {
    super("moduo_dashboard_v1");

    this.version(1).stores({
      views: "id, workspaceId, ownerId, position, updatedAt, deletedAt",
      widgets: "id, workspaceId, ownerId, viewId, [viewId+updatedAt], updatedAt, deletedAt",
      outbox: "id, scopeKey, workspaceId, ownerId, op, createdAt",
      meta: "key",
    });
  }
}

export const dashboardLocalDB = new DashboardLocalDB();

export async function getDashboardMetaValue(key: string): Promise<string | null> {
  const row = await dashboardLocalDB.meta.get(key);
  return row?.value ?? null;
}

export async function setDashboardMetaValue(key: string, value: string): Promise<void> {
  await dashboardLocalDB.meta.put({ key, value });
}

export async function removeDashboardMetaValue(key: string): Promise<void> {
  await dashboardLocalDB.meta.delete(key);
}
