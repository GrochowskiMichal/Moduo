/**
 * Links (the connective-tissue spine) — module #2 on the Moduo MCP connector
 * (docs/moduo-mcp-connector.md; block CT-7, AC12).
 *
 * Connector-side mirror of the app's spine manifest (src/features/spine/
 * ops-manifest.ts — keep descriptions in sync). Read tools expose the registry
 * search, an entity's links, and deterministic suggestions; write tools are the
 * agent-meaningful link / comment intent ops, calling the same links_op_* /
 * comments_op_* RPCs the app uses. Workspace scoping comes from the key, never
 * from tool args. Reads run as service_role (RLS bypassed), so every query MUST
 * filter on ctx.key.workspaceId.
 *
 * Deliberately NOT exposed (in the app manifest but not agent-meaningful):
 * `notifications.mark_read` / `mark_all_read` (user-facing read state, not an
 * agent intent) and `links.decline_suggestion` (a personal "don't nag me" the
 * user owns) — mirroring how the tasks connector omits `tasks.catch_up`.
 */

import { keyCanSeeEntityType } from "../../_shared/contracts/mcp-key-scopes.ts";
import { RELATION_KINDS } from "../../_shared/contracts/vocabularies.ts";
import type { ConnectorModule, ToolContext } from "../registry.ts";
import { assertLiveLinkInScope, assertReach, linksInScope, visibleIds } from "../share.ts";

type Row = Record<string, any>;

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

/**
 * A type/id token safe to interpolate into a PostgREST `.or()` filter string.
 * The `.or()` grammar is delimited by `, ( ) .`, so an agent value containing
 * those could malform the filter (always within the key's own workspace — every
 * query is AND-pinned to ctx.key.workspaceId, so this is robustness, not a
 * security boundary). Reject rather than silently mangle.
 */
function safeToken(args: Row, name: string): string {
  const v = str(args, name);
  if (/[(),.]/.test(v)) throw new Error(`${name} contains invalid characters.`);
  return v;
}

function clampLimit(args: Row, fallback: number, max: number): number {
  const v = Number(args?.limit);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

async function rows(
  query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Compact link shape for agents — registry noise stays out. */
function shapeLink(l: Row): Row {
  return {
    id: l.id,
    source: { type: l.source_type, id: l.source_id },
    target: { type: l.target_type, id: l.target_id },
    relation_kind: l.relation_kind,
    origin: l.origin,
    created_at: l.created_at,
  };
}

/** Call a spine op RPC and return its raw result row. */
async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row | null> {
  const { data, error } = await ctx.db.rpc(fn, { p_workspace_id: ctx.key.workspaceId, ...args });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

const entityRefProps = {
  source_type: { type: "string", description: "Source entity type (task|contact|company|note|…)." },
  source_id: { type: "string", description: "Source entity uuid." },
  target_type: { type: "string", description: "Target entity type." },
  target_id: { type: "string", description: "Target entity uuid." },
} as const;

/**
 * What a key may see of the registry: only entity types whose module it holds
 * at least View on (a Links key with Notes: None sees no note titles), and of
 * those only what its creator can open. PERM-0: events and email threads are
 * owner-only; the connector reads with the service role (no RLS), so drop
 * registry rows the key's creator doesn't own.
 */
const PRIVATE_TABLES: Record<string, string> = { event: "calendar_events", email_thread: "email_refs" };
const SHARED_TYPES = ["note", "task", "bucket", "contact", "company"] as const;

async function visibleToKey(ctx: ToolContext, rows_: Row[]): Promise<Row[]> {
  const data = rows_.filter((e) => keyCanSeeEntityType(ctx.key.scopes, e.entity_type));
  const hidden = new Set<string>();
  for (const [type, table] of Object.entries(PRIVATE_TABLES)) {
    const ids = data.filter((e) => e.entity_type === type).map((e) => e.entity_id as string);
    if (!ids.length) continue;
    const owned = await rows(
      ctx.db.from(table).select("id").in("id", ids).eq("owner_id", ctx.key.createdBy),
    );
    const ownedIds = new Set(owned.map((r) => r.id as string));
    for (const id of ids) if (!ownedIds.has(id)) hidden.add(`${type}:${id}`);
  }
  // Shareable things (PERM-3…6): only what's shared with the key's creator.
  for (const type of SHARED_TYPES) {
    const ids = data.filter((e) => e.entity_type === type).map((e) => e.entity_id as string);
    if (!ids.length) continue;
    const visible = await visibleIds(ctx, type);
    for (const id of ids) if (!visible.has(id)) hidden.add(`${type}:${id}`);
  }
  return data.filter((e) => !hidden.has(`${e.entity_type}:${e.entity_id}`));
}

export const linksConnectorModule: ConnectorModule = {
  module: "links",
  tools: [
    // ── reads (view scope) ───────────────────────────────────────────────────
    {
      name: "links_search_entities",
      description:
        "Search the central registry by label — the @mention / link picker source. Excludes tombstones; optionally scoped to entity types.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Label substring to match (optional)." },
          types: { type: "array", items: { type: "string" }, description: "Restrict to these entity types (optional)." },
          limit: { type: "number", description: "Max results (default 20, max 50)." },
        },
      },
      handler: async (args, ctx) => {
        let q = ctx.db
          .from("entities")
          .select("entity_type, entity_id, label, icon")
          .eq("workspace_id", ctx.key.workspaceId)
          .is("deleted_at", null);
        const query = str(args, "query", false);
        if (query) q = q.ilike("label", `%${query}%`);
        const types = Array.isArray(args.types) ? args.types.filter((t) => typeof t === "string") : [];
        if (types.length) q = q.in("entity_type", types);
        // Over-fetch so dropping a teammate's private rows doesn't starve the page.
        const limit = clampLimit(args, 20, 50);
        const fetched = await rows(q.order("label").limit(limit * 4));
        const data = (await visibleToKey(ctx, fetched)).slice(0, limit);
        return data.map((e) => ({ type: e.entity_type, id: e.entity_id, label: e.label, icon: e.icon }));
      },
    },
    {
      name: "links_list",
      description: "Every live link touching an entity (matched on either end) — the hub roll-up source.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          entity_type: { type: "string", description: "The focus entity type." },
          entity_id: { type: "string", description: "The focus entity uuid." },
        },
        required: ["entity_type", "entity_id"],
      },
      handler: async (args, ctx) => {
        const type = safeToken(args, "entity_type");
        const id = safeToken(args, "entity_id");
        await assertReach(ctx, type, id);
        const data = await rows(
          ctx.db
            .from("entity_links")
            .select("*")
            .eq("workspace_id", ctx.key.workspaceId)
            .is("deleted_at", null)
            .or(
              `and(source_type.eq.${type},source_id.eq.${id}),and(target_type.eq.${type},target_id.eq.${id})`,
            )
            .order("created_at", { ascending: false }),
        );
        return linksInScope(ctx, data).map(shapeLink);
      },
    },
    {
      name: "links_suggest",
      description:
        "Deterministic auto-suggested links for an entity (shared tags / matching email domain / ±time-window co-activity). Never auto-applied — use links_create to accept.",
      // Edit, not View: suggestions only exist to be accepted, and the RPC sits
      // behind the Links Edit guard.
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          entity_type: { type: "string", description: "The focus entity type." },
          entity_id: { type: "string", description: "The focus entity uuid." },
          limit: { type: "number", description: "Max candidate rows (default 25)." },
        },
        required: ["entity_type", "entity_id"],
      },
      handler: async (args, ctx) => {
        const type = str(args, "entity_type");
        const id = str(args, "entity_id");
        await assertReach(ctx, type, id);
        const { data, error } = await ctx.db.rpc("links_suggest", {
          p_workspace_id: ctx.key.workspaceId,
          p_entity_type: type,
          p_entity_id: id,
          p_limit: clampLimit(args, 25, 50),
        });
        if (error) throw new Error(error.message);
        // Suggestions carry titles: same visibility rule as search.
        const suggested = (Array.isArray(data) ? data : []) as Row[];
        const visible = await visibleToKey(
          ctx,
          suggested.map((r) => ({ ...r, entity_type: r.other_type, entity_id: r.other_id })),
        );
        return visible.map(({ entity_type: _type, entity_id: _id, ...r }) => r);
      },
    },
    // ── writes (edit scope) ──────────────────────────────────────────────────
    {
      name: "links_create",
      description:
        "Link two entities with a typed, direction-agnostic relation (idempotent; rejects self-links and unknown kinds). Registers both endpoints.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          ...entityRefProps,
          relation_kind: { type: "string", enum: RELATION_KINDS, description: "Relation kind (default references)." },
        },
        required: ["source_type", "source_id", "target_type", "target_id"],
      },
      handler: async (args, ctx) => {
        await assertReach(ctx, str(args, "source_type"), str(args, "source_id"));
        await assertReach(ctx, str(args, "target_type"), str(args, "target_id"));
        const link = await callOp(ctx, "links_op_create", {
          p_source_type: str(args, "source_type"),
          p_source_id: str(args, "source_id"),
          p_target_type: str(args, "target_type"),
          p_target_id: str(args, "target_id"),
          p_relation_kind: str(args, "relation_kind", false) || "references",
          p_origin: "manual",
        });
        return link ? shapeLink(link) : null;
      },
    },
    {
      name: "links_set_kind",
      description: "Re-type an existing link's relation kind. No-op if unchanged.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          link_id: { type: "string", description: "Link uuid." },
          relation_kind: { type: "string", enum: RELATION_KINDS, description: "New relation kind." },
        },
        required: ["link_id", "relation_kind"],
      },
      handler: async (args, ctx) => {
        await assertLiveLinkInScope(ctx, str(args, "link_id"));
        const link = await callOp(ctx, "links_op_set_kind", {
          p_link_id: str(args, "link_id"),
          p_relation_kind: str(args, "relation_kind"),
        });
        return link ? shapeLink(link) : null;
      },
    },
    {
      name: "links_delete",
      description: "Soft-delete a link (Undo-friendly, idempotent).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { link_id: { type: "string", description: "Link uuid." } },
        required: ["link_id"],
      },
      handler: async (args, ctx) => {
        await assertLiveLinkInScope(ctx, str(args, "link_id"));
        const link = await callOp(ctx, "links_op_delete", { p_link_id: str(args, "link_id") });
        return link?.id ? shapeLink(link) : { ok: true };
      },
    },
    {
      name: "comments_add",
      description:
        "Add a comment to any entity. Member @mentions (mentioned_user_ids) become attributed notifications for those members.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          entity_type: { type: "string", description: "Commented entity type." },
          entity_id: { type: "string", description: "Commented entity uuid." },
          body: { type: "string", description: "Comment text." },
          mentioned_user_ids: {
            type: "array",
            items: { type: "string" },
            description: "uuid[] of @-mentioned workspace members (optional).",
          },
        },
        required: ["entity_type", "entity_id", "body"],
      },
      handler: async (args, ctx) => {
        const mentioned = Array.isArray(args.mentioned_user_ids)
          ? args.mentioned_user_ids.filter((m) => typeof m === "string")
          : [];
        await assertReach(ctx, str(args, "entity_type"), str(args, "entity_id"));
        const comment = await callOp(ctx, "comments_op_add", {
          p_entity_type: str(args, "entity_type"),
          p_entity_id: str(args, "entity_id"),
          p_body: str(args, "body"),
          p_mentioned_user_ids: mentioned,
        });
        return comment ? { id: comment.id, created_at: comment.created_at } : null;
      },
    },
  ],
};
