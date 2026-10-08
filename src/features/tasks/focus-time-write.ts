// The Focus engine's save path for tracked time (TV-F1): it writes only the
// task's time total, never the rest of the row. A whole-row upsert built from a
// task list loaded earlier would put back whatever changed since — a Done or
// Skip still in flight, a rename in another tab. TV-D3 replaces this with time
// entries (`tasks_op_track_time`).

import { supabaseClient } from "../../lib/runtime.web";

export interface SavedTaskTime {
  timeSpentSeconds: number;
  updatedAt: string;
}

/**
 * Set a task's saved time total. Throws when the write fails; null when there's
 * no such row to write (deleted, or no longer visible to you).
 */
export async function writeTaskTimeTotal(
  taskId: string,
  workspaceId: string,
  totalSeconds: number,
): Promise<SavedTaskTime | null> {
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from("tasks")
    .update({ time_spent_seconds: totalSeconds, updated_at: updatedAt })
    .eq("id", taskId)
    .eq("workspace_id", workspaceId)
    .select("time_spent_seconds, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    timeSpentSeconds: data.time_spent_seconds ?? totalSeconds,
    updatedAt: data.updated_at ?? updatedAt,
  };
}
