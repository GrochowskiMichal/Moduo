/**
 * Focus runs runtime (TV-F6, salvaged from #323) — Supabase-direct on web and
 * desktop (runtime.tauri delegates here, like chat).
 *
 * Reads are direct SELECTs under RLS (own runs only); writes are the
 * `focus_op_run_*` ops; teammates' "is on this" comes from `focus_claims`.
 * Errors throw a `DbError` (Postgres's code kept, so a refused start isn't
 * retried).
 */

import { mapKnownRows } from "@contracts/rows";

import type { FocusRun, FocusRunRuntime } from "../features/focus/run-model";
import { focusRunRowToModel, runSnapshotToState } from "../features/focus/run-model";
import { collectTruncations, readPaged } from "./paged-select";
import { DbError, type Json } from "./runtime.db";
import { supabaseClient } from "./runtime.web.client";
import { sortQueueEntries, taskQueueRowToModel } from "./task-rows";

/** The export reads at most this many of my runs per workspace. */
const RUNS_EXPORT_CAP = 10_000;

function one(data: unknown): FocusRun | null {
  return focusRunRowToModel(Array.isArray(data) ? data[0] : data);
}

export const webFocusRuntime: FocusRunRuntime = {
  async latestRun() {
    const { data, error } = await supabaseClient
      .from("focus_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .order("id")
      .limit(1);
    if (error) throw new DbError(error);
    return one(data);
  },

  async startRun({ workspaceId, deviceId, mode, state }) {
    const { data, error } = await supabaseClient.rpc("focus_op_run_start", {
      p_workspace_id: workspaceId,
      p_device: deviceId,
      p_mode: mode,
      p_state: runSnapshotToState(state) as Json,
    });
    if (error) throw new DbError(error);
    return one(data);
  },

  async saveRun({ runId, deviceId, take, state }) {
    const { data, error } = await supabaseClient.rpc("focus_op_run_save", {
      p_run_id: runId,
      p_device: deviceId,
      p_take: take,
      p_state: runSnapshotToState(state) as Json,
    });
    if (error) throw new DbError(error);
    return one(data);
  },

  async endRun({ runId, deviceId, state }) {
    const { data, error } = await supabaseClient.rpc("focus_op_run_end", {
      p_run_id: runId,
      p_device: deviceId,
      p_state: runSnapshotToState(state) as Json,
    });
    if (error) throw new DbError(error);
    return one(data);
  },

  async listClaims(workspaceId) {
    const { data, error } = await supabaseClient.rpc("focus_claims", {
      p_workspace_id: workspaceId,
    });
    if (error) throw new DbError(error);
    const rows = Array.isArray(data) ? data : [];
    return rows.flatMap((r: { user_id?: unknown; task_id?: unknown }) =>
      typeof r.user_id === "string" && typeof r.task_id === "string"
        ? [{ userId: r.user_id, taskId: r.task_id }]
        : [],
    );
  },

  async listMyRuns(workspaceId) {
    // RLS answers only the reader's own runs.
    const build = (opts?: { count: "exact"; head: true }) =>
      supabaseClient.from("focus_runs").select("*", opts).eq("workspace_id", workspaceId);
    const res = await readPaged<Record<string, unknown>, { message: string; code?: string }>({
      scope: "Focus runs",
      cap: RUNS_EXPORT_CAP,
      page: async (offset, limit) => {
        const { data, error } = await build()
          .order("started_at", { ascending: false })
          .order("id")
          .range(offset, offset + limit - 1);
        return { data: (data ?? null) as Record<string, unknown>[] | null, error };
      },
      countTotal: async () => {
        const { count, error } = await build({ count: "exact", head: true });
        return error ? null : (count ?? null);
      },
      keyOf: (row) => String(row.id),
    });
    if (res.error) throw new DbError(res.error);
    return {
      runs: res.rows.flatMap((row) => {
        const run = focusRunRowToModel(row);
        return run ? [run] : [];
      }),
      truncated: collectTruncations(res.truncation),
    };
  },

  async giveBackTime({ workspaceId, taskId, seconds, key, runId }) {
    if (!Number.isFinite(seconds) || seconds < 1) return;
    const base = {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_action: "adjust",
      p_seconds: -Math.round(seconds),
      p_client_key: key,
    };
    // TV-D14: the entry says it's a give-back, from which run.
    const { error } = await supabaseClient.rpc("tasks_op_track_time", {
      ...base,
      p_reason: "give_back",
      ...(runId ? { p_run_id: runId } : {}),
    });
    if (error) throw new DbError(error);
  },

  async keepLineUp(workspaceId) {
    const { data, error } = await supabaseClient.rpc("tasks_op_queue_keep", {
      p_workspace_id: workspaceId,
    });
    if (error) throw new DbError(error);
    return sortQueueEntries(mapKnownRows(Array.isArray(data) ? data : [], taskQueueRowToModel));
  },
};
