// Making things from templates, and "Duplicate project…" (TV-D15), through
// the shared store: one `store.begin` for the whole copy (the new project
// shows in the sidebar at once), then one `settle` with every row the server
// made — the project, its statuses and sections, the tasks, their tags and
// dependencies — so every surface redraws once (gotchas/spine.md). The ids
// are minted here, so sending again after a lost answer makes nothing twice.
//
// Plain functions over a runtime and a store, not a hook: the Tasks page,
// capture's `/template` and a later "copy into N workspaces" all call them.

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { TemplateApplyResult } from "../../../lib/runtime.web.templates";
import { isNetworkError } from "../../../lib/sync/network";
import type { WorkspaceStore } from "../../../lib/sync/store";
import { endPosition } from "../helpers";
import type { Bucket } from "../model";

export type CopyDeps = {
  runtime: ModuoRuntime;
  store: WorkspaceStore;
  workspaceId: string;
  userId: string;
};

export type CopyOutcome =
  | { ok: true; projectId: string | null; taskIds: string[]; result: TemplateApplyResult }
  | { ok: false; offline: boolean; message: string };

export function newCopyId(): string {
  return crypto.randomUUID();
}

function optimisticProject(
  deps: CopyDeps,
  id: string,
  name: string,
  areaId: string | null,
): Bucket {
  const now = new Date().toISOString();
  const bundle = deps.store.getSnapshot().bundle;
  const all = [...(bundle.buckets ?? []), ...(bundle.archivedBuckets ?? [])];
  return {
    id,
    workspaceId: deps.workspaceId,
    ownerId: deps.userId,
    name,
    isSystem: false,
    group: null,
    position: endPosition(all.filter((b) => !b.deletedAt)),
    areaId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function outcomeOf(result: TemplateApplyResult): CopyOutcome {
  return {
    ok: true,
    projectId: result.buckets[0]?.id ?? null,
    taskIds: result.tasks.map((t) => t.id),
    result,
  };
}

function failure(deps: CopyDeps, e: unknown, fallback: string): CopyOutcome {
  if (isNetworkError(e)) {
    deps.store.wentOffline();
    return { ok: false, offline: true, message: "You're offline. Try again once you're back." };
  }
  return { ok: false, offline: false, message: e instanceof Error ? e.message : fallback };
}

/** A new project from a live one or a project template: shown at once, settled whole. */
async function copyProject(
  deps: CopyDeps,
  input: { id: string; name: string; areaId: string | null },
  send: () => Promise<TemplateApplyResult>,
  fallback: string,
): Promise<CopyOutcome> {
  if (deps.store.isOffline()) {
    return { ok: false, offline: true, message: "You're offline. Try again once you're back." };
  }
  const write = deps.store.begin([
    { table: "buckets", insert: optimisticProject(deps, input.id, input.name, input.areaId) },
  ]);
  try {
    const result = await send();
    write.settle(result);
    return outcomeOf(result);
  } catch (e) {
    write.fail();
    return failure(deps, e, fallback);
  }
}

export type ProjectCopyChoice = {
  /** Mint with `newCopyId()` once per attempt; a retry sends the same. */
  id: string;
  name: string;
  /** YYYY-MM-DD; null = no dates. */
  startsOn: string | null;
  areaId: string | null;
  keepPeople: boolean;
};

/** "Duplicate project…". */
export function duplicateProject(
  deps: CopyDeps,
  projectId: string,
  choice: ProjectCopyChoice,
): Promise<CopyOutcome> {
  const op = deps.runtime.tasks.duplicateProject;
  if (!op) {
    return Promise.resolve({
      ok: false,
      offline: false,
      message: "Duplicating needs a newer app.",
    });
  }
  return copyProject(
    deps,
    choice,
    () =>
      op({
        workspaceId: deps.workspaceId,
        projectId,
        id: choice.id,
        name: choice.name,
        startsOn: choice.startsOn,
        areaId: choice.areaId,
        keepPeople: choice.keepPeople,
      }),
    "Couldn't duplicate the project.",
  );
}

/** "New project → From template…". */
export function applyProjectTemplate(
  deps: CopyDeps,
  templateId: string,
  choice: ProjectCopyChoice,
): Promise<CopyOutcome> {
  const op = deps.runtime.tasks.applyProjectTemplate;
  if (!op) {
    return Promise.resolve({ ok: false, offline: false, message: "Templates need a newer app." });
  }
  return copyProject(
    deps,
    choice,
    () =>
      op({
        workspaceId: deps.workspaceId,
        templateId,
        id: choice.id,
        name: choice.name,
        startsOn: choice.startsOn,
        areaId: choice.areaId,
        keepPeople: choice.keepPeople,
      }),
    "Couldn't make the project.",
  );
}

export type TaskTemplateChoice = {
  /** The new task's id: mint with `newCopyId()` once per attempt. */
  id: string;
  title?: string;
  /** Omitted: the template's project (or your Inbox). null: your Inbox. */
  projectId?: string | null;
  sectionId?: string | null;
  /** YYYY-MM-DD its dates count from; null = no dates. */
  date: string | null;
  /** Omitted: the template's own. */
  assigneeId?: string | null;
};

/** "From template…" for a task (capture's `/template`, New → From template…). */
export async function applyTaskTemplate(
  deps: CopyDeps,
  templateId: string,
  choice: TaskTemplateChoice,
): Promise<CopyOutcome> {
  const op = deps.runtime.tasks.applyTaskTemplate;
  if (!op) return { ok: false, offline: false, message: "Templates need a newer app." };
  if (deps.store.isOffline()) {
    return { ok: false, offline: true, message: "You're offline. Try again once you're back." };
  }
  // Nothing to show before the answer (the tasks' fields come from the
  // template on the server); the begin keeps the copy's settle in one step.
  const write = deps.store.begin([]);
  try {
    const result = await op({ workspaceId: deps.workspaceId, templateId, ...choice });
    write.settle(result);
    return outcomeOf(result);
  } catch (e) {
    write.fail();
    return failure(deps, e, "Couldn't make the task.");
  }
}
