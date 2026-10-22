import { habitRowSchema, mapKnownRows, requireRow } from "@contracts/rows";

import { DbError, runQuery } from "./runtime.db";
import type { HabitRow, HabitsRuntime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { getAuthedUser } from "./runtime.web.shared";

/** Map a raw `habits` row to the HabitRow model (DB-7). The client is untyped,
 * so column renames are silent — keep this in lockstep with the migration. */
function mapHabitRow(raw: unknown): HabitRow {
  const r = requireRow(habitRowSchema, raw, "habit");
  return {
    id: r.id as string,
    workspaceId: (r.workspace_id as string) ?? "",
    name: (r.name as string) ?? "",
    emoji: (r.emoji as string) ?? "",
    position: (r.position as string) ?? "",
    checks: Array.isArray(r.checks) ? (r.checks as string[]) : [],
    createdAt: (r.created_at as string) ?? "",
    updatedAt: (r.updated_at as string) ?? "",
  };
}

export const webHabits: HabitsRuntime = {
  async list(workspaceId) {
    const user = await getAuthedUser();
    if (!user) return [];
    const { data, error } = await supabaseClient
      .from("habits")
      .select("id, workspace_id, name, emoji, position, checks, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true });
    if (error) throw new DbError(error);
    return mapKnownRows(data, mapHabitRow);
  },
  async upsert({ id, workspaceId, name, emoji, position }) {
    const user = await getAuthedUser();
    if (!user) throw new Error("Not signed in");
    const row = {
      ...(id ? { id } : {}),
      user_id: user.id,
      workspace_id: workspaceId,
      name,
      emoji,
      position,
      updated_at: new Date().toISOString(),
    };
    const data = await runQuery(
      supabaseClient
        .from("habits")
        .upsert(row)
        .select("id, workspace_id, name, emoji, position, checks, created_at, updated_at")
        .single(),
    );
    return mapHabitRow(data);
  },
  async setChecks({ id, checks }) {
    await runQuery(
      supabaseClient
        .from("habits")
        .update({ checks, updated_at: new Date().toISOString() })
        .eq("id", id),
    );
  },
  async remove(id) {
    await runQuery(supabaseClient.from("habits").delete().eq("id", id));
  },
};
