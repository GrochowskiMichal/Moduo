import {
  entityTypeKeyModule,
  keyCanSeeEntityType,
  MCP_KEY_MODULE_LABELS,
} from "../_shared/contracts/mcp-key-scopes.ts";
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

/** Where each entity type an agent can point at lives (link endpoints,
 * comment targets). Any other type is out of reach for keys. */
const ENTITY_TABLES: Readonly<Record<string, string>> = {
  task: "tasks",
  bucket: "buckets",
  note: "notes",
  contact: "contacts",
  company: "companies",
  event: "calendar_events",
  email_thread: "email_refs",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Can this key reach one entity? The key needs at least View on the entity's
 * module, the entity must be live in the key's workspace, and the key's
 * creator must be able to open it (perm_can_see_entity: per-item sharing and
 * the owner-only types). The ops themselves only guard the module.
 */
export async function canReach(ctx: ToolContext, type: string, id: string): Promise<boolean> {
  const table = ENTITY_TABLES[type];
  if (!table || !UUID.test(id) || !keyCanSeeEntityType(ctx.key.scopes, type)) return false;
  const { data, error } = await ctx.db
    .from(table)
    .select("id")
    .eq("workspace_id", ctx.key.workspaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) return false;
  const seen = await ctx.db.rpc("perm_can_see_entity", {
    p_workspace_id: ctx.key.workspaceId,
    p_type: type,
    p_id: id,
  });
  if (seen.error) throw new Error(seen.error.message);
  return seen.data === true;
}

/** Throws unless the key can reach the entity. A private item reads as not
 * found, so the error never confirms that it exists. */
export async function assertReach(ctx: ToolContext, type: string, id: string): Promise<void> {
  const module = entityTypeKeyModule(type);
  if (!module || !ENTITY_TABLES[type]) {
    throw new Error(`Agents can't work with "${type}" items.`);
  }
  if (!keyCanSeeEntityType(ctx.key.scopes, type)) {
    throw new Error(`This API key has no access to ${MCP_KEY_MODULE_LABELS[module]}.`);
  }
  if (!(await canReach(ctx, type, id))) {
    throw new Error(`No ${type.replace("_", " ")} with that id in this workspace.`);
  }
}

/** Throws unless the key can see both endpoints' modules (a link's two ends). */
export function assertLinkInScope(ctx: ToolContext, link: Record<string, unknown>): void {
  for (const type of [link.source_type, link.target_type]) {
    if (typeof type !== "string" || !keyCanSeeEntityType(ctx.key.scopes, type)) {
      const module = typeof type === "string" ? entityTypeKeyModule(type) : null;
      throw new Error(
        module
          ? `This API key has no access to ${MCP_KEY_MODULE_LABELS[module]}, which this link touches.`
          : "This link touches something agents can't work with.",
      );
    }
  }
}

/** A live link in the key's workspace whose two ends the key can see — or
 * throws. A link that is gone (or was never here) passes: the op answers it
 * (delete is idempotent). An id that isn't a canonical uuid throws: Postgres
 * also reads other spellings (no hyphens, braces), which this lookup would
 * miss and the op would still find. */
export async function assertLiveLinkInScope(ctx: ToolContext, linkId: string): Promise<void> {
  if (!UUID.test(linkId)) throw new Error("No link with that id in this workspace.");
  const { data, error } = await ctx.db
    .from("entity_links")
    .select("id, source_type, target_type")
    .eq("workspace_id", ctx.key.workspaceId)
    .eq("id", linkId)
    .is("deleted_at", null)
    .limit(1);
  if (error) throw new Error(error.message);
  if (data?.[0]) assertLinkInScope(ctx, data[0] as Record<string, unknown>);
}

/** Links with both ends in modules the key can see (the rest are dropped). */
export function linksInScope<T extends Record<string, unknown>>(ctx: ToolContext, links: T[]): T[] {
  return links.filter(
    (l) =>
      typeof l.source_type === "string" &&
      typeof l.target_type === "string" &&
      keyCanSeeEntityType(ctx.key.scopes, l.source_type) &&
      keyCanSeeEntityType(ctx.key.scopes, l.target_type),
  );
}
