// Agents and imports in the app (Tasks v3 TV-D16, specs/tasks-v3.md §12, §15):
// the reads and ops behind an agent session's line on a task (its hand-back
// summary, "Post as comment", clearing it), "Show your agent work to teammates",
// and the person's import runs (the data export; TV-U18's "Undo this import").
// Sessions themselves reach the app through the shared store
// (`agent_sessions`, RLS); these are what the store doesn't carry.

import {
  type ImportEntityType,
  type ImportRowAction,
  normalizeImportEntityType,
  normalizeImportRowAction,
} from "@contracts/vocabularies";

import type { AgentSession } from "../features/spine/agent-session";
import { collectTruncations, READ_CAPS, readPaged, type Truncation } from "./paged-select";
import { type Db, DbError, type Json, runRpc, untypedDb } from "./runtime.db";
import { agentSessionRowToModel } from "./task-rows";

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
  /** What the run made or updated. */
  rows: Array<{
    entityType: ImportEntityType;
    entityId: string;
    action: ImportRowAction;
    loggedAt: string;
  }>;
};

/** What "Undo this import" did (counts of the run's own rows you can see). */
export type ImportUndoResult = {
  tasksRemoved: number;
  tasksKept: number;
  sectionsRemoved: number;
  projectsRemoved: number;
};

/** What a finished run made, counted by the server (only what you can see). */
export type ImportRunCounts = {
  tasksCreated: number;
  tasksUpdated: number;
  projectsCreated: number;
  sectionsCreated: number;
};

/** The export reads every run (a person makes few) and every row they made. */
const IMPORT_RUNS_CAP = 2000;
const IMPORT_ROWS_CAP = 100000;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

type Row = Record<string, unknown>;

/**
 * One of your own tables read in full, in pages past the server's 1,000-row
 * answers, ordered by a unique column so pages never skip or repeat; a read
 * cut at `cap` says so.
 */
async function pagedRows(
  client: Db,
  table: string,
  opts: {
    scope: string;
    cap: number;
    select: string;
    filter: Record<string, string>;
    /** Unique column to page by (default `id`). */
    orderBy?: string;
  },
): Promise<{ rows: Row[]; truncation: Truncation | null }> {
  const build = (head?: { count: "exact"; head: true }) => {
    // The table is the caller's pick, so this read is untyped (runtime.db.ts).
    let q = untypedDb(client).from(table).select(opts.select, head);
    for (const [col, value] of Object.entries(opts.filter)) q = q.eq(col, value);
    return q;
  };
  const res = await readPaged<Row, { message: string; code?: string }>({
    scope: opts.scope,
    cap: opts.cap,
    page: async (offset, limit) => {
      const { data, error } = await build()
        .order(opts.orderBy ?? "id")
        .range(offset, offset + limit - 1);
      return { data: (data ?? null) as Row[] | null, error };
    },
    countTotal: async () => {
      const { count, error } = await build({ count: "exact", head: true });
      return error ? null : (count ?? null);
    },
    keyOf: (row) => String(row[opts.orderBy ?? "id"]),
  });
  if (res.error) throw new DbError(res.error);
  return { rows: res.rows, truncation: res.truncation };
}

export function createTasksAgents(
  client: Db,
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
      const data = await runRpc(
        client.rpc("tasks_agent_sessions", {
          p_workspace_id: input.workspaceId,
          p_task_id: input.taskId,
        }),
      );
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
      const data = await runRpc(
        client.rpc("tasks_op_agent_session_post", {
          p_workspace_id: input.workspaceId,
          p_session_id: input.sessionId,
        }),
      );
      return agentSessionRowToModel(data);
    },

    /** Clear your session's line from the task. */
    async dismissAgentSession(input: {
      workspaceId: string;
      sessionId: string;
    }): Promise<AgentSession> {
      const data = await runRpc(
        client.rpc("tasks_op_agent_session_dismiss", {
          p_workspace_id: input.workspaceId,
          p_session_id: input.sessionId,
        }),
      );
      return agentSessionRowToModel(data);
    },

    /** "Show your agent work to teammates" (off by default). */
    async getAgentWork(): Promise<boolean> {
      const data = await runRpc(client.rpc("user_agent_work"));
      return data === true;
    },

    async setAgentWork(show: boolean): Promise<boolean> {
      const data = await runRpc(client.rpc("user_op_set_agent_work", { p_show: show }));
      return data === true;
    },

    /**
     * Your agent sessions in a workspace, with your hand-back summaries (the
     * data export). Paged past the server's 1,000-row answers; a cut read
     * says so in `truncated`.
     */
    async listMyAgentSessions(workspaceId: string): Promise<{
      sessions: Array<AgentSession & { summary: string | null }>;
      truncated: Truncation[];
    }> {
      const userId = await deps.userId();
      if (!userId) return { sessions: [], truncated: [] };
      const read = await pagedRows(client, "agent_sessions", {
        scope: "agent sessions",
        cap: READ_CAPS.agentSessions,
        select: "*",
        filter: { workspace_id: workspaceId, user_id: userId },
      });
      const sessions = read.rows
        .map(agentSessionRowToModel)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      // Your hand-back summaries ride along (RLS: only yours).
      const summaries = new Map<string, string>();
      let summaryCut: Truncation | null = null;
      if (sessions.length) {
        const res = await pagedRows(client, "agent_session_summaries", {
          scope: "agent session summaries",
          cap: READ_CAPS.agentSessions,
          select: "session_id, summary",
          filter: { workspace_id: workspaceId, user_id: userId },
          orderBy: "session_id",
        });
        for (const r of res.rows) summaries.set(r.session_id as string, r.summary as string);
        summaryCut = res.truncation;
      }
      return {
        sessions: sessions.map((s) => ({ ...s, summary: summaries.get(s.id) ?? null })),
        truncated: collectTruncations(read.truncation, summaryCut),
      };
    },

    /**
     * Your import runs in a workspace, newest first, with what each made or
     * updated (the export; TV-U18's list). Paged like the sessions.
     */
    async listImports(
      workspaceId: string,
    ): Promise<{ imports: ImportRun[]; truncated: Truncation[] }> {
      const read = await pagedRows(client, "imports", {
        scope: "import runs",
        cap: IMPORT_RUNS_CAP,
        select: "id, source, label, started_at, finished_at, undone_at, key_id",
        filter: { workspace_id: workspaceId },
      });
      const runs = [...read.rows].sort((a, b) =>
        String(a.started_at) < String(b.started_at) ? 1 : -1,
      );
      // What each run made or updated (RLS: only your runs' rows).
      const rowsByRun = new Map<string, ImportRun["rows"]>();
      let rowsCut: Truncation | null = null;
      if (runs.length) {
        const res = await pagedRows(client, "import_rows", {
          scope: "imported rows",
          cap: IMPORT_ROWS_CAP,
          select: "id, import_id, entity_type, entity_id, action, logged_at",
          filter: { workspace_id: workspaceId },
        });
        rowsCut = res.truncation;
        for (const r of res.rows) {
          const type = normalizeImportEntityType(r.entity_type);
          if (!type) continue;
          const list = rowsByRun.get(r.import_id as string) ?? [];
          list.push({
            entityType: type,
            entityId: r.entity_id as string,
            action: normalizeImportRowAction(r.action),
            loggedAt: r.logged_at as string,
          });
          rowsByRun.set(r.import_id as string, list);
        }
      }
      return {
        imports: runs.map((r) => ({
          id: r.id as string,
          source: r.source as string,
          label: (r.label as string | null) ?? null,
          startedAt: r.started_at as string,
          finishedAt: (r.finished_at as string | null) ?? null,
          undoneAt: (r.undone_at as string | null) ?? null,
          keyId: (r.key_id as string | null) ?? null,
          rows: rowsByRun.get(r.id as string) ?? [],
        })),
        truncated: collectTruncations(read.truncation, rowsCut),
      };
    },

    // ── The native importers' writes (TV-U18): the same engine as MCP ──────

    /** Begin a run (`imports_op_begin`); answers its id. */
    async beginImport(input: {
      workspaceId: string;
      source: string;
      label: string;
    }): Promise<{ id: string }> {
      const data = await runRpc(
        client.rpc("imports_op_begin", {
          p_workspace_id: input.workspaceId,
          p_source: input.source,
          p_label: input.label,
        }),
      );
      return { id: String((data as Row | null)?.id ?? "") };
    },

    /** A project the run makes and records (`imports_op_project_create`). */
    async createImportProject(input: {
      workspaceId: string;
      importId: string;
      project: { id: string; name: string; description?: string };
    }): Promise<{ id: string; name: string }> {
      const data = await runRpc(
        client.rpc("imports_op_project_create", {
          p_workspace_id: input.workspaceId,
          p_import_id: input.importId,
          p_project: input.project,
        }),
      );
      const row = (data ?? {}) as Row;
      return {
        id: String(row.id ?? input.project.id),
        name: String(row.name ?? input.project.name),
      };
    },

    /** A section the run makes and records (`imports_op_section_create`). */
    async createImportSection(input: {
      workspaceId: string;
      importId: string;
      projectId: string;
      section: { id: string; name: string };
    }): Promise<{ id: string }> {
      await runRpc(
        client.rpc("imports_op_section_create", {
          p_workspace_id: input.workspaceId,
          p_import_id: input.importId,
          p_project_id: input.projectId,
          p_section: input.section,
        }),
      );
      return { id: input.section.id };
    },

    /**
     * One task of the run with its tags (`tasks_op_create_with`): a key you
     * already used on a live task of yours updates that task instead.
     */
    async createImportTask(input: {
      workspaceId: string;
      importId: string;
      task: Record<string, unknown>;
      tags?: string[];
    }): Promise<{ action: "created" | "updated" | "existing"; id: string }> {
      const data = await runRpc(
        client.rpc("tasks_op_create_with", {
          p_workspace_id: input.workspaceId,
          p_task: input.task as Json,
          p_with: {
            import_id: input.importId,
            ...(input.tags?.length ? { tags: input.tags } : {}),
          },
        }),
      );
      const row = (data ?? {}) as Row;
      const action = row.action === "updated" || row.action === "existing" ? row.action : "created";
      return { action, id: String((row.task as Row | undefined)?.id ?? input.task.id ?? "") };
    },

    /** Finish a run (`imports_op_finish`): what it made, counted by the server. */
    async finishImport(input: { workspaceId: string; importId: string }): Promise<ImportRunCounts> {
      const data = await runRpc(
        client.rpc("imports_op_finish", {
          p_workspace_id: input.workspaceId,
          p_import_id: input.importId,
        }),
      );
      const r = (data ?? {}) as Row;
      return {
        tasksCreated: num(r.tasks_created),
        tasksUpdated: num(r.tasks_updated),
        projectsCreated: num(r.projects_created),
        sectionsCreated: num(r.sections_created),
      };
    },

    /** "Undo this import" (TV-U18 puts it in the app). */
    async undoImport(input: { workspaceId: string; importId: string }): Promise<ImportUndoResult> {
      const data = await runRpc(
        client.rpc("imports_op_undo", {
          p_workspace_id: input.workspaceId,
          p_import_id: input.importId,
        }),
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
