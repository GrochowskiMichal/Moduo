// Saved views (TV-U8): reads under the table's row-level security (your own
// views, and the ones shared with you), every write an op. The shared store
// reads `task_views` whole on each sync (SYNC_SOURCES.views in
// runtime.web.ts); these are the ops it settles.

import type { TaskViewScope } from "@contracts/vocabularies";
import type { FilterCondition } from "../components/ui/filter-model";
import type { TasksDisplay } from "../features/tasks/display";
import { type TaskView, taskViewFromRow } from "../features/tasks/view-row";
import { type Db, untypedDb } from "./runtime.db";

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

export type CreateViewInput = {
  workspaceId: string;
  /** Minted by the app: a resend makes nothing twice. */
  id: string;
  name: string;
  scope: TaskViewScope;
  projectId?: string | null;
  filters: FilterCondition[];
  display: Partial<TasksDisplay>;
  shared?: boolean;
  /** An onboarding preset's key: the server makes each once per person. */
  seed?: string;
};

export type ViewPatch = {
  name?: string;
  filters?: FilterCondition[];
  display?: Partial<TasksDisplay>;
  shared?: boolean;
  deleted?: boolean;
};

function fail(error: { code?: string; message?: string }): never {
  throw new Error(error.message ?? "The view didn't save.");
}

function oneView(raw: unknown): TaskView {
  const view = taskViewFromRow(raw);
  if (!view) throw new Error("The view didn't save.");
  return view;
}

export function createTasksViews(client: Db) {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    // `name` is one of the task_views_op_* ops; the call is untyped (runtime.db.ts).
    const { data, error } = (await untypedDb(client).rpc(name, args)) as Answer;
    if (error) fail(error);
    return data;
  }

  return {
    /** Save a view (yours; shared only when asked). Answers with the view. */
    async createView(input: CreateViewInput): Promise<TaskView> {
      return oneView(
        await rpc("task_views_op_create", {
          p_workspace_id: input.workspaceId,
          p_fields: {
            id: input.id,
            name: input.name,
            scope: input.scope,
            ...(input.scope === "project" ? { project_id: input.projectId ?? null } : {}),
            filters: input.filters,
            display: input.display,
            ...(input.shared !== undefined ? { shared: input.shared } : {}),
            ...(input.seed ? { seed: input.seed } : {}),
          },
        }),
      );
    },

    /** Rename, save its Filter and Display, share or unshare, delete or restore. */
    async updateView(input: {
      workspaceId: string;
      viewId: string;
      patch: ViewPatch;
    }): Promise<TaskView> {
      return oneView(
        await rpc("task_views_op_update", {
          p_workspace_id: input.workspaceId,
          p_view_id: input.viewId,
          p_patch: input.patch,
        }),
      );
    },

    /** Move one of your views a place up or down; answers with your views here. */
    async moveView(input: {
      workspaceId: string;
      viewId: string;
      direction: "up" | "down";
    }): Promise<TaskView[]> {
      const data = await rpc("task_views_op_move", {
        p_workspace_id: input.workspaceId,
        p_view_id: input.viewId,
        p_direction: input.direction,
      });
      return (Array.isArray(data) ? data : []).flatMap((row) => {
        const view = taskViewFromRow(row);
        return view ? [view] : [];
      });
    },
  };
}

export type TasksViewsApi = ReturnType<typeof createTasksViews>;
