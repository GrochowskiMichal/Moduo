/**
 * How an agent names a task: its uuid, or its handle (`MOD-142`, TV-D8: the
 * workspace's task key + the task's number). Shared by the Tasks tools
 * (tasks-helpers.ts) and every tool that points at an entity (share.ts's
 * assertReach: link ends, comment targets), so a handle works wherever a task
 * id does (MOD-112). Its own file because tasks-helpers.ts imports share.ts.
 */

import type { ToolContext } from "./registry.ts";

/** The answer for a task that's hidden from the key's person or not there. */
export const TASK_NOT_FOUND = "Task not found in this workspace.";

/** A task's handle, `MOD-142` (TV-D8: the workspace's key + the task's number). */
export const HANDLE = /^([A-Za-z]{2,5})-(\d{1,9})$/;

/** The workspace's task key (TV-D8), or null before that migration. */
export async function workspaceTaskKey(ctx: ToolContext): Promise<string | null> {
  const { data, error } = await ctx.db.from("workspaces").select("task_key")
    .eq("id", ctx.key.workspaceId).maybeSingle();
  if (error) return null;
  return typeof data?.task_key === "string" ? data.task_key : null;
}

/**
 * A task's id from what an agent sends: its uuid or its handle (`MOD-142`,
 * TV-D8; any case). Anything else, or a handle of a task that isn't there,
 * reads as not found. Visibility is the caller's check (fetchTask, canReach).
 */
export async function resolveTaskRef(ctx: ToolContext, ref: string): Promise<string> {
  const value = ref.trim();
  const handle = value.match(HANDLE);
  // Not a handle: an id, checked by the lookup that follows.
  if (!handle) return value;
  const key = await workspaceTaskKey(ctx);
  if (!key || key.toUpperCase() !== handle[1]!.toUpperCase()) throw new Error(TASK_NOT_FOUND);
  const { data, error } = await ctx.db.from("tasks").select("id")
    .eq("workspace_id", ctx.key.workspaceId).eq("number", Number(handle[2])).is("deleted_at", null)
    .limit(1);
  if (error) throw new Error(error.message);
  const found = (data ?? []) as { id: string }[];
  if (!found.length) throw new Error(TASK_NOT_FOUND);
  return found[0]!.id;
}
