import type { ToolContext } from "./registry.ts";

/** Ids of this type the key's creator can view. Service role bypasses RLS, so
 * every MCP read has to pass through this. */
export async function visibleIds(ctx: ToolContext, resourceType: string): Promise<Set<string>> {
  const { data, error } = await ctx.db.rpc("share_visible_ids", {
    p_workspace_id: ctx.key.workspaceId,
    p_resource_type: resourceType,
  });
  if (error) throw new Error(error.message);
  return new Set((data ?? []) as string[]);
}
