import type { ModuoRuntime } from "../../../lib/runtime";

export type MindmapOption = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MindmapDocument = {
  nodes: any[];
  edges: any[];
  updatedAt: string;
};

const MINDMAPS_NAMESPACE = "mindmaps:v1";

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mindmapsListKey(workspaceId: string): string {
  return `list:${workspaceId}`;
}

function mindmapDocKey(workspaceId: string, mindmapId: string): string {
  return `doc:${workspaceId}:${mindmapId}`;
}

function normalizeMindmap(raw: any, workspaceId: string): MindmapOption | null {
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    workspaceId: String(raw.workspaceId ?? workspaceId),
    ownerId: String(raw.ownerId ?? ""),
    name: String(raw.name ?? "Untitled Mindmap"),
    position: String(raw.position ?? `m${Date.now().toString(36)}`),
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso()),
    deletedAt: raw.deletedAt ? String(raw.deletedAt) : null,
  };
}

async function writeMindmaps(runtime: ModuoRuntime, workspaceId: string, maps: MindmapOption[]) {
  await runtime.localStore.set(MINDMAPS_NAMESPACE, mindmapsListKey(workspaceId), maps);
}

export async function listMindmaps(runtime: ModuoRuntime, workspaceId: string): Promise<MindmapOption[]> {
  const raw = await runtime.localStore.get(MINDMAPS_NAMESPACE, mindmapsListKey(workspaceId));
  const parsed = Array.isArray(raw) ? raw : [];
  return parsed
    .map((entry) => normalizeMindmap(entry, workspaceId))
    .filter((entry): entry is MindmapOption => !!entry && !entry.deletedAt)
    .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
}

export async function createMindmap(
  runtime: ModuoRuntime,
  input: { workspaceId: string; ownerId: string; name?: string }
): Promise<MindmapOption> {
  const existing = await listMindmaps(runtime, input.workspaceId);
  const timestamp = nowIso();
  const map: MindmapOption = {
    id: safeId(),
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    name: input.name?.trim() || "New Mindmap",
    position: `m${Date.now().toString(36)}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await writeMindmaps(runtime, input.workspaceId, [...existing, map]);
  await runtime.localStore.set(MINDMAPS_NAMESPACE, mindmapDocKey(input.workspaceId, map.id), {
    nodes: [],
    edges: [],
    updatedAt: timestamp,
  } satisfies MindmapDocument);
  return map;
}

export async function deleteMindmap(runtime: ModuoRuntime, workspaceId: string, mindmapId: string) {
  const existing = await listMindmaps(runtime, workspaceId);
  await writeMindmaps(
    runtime,
    workspaceId,
    existing.filter((mindmap) => mindmap.id !== mindmapId)
  );
  await runtime.localStore.remove(MINDMAPS_NAMESPACE, mindmapDocKey(workspaceId, mindmapId));
}

export async function loadMindmapDocument(
  runtime: ModuoRuntime,
  workspaceId: string,
  mindmapId: string
): Promise<MindmapDocument | null> {
  const raw = await runtime.localStore.get(MINDMAPS_NAMESPACE, mindmapDocKey(workspaceId, mindmapId));
  if (!raw || typeof raw !== "object") return null;
  return {
    nodes: Array.isArray((raw as any).nodes) ? (raw as any).nodes : [],
    edges: Array.isArray((raw as any).edges) ? (raw as any).edges : [],
    updatedAt: typeof (raw as any).updatedAt === "string" ? (raw as any).updatedAt : nowIso(),
  };
}

export async function saveMindmapDocument(
  runtime: ModuoRuntime,
  workspaceId: string,
  mindmapId: string,
  document: MindmapDocument
) {
  await runtime.localStore.set(MINDMAPS_NAMESPACE, mindmapDocKey(workspaceId, mindmapId), document);
}

function activeMindmapStorageKey(workspaceId: string | null): string {
  return `moduo:mindmap-active:v1:${workspaceId ?? "global"}`;
}

export function readStoredActiveMindmap(workspaceId: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(activeMindmapStorageKey(workspaceId));
}

export function writeStoredActiveMindmap(workspaceId: string | null, mindmapId: string | null) {
  if (typeof window === "undefined") return;
  const key = activeMindmapStorageKey(workspaceId);
  if (!mindmapId) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, mindmapId);
}
