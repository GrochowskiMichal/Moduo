import { commentsInOrder } from "../_shared/tasks-connector.ts";
import {
  entityTypeKeyModule,
  keyCanSeeEntityType,
  MCP_KEY_MODULE_LABELS,
} from "../_shared/contracts/mcp-key-scopes.ts";
import type { ToolContext } from "./registry.ts";
import { resolveTaskRef, TASK_NOT_FOUND } from "./task-ref.ts";

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
  const table = Object.hasOwn(ENTITY_TABLES, type) ? ENTITY_TABLES[type] : undefined;
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

/**
 * Throws unless the key can reach the entity, and answers its uuid: a task
 * can be named by its handle too (MOD-142), as in the Tasks tools (MOD-112).
 * Pass the answer to the op, never the agent's own spelling. A private item
 * reads as not found, so the error never confirms that it exists.
 */
export async function assertReach(ctx: ToolContext, type: string, ref: string): Promise<string> {
  const module = entityTypeKeyModule(type);
  if (!module || !Object.hasOwn(ENTITY_TABLES, type)) {
    throw new Error(`Agents can't work with "${type}" items.`);
  }
  if (!keyCanSeeEntityType(ctx.key.scopes, type)) {
    throw new Error(`This API key has no access to ${MCP_KEY_MODULE_LABELS[module]}.`);
  }
  const id = await reachOrNull(ctx, type, ref);
  if (id === null) throw new Error(`No ${type.replace("_", " ")} with that id in this workspace.`);
  return id;
}

/**
 * assertReach's check, answering null for every refusal (a type agents can't
 * point at, a module outside the key, an item that isn't there or that its
 * person can't see) and throwing only when the lookup itself fails, so a
 * passing outage never reads as "not reachable".
 */
export async function reachOrNull(ctx: ToolContext, type: string, ref: string): Promise<string | null> {
  if (!entityTypeKeyModule(type) || !Object.hasOwn(ENTITY_TABLES, type)) return null;
  if (!keyCanSeeEntityType(ctx.key.scopes, type)) return null;
  let id = ref.trim();
  if (type === "task") {
    try {
      id = await resolveTaskRef(ctx, id);
    } catch (err) {
      if (err instanceof Error && err.message === TASK_NOT_FOUND) return null;
      throw err;
    }
  }
  return (await canReach(ctx, type, id)) ? id : null;
}

/**
 * MOD-94: an item's latest `limit` live comments, oldest first (the newest
 * last), and how many it has in all. One request: the newest page plus an
 * exact count, never the whole thread. Call it only for an item the key
 * reaches (assertReach, or fetchTask for a task): that is the app's rule for
 * them (comments__item_seen: a comment shows to whoever can see its item).
 * `deleted_at` came with the table (20260626130000); `*` because author_kind /
 * author_label (20261008123000) and edited_at (20261013100000) came later,
 * and naming them would fail the read on a database without them.
 */
export async function entityComments(
  ctx: ToolContext,
  type: string,
  id: string,
  limit: number,
): Promise<{ comments: Record<string, unknown>[]; total: number }> {
  const { data, error, count } = await ctx.db.from("comments").select("*", { count: "exact" })
    .eq("workspace_id", ctx.key.workspaceId).eq("entity_type", type).eq("entity_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const page = commentsInOrder((data ?? []) as Record<string, unknown>[]);
  return { comments: page, total: typeof count === "number" ? count : page.length };
}

/** Throws unless the key can see both endpoints' modules (a link's two ends). */
export function assertLinkInScope(ctx: ToolContext, link: Record<string, unknown>): void {
  for (const type of [link.source_type, link.target_type]) {
    if (typeof type === "string" && CHAT_ENDS.has(type)) {
      throw new Error("This link touches something agents can't work with.");
    }
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

/** Apps read conversations through the chat tools alone, never the spine. */
const CHAT_ENDS = new Set(["chat_channel", "chat_message"]);

/**
 * Links with both ends in modules the key can see (the rest are dropped). A
 * link with a conversation or a message at either end ("Mentioned in",
 * "Became a task") is always dropped, whatever the key's Chat access.
 */
export function linksInScope<T extends Record<string, unknown>>(ctx: ToolContext, links: T[]): T[] {
  return links.filter(
    (l) =>
      typeof l.source_type === "string" &&
      typeof l.target_type === "string" &&
      !CHAT_ENDS.has(l.source_type) &&
      !CHAT_ENDS.has(l.target_type) &&
      keyCanSeeEntityType(ctx.key.scopes, l.source_type) &&
      keyCanSeeEntityType(ctx.key.scopes, l.target_type),
  );
}
