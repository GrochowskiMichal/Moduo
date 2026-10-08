/**
 * Queue runs runtime (TV-F2, specs/tasks-v2.md §3) — Supabase-direct on web
 * and desktop (runtime.tauri delegates here, like chat).
 *
 * Reads are direct SELECTs under RLS (own runs only); writes are the
 * `focus_op_run_*` ops; teammates' "is on this" comes from `focus_claims`.
 * Until 20261009120000_focus_runs reaches the database every call degrades:
 * no run on the server (the run stays on this device), no claims, and Keep all
 * does nothing (gotchas §Supabase: a new RPC on a live path must not break it).
 */

import type { FocusRun, FocusRunRuntime } from "../features/focus/run-model";
import { focusRunRowToModel, runSnapshotToState } from "../features/focus/run-model";
import { mapKnownRows } from "@contracts/rows";
import { supabaseClient } from "./runtime.web";
import {
  isMissingFunctionError,
  isMissingTableError,
  sortQueueEntries,
  taskQueueRowToModel,
} from "./task-rows";

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
    if (isMissingTableError(error, "focus_runs")) return null;
    if (error) throw new Error(error.message);
    return one(data);
  },

  async startRun({ workspaceId, deviceId, mode, state }) {
    const { data, error } = await supabaseClient.rpc("focus_op_run_start", {
      p_workspace_id: workspaceId,
      p_device: deviceId,
      p_mode: mode,
      p_state: runSnapshotToState(state),
    });
    if (isMissingFunctionError(error, "focus_op_run_start")) return null;
    if (error) throw new Error(error.message);
    return one(data);
  },

  async saveRun({ runId, deviceId, take, state }) {
    const { data, error } = await supabaseClient.rpc("focus_op_run_save", {
      p_run_id: runId,
      p_device: deviceId,
      p_take: take,
      p_state: runSnapshotToState(state),
    });
    if (isMissingFunctionError(error, "focus_op_run_save")) return null;
    if (error) throw new Error(error.message);
    return one(data);
  },

  async endRun({ runId, deviceId, state }) {
    const { data, error } = await supabaseClient.rpc("focus_op_run_end", {
      p_run_id: runId,
      p_device: deviceId,
      p_state: runSnapshotToState(state),
    });
    if (isMissingFunctionError(error, "focus_op_run_end")) return null;
    if (error) throw new Error(error.message);
    return one(data);
  },

  async listClaims(workspaceId) {
    const { data, error } = await supabaseClient.rpc("focus_claims", {
      p_workspace_id: workspaceId,
    });
    if (isMissingFunctionError(error, "focus_claims")) return [];
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    return rows.flatMap((r: { user_id?: unknown; task_id?: unknown }) =>
      typeof r.user_id === "string" && typeof r.task_id === "string"
        ? [{ userId: r.user_id, taskId: r.task_id }]
        : [],
    );
  },

  async keepLineUp(workspaceId) {
    const { data, error } = await supabaseClient.rpc("tasks_op_queue_keep", {
      p_workspace_id: workspaceId,
    });
    if (isMissingFunctionError(error, "tasks_op_queue_keep")) return null;
    if (error) throw new Error(error.message);
    return sortQueueEntries(mapKnownRows(Array.isArray(data) ? data : [], taskQueueRowToModel));
  },
};
