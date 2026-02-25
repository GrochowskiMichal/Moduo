import type { ModuoRuntime } from "../../../lib/runtime";
import type { BrainstormDocument, BrainstormEdge, BrainstormEntry, BrainstormViewOption } from "../types";

export type BrainstormOption = BrainstormViewOption;

const NAMESPACE = "brainstorm:v1";

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function listKey(workspaceId: string): string {
  return `list:${workspaceId}`;
}

function docKey(workspaceId: string, viewId: string): string {
  return `doc:${workspaceId}:${viewId}`;
}

function normalize(raw: any, workspaceId: string): BrainstormOption | null {
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    workspaceId: String(raw.workspaceId ?? workspaceId),
    ownerId: String(raw.ownerId ?? ""),
    name: String(raw.name ?? "Untitled Brainstorm"),
    position: String(raw.position ?? `m${Date.now().toString(36)}`),
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso()),
    deletedAt: raw.deletedAt ? String(raw.deletedAt) : null,
  };
}

async function writeList(runtime: ModuoRuntime, workspaceId: string, items: BrainstormOption[]) {
  await runtime.localStore.set(NAMESPACE, listKey(workspaceId), items);
}

function normalizeEntry(raw: any): BrainstormEntry | null {
  if (!raw?.id || !raw?.templateId) return null;
  const fieldsRaw = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  const fields = Object.fromEntries(
    Object.entries(fieldsRaw).map(([key, value]) => [String(key), typeof value === "string" ? value : String(value ?? "")])
  );
  const positionRaw = raw.position;
  const hasPosition =
    positionRaw &&
    typeof positionRaw === "object" &&
    Number.isFinite((positionRaw as any).x) &&
    Number.isFinite((positionRaw as any).y);
  return {
    id: String(raw.id),
    templateId: String(raw.templateId),
    name: String(raw.name ?? "Untitled Entry"),
    fields,
    position: hasPosition ? { x: Number((positionRaw as any).x), y: Number((positionRaw as any).y) } : undefined,
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso()),
  };
}

function normalizeEdge(raw: any): BrainstormEdge | null {
  if (!raw?.id || !raw?.source || !raw?.target) return null;
  return {
    id: String(raw.id),
    source: String(raw.source),
    target: String(raw.target),
  };
}

export async function listBrainstorms(runtime: ModuoRuntime, workspaceId: string): Promise<BrainstormOption[]> {
  const raw = await runtime.localStore.get(NAMESPACE, listKey(workspaceId));
  const parsed = Array.isArray(raw) ? raw : [];
  return parsed
    .map((entry) => normalize(entry, workspaceId))
    .filter((entry): entry is BrainstormOption => !!entry && !entry.deletedAt)
    .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
}

export async function createBrainstorm(
  runtime: ModuoRuntime,
  input: { workspaceId: string; ownerId: string; name?: string }
): Promise<BrainstormOption> {
  const existing = await listBrainstorms(runtime, input.workspaceId);
  const timestamp = nowIso();
  const view: BrainstormOption = {
    id: safeId(),
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    name: input.name?.trim() || "New Brainstorm",
    position: `m${Date.now().toString(36)}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await writeList(runtime, input.workspaceId, [...existing, view]);
  await runtime.localStore.set(NAMESPACE, docKey(input.workspaceId, view.id), {
    entries: [],
    edges: [],
    updatedAt: timestamp,
  } satisfies BrainstormDocument);
  return view;
}

export async function deleteBrainstorm(runtime: ModuoRuntime, workspaceId: string, viewId: string) {
  const existing = await listBrainstorms(runtime, workspaceId);
  await writeList(runtime, workspaceId, existing.filter((item) => item.id !== viewId));
  await runtime.localStore.remove(NAMESPACE, docKey(workspaceId, viewId));
}

export async function loadBrainstormDocument(
  runtime: ModuoRuntime,
  workspaceId: string,
  viewId: string
): Promise<BrainstormDocument | null> {
  const raw = await runtime.localStore.get(NAMESPACE, docKey(workspaceId, viewId));
  if (!raw || typeof raw !== "object") return null;
  return {
    entries: (Array.isArray((raw as any).entries) ? (raw as any).entries : [])
      .map((entry: unknown) => normalizeEntry(entry))
      .filter((entry: BrainstormEntry | null): entry is BrainstormEntry => !!entry),
    edges: (Array.isArray((raw as any).edges) ? (raw as any).edges : [])
      .map((edge: unknown) => normalizeEdge(edge))
      .filter((edge: BrainstormEdge | null): edge is BrainstormEdge => !!edge),
    updatedAt: typeof (raw as any).updatedAt === "string" ? (raw as any).updatedAt : nowIso(),
  };
}

export async function saveBrainstormDocument(
  runtime: ModuoRuntime,
  workspaceId: string,
  viewId: string,
  document: BrainstormDocument
) {
  await runtime.localStore.set(NAMESPACE, docKey(workspaceId, viewId), document);
}

function activeViewStorageKey(workspaceId: string | null): string {
  return `moduo:brainstorm-active:v1:${workspaceId ?? "global"}`;
}

export function readStoredActiveBrainstorm(workspaceId: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(activeViewStorageKey(workspaceId));
}

export function writeStoredActiveBrainstorm(workspaceId: string | null, viewId: string | null) {
  if (typeof window === "undefined") return;
  const key = activeViewStorageKey(workspaceId);
  if (!viewId) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, viewId);
}
