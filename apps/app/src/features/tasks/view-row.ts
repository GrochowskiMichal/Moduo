// A saved view as the app holds it (TV-U8), and how a `task_views` row reads
// into it. Kept apart from views.ts so the runtime and the store can read
// rows without the page's Display rules.

import { normalizeTaskViewScope, type TaskViewScope } from "@contracts/vocabularies";

export type TaskView = {
  id: string;
  workspaceId: string;
  /** Who made it: only they change it. */
  ownerId: string;
  name: string;
  scope: TaskViewScope;
  /** A project view's project. */
  projectId: string | null;
  /** As stored; read through `viewPrefsOf`, which drops what it doesn't know. */
  filters: unknown;
  display: unknown;
  /** Shared with the workspace (everyone who can see its project, for a project view). */
  shared: boolean;
  position: number;
  /** The onboarding preset it was made from, if any. */
  seed: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const asString = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A `task_views` row as the app's model; null when it can't be read. */
export function taskViewFromRow(raw: unknown): TaskView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id);
  const workspaceId = asString(r.workspace_id);
  const ownerId = asString(r.owner_id);
  const name = asString(r.name);
  const scope = normalizeTaskViewScope(r.scope);
  const projectId = asString(r.project_id);
  if (!id || !workspaceId || !ownerId || !name || !scope) return null;
  if (scope === "project" && !projectId) return null;
  const position = typeof r.position === "number" ? r.position : Number(r.position);
  return {
    id,
    workspaceId,
    ownerId,
    name,
    scope,
    projectId: scope === "project" ? projectId : null,
    filters: r.filters ?? [],
    display: r.display ?? {},
    shared: r.shared === true,
    position: Number.isFinite(position) ? position : 0,
    seed: asString(r.seed),
    createdAt: asString(r.created_at) ?? "",
    updatedAt: asString(r.updated_at) ?? "",
    deletedAt: asString(r.deleted_at),
  };
}
