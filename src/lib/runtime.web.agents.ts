// Agents and imports in the app (Tasks v3 TV-D16, specs/tasks-v3.md §12, §15):
// the reads and ops behind an agent session's line on a task (its hand-back
// summary, "Post as comment", clearing it), "Show my agent work to teammates",
// and the person's import runs (the data export; TV-U18's "Undo this import").
// Sessions themselves reach the app through the shared store
// (`agent_sessions`, RLS); these are what the store doesn't carry.
//
// A database before the migration reads as "no agent work, no imports", and
// the writes say what's missing instead of failing quietly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSession } from "../features/spine/agent-session";
import { agentSessionRowToModel, isMissingFunctionError, isMissingTableError } from "./task-rows";

/** A session as `tasks_agent_sessions` answers it: with its summary when it's yours. */
export type AgentSessionDetail = AgentSession & { mine: boolean; summary: string | null };

/** One import run (your own; nobody reads anyone else's). */
export type ImportRun = {
  id: string;
  source: string;
  label: string | null;
  startedAt: string;
  finishedAt: string | null;
  undoneAt: string | null;
  /** Made by an agent through this key (its id), or by you in the app. */
  keyId: string | null;
};

/** What "Undo this import" did (counts of the run's own rows you can see). */
export type ImportUndoResult = {
  tasksRemoved: number;
  tasksKept: number;
  sectionsRemoved: number;
  projectsRemoved: number;
};

const NOT_READY = "Agent work isn't available on this server yet.";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function createTasksAgents(
  client: SupabaseClient,
  deps: {
    /** The signed-in person's id (the export reads their own sessions). */
    userId: () => Promise<string | null>;
  },
) {
  return {
    /** The sessions on a task you can see, yours with their hand-back summary. */
    async agentSessionsFor(input: {
      workspaceId: string;
      taskId: string;
    }): Promise<AgentSessionDetail[]> {
      const { data, error } = await client.rpc("tasks_agent_sessions", {
        p_workspace_id: input.workspaceId,
        p_task_id: input.taskId,
      });
      if (error) {
        if (isMissingFunctionError(error, "tasks_agent_sessions")) return [];
        throw new Error(error.message);
      }
      return (Array.isArray(data) ? data : []).map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          ...agentSessionRowToModel({ ...row, workspace_id: input.workspaceId }),
          mine: row.mine === true,
          summary: typeof row.summary === "string" ? row.summary : null,
        };
      });
    },

    /** "Post as comment": your session's summary becomes your comment on the task. */
    async postAgentSummary(input: {
      workspaceId: string;
      sessionId: string;
    }): Promise<AgentSession> {
      const { data, error } = await client.rpc("tasks_op_agent_session_post", {
        p_workspace_id: input.workspaceId,
        p_session_id: input.sessionId,
      });
      if (error)
        throw new Error(
          isMissingFunctionError(error, "tasks_op_agent_session_post") ? NOT_READY : error.message,
        );
      return agentSessionRowToModel(data);
    },

    /** Clear your session's line from the task. */
    async dismissAgentSession(input: {
      workspaceId: string;
      sessionId: string;
    }): Promise<AgentSession> {
      const { data, error } = await client.rpc("tasks_op_agent_session_dismiss", {
        p_workspace_id: input.workspaceId,
        p_session_id: input.sessionId,
      });
      if (error)
        throw new Error(
          isMissingFunctionError(error, "tasks_op_agent_session_dismiss")
            ? NOT_READY
            : error.message,
        );
      return agentSessionRowToModel(data);
    },

    /** "Show my agent work to teammates" (off by default). */
    async getAgentWork(): Promise<boolean> {
      const { data, error } = await client.rpc("user_agent_work");
      if (error) {
        if (isMissingFunctionError(error, "user_agent_work")) return false;
        throw new Error(error.message);
      }
      return data === true;
    },

    async setAgentWork(show: boolean): Promise<boolean> {
      const { data, error } = await client.rpc("user_op_set_agent_work", { p_show: show });
      if (error)
        throw new Error(
          isMissingFunctionError(error, "user_op_set_agent_work") ? NOT_READY : error.message,
        );
      return data === true;
    },

    /** Your agent sessions in a workspace (the data export). */
    async listMyAgentSessions(workspaceId: string): Promise<AgentSession[]> {
      const userId = await deps.userId();
      if (!userId) return [];
      const { data, error } = await client
        .from("agent_sessions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(5000);
      if (error) {
        if (isMissingTableError(error, "agent_sessions")) return [];
        throw new Error(error.message);
      }
      return (data ?? []).map(agentSessionRowToModel);
    },

    /** Your import runs in a workspace, newest first (the export; TV-U18's list). */
    async listImports(workspaceId: string): Promise<ImportRun[]> {
      const { data, error } = await client
        .from("imports")
        .select("id, source, label, started_at, finished_at, undone_at, key_id")
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false })
        .limit(1000);
      if (error) {
        if (isMissingTableError(error, "imports")) return [];
        throw new Error(error.message);
      }
      return (data ?? []).map((r) => ({
        id: r.id as string,
        source: r.source as string,
        label: (r.label as string | null) ?? null,
        startedAt: r.started_at as string,
        finishedAt: (r.finished_at as string | null) ?? null,
        undoneAt: (r.undone_at as string | null) ?? null,
        keyId: (r.key_id as string | null) ?? null,
      }));
    },

    /** "Undo this import" (TV-U18 puts it in the app). */
    async undoImport(input: { workspaceId: string; importId: string }): Promise<ImportUndoResult> {
      const { data, error } = await client.rpc("imports_op_undo", {
        p_workspace_id: input.workspaceId,
        p_import_id: input.importId,
      });
      if (error)
        throw new Error(
          isMissingFunctionError(error, "imports_op_undo") ? NOT_READY : error.message,
        );
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        tasksRemoved: num(r.tasks_removed),
        tasksKept: num(r.tasks_kept),
        sectionsRemoved: num(r.sections_removed),
        projectsRemoved: num(r.projects_removed),
      };
    },
  };
}

export type TasksAgentsApi = ReturnType<typeof createTasksAgents>;
