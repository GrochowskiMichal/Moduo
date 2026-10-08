/**
 * Email (Spark-replacement, desktop-first hybrid) — module #6 on the Moduo MCP
 * connector (docs/moduo-mcp-connector.md; block EM-11, AC17).
 *
 * Connector-side mirror of the app's email manifest (src/features/email/
 * ops-manifest.ts — keep descriptions in sync). Email is desktop-first: the
 * mailbox never leaves the machine, so the MCP surface is **metadata only** —
 * the workspace-visible tissue threads (from/subject/snippet + snooze & follow-up
 * state) an inbox deliberately pulled in. **No message-body read, no send** (spec
 * Out of scope / Q-E6). Owner-scoped `email_accounts` are NOT exposed (nobody
 * else sees your inbox metadata); the connector reads/writes only `email_refs`.
 *
 * Workspace scoping comes from the key, never from tool args; reads run as
 * service_role (RLS bypassed) so every query MUST filter on ctx.key.workspaceId.
 *
 * Convert-to-task minting is NOT a tool here (tasks are written client-direct —
 * no `tasks_op_create` to PERFORM, and the tasks connector mints nothing; EM-8).
 * An agent instead `email_link`s a thread to an existing task/contact. Tags ride
 * the shared client-direct `tag_links` path (no RPC) — a connector tag write is
 * an MCP-1 follow-up.
 */

import type { ConnectorModule, ToolContext } from "../registry.ts";
import { assertReach } from "../share.ts";

type Row = Record<string, any>;

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

function isoOrThrow(args: Row, name: string): string {
  const v = str(args, name);
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error(`${name} must be an ISO timestamp.`);
  return new Date(t).toISOString();
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

async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row | null> {
  const { data, error } = await ctx.db.rpc(fn, { p_workspace_id: ctx.key.workspaceId, ...args });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

const REF_COLS =
  "id, thread_key, account_id, from_addr, from_name, subject, snippet, sent_at, is_snoozed, snooze_until, follow_up_at, follow_up_cleared_at, updated_at";

function shapeRef(r: Row): Row {
  return {
    id: r.id,
    thread_key: r.thread_key,
    from: { name: (r.from_name ?? "").trim() || null, address: r.from_addr ?? null },
    subject: (r.subject ?? "").trim() || "(No subject)",
    snippet: r.snippet ?? "",
    sent_at: r.sent_at ?? null,
    snoozed: r.is_snoozed ? { until: r.snooze_until ?? null } : null,
    follow_up_at: r.follow_up_cleared_at ? null : (r.follow_up_at ?? null),
  };
}

/** Read one live tissue ref (or null). */
async function getRef(ctx: ToolContext, id: string, cols = REF_COLS): Promise<Row | null> {
  const found = await rows(
    ctx.db
      .from("email_refs")
      .select(cols)
      .eq("workspace_id", ctx.key.workspaceId)
      .eq("owner_id", ctx.key.createdBy) // PERM-0: owner-only
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
  );
  return found[0] ?? null;
}

export const emailConnectorModule: ConnectorModule = {
  module: "email",
  tools: [
    // ── reads (view scope) — metadata only, never a message body ─────────────
    {
      name: "email_list",
      description:
        "The tissue email threads — the ones deliberately pulled into the workspace (converted / linked / snoozed / followed-up). Metadata only: from, subject, snippet, snooze & follow-up state. Newest first.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "Max threads (default 50, max 200)." } },
      },
      handler: async (args, ctx) => {
        const data = await rows(
          ctx.db
            .from("email_refs")
            .select(REF_COLS)
            .eq("workspace_id", ctx.key.workspaceId)
            .eq("owner_id", ctx.key.createdBy) // PERM-0: owner-only
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .limit(clampLimit(args, 50, 200)),
        );
        return data.map(shapeRef);
      },
    },
    {
      name: "email_get",
      description: "One tissue thread's metadata by its ref id (never the message body).",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { ref_id: { type: "string", description: "The email_refs uuid." } },
        required: ["ref_id"],
      },
      handler: async (args, ctx) => {
        const r = await getRef(ctx, str(args, "ref_id"));
        return r ? shapeRef(r) : null;
      },
    },
    {
      name: "email_search",
      description:
        "Search the tissue threads by sender, subject, or snippet (metadata only). Returns matching threads.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search text." },
          limit: { type: "number", description: "Max results (default 20, max 50)." },
        },
        required: ["query"],
      },
      handler: async (args, ctx) => {
        const q = str(args, "query").replace(/[%,()]/g, " ").trim();
        if (!q) return [];
        const data = await rows(
          ctx.db
            .from("email_refs")
            .select(REF_COLS)
            .eq("workspace_id", ctx.key.workspaceId)
            .eq("owner_id", ctx.key.createdBy) // PERM-0: owner-only
            .is("deleted_at", null)
            .or(
              `from_addr.ilike.%${q}%,from_name.ilike.%${q}%,subject.ilike.%${q}%,snippet.ilike.%${q}%`,
            )
            .order("updated_at", { ascending: false })
            .limit(clampLimit(args, 20, 50)),
        );
        return data.map(shapeRef);
      },
    },
    // ── writes (edit scope) — tissue state only, never send ──────────────────
    {
      name: "email_snooze",
      description: "Snooze a thread until a time — it leaves the inbox and returns when due.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          ref_id: { type: "string", description: "The email_refs uuid." },
          until: { type: "string", description: "When it returns (ISO timestamp)." },
        },
        required: ["ref_id", "until"],
      },
      handler: async (args, ctx) => {
        const r = await callOp(ctx, "email_op_snooze", {
          p_ref_id: str(args, "ref_id"),
          p_snooze_until: isoOrThrow(args, "until"),
        });
        return r ? shapeRef(r) : null;
      },
    },
    {
      name: "email_unsnooze",
      description: "Cancel a snooze — the thread returns to the inbox now.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { ref_id: { type: "string", description: "The email_refs uuid." } },
        required: ["ref_id"],
      },
      handler: async (args, ctx) => {
        const r = await callOp(ctx, "email_op_unsnooze", { p_ref_id: str(args, "ref_id") });
        return r ? shapeRef(r) : null;
      },
    },
    {
      name: "email_follow_up",
      description:
        "Set a follow-up reminder on a thread — notifies at the deadline if no reply arrived.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          ref_id: { type: "string", description: "The email_refs uuid." },
          at: { type: "string", description: "The reminder time (ISO timestamp)." },
        },
        required: ["ref_id", "at"],
      },
      handler: async (args, ctx) => {
        const r = await callOp(ctx, "email_op_follow_up", {
          p_ref_id: str(args, "ref_id"),
          p_follow_up_at: isoOrThrow(args, "at"),
        });
        return r ? shapeRef(r) : null;
      },
    },
    {
      name: "email_clear_follow_up",
      description: "Clear a follow-up reminder on a thread.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { ref_id: { type: "string", description: "The email_refs uuid." } },
        required: ["ref_id"],
      },
      handler: async (args, ctx) => {
        const r = await callOp(ctx, "email_op_clear_follow_up", { p_ref_id: str(args, "ref_id") });
        return r ? shapeRef(r) : null;
      },
    },
    {
      name: "email_link",
      description:
        "Link a thread to another entity with a typed relation (idempotent; rides the spine). Use `references` for a manual connection, `spawned-from` when a task came from the thread.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          ref_id: { type: "string", description: "The email_refs uuid (the thread to link)." },
          target_type: { type: "string", description: "Other entity type (task|contact|company|note|…)." },
          target_id: { type: "string", description: "Other entity uuid." },
          relation_kind: { type: "string", description: "Relation kind (default references)." },
        },
        required: ["ref_id", "target_type", "target_id"],
      },
      handler: async (args, ctx) => {
        // email_op_link keys on the email_thread ENTITY id, which is the ref's
        // uuid (`email_refs.id` — what ref_upsert registers), NOT its text
        // thread_key. Matches the app's linkThread({ threadId: ref.id }).
        const ref = await getRef(ctx, str(args, "ref_id"), "id");
        if (!ref) throw new Error("Email thread not found in this workspace.");
        await assertReach(ctx, str(args, "target_type"), str(args, "target_id"));
        const link = await callOp(ctx, "email_op_link", {
          p_thread_id: ref.id,
          p_target_type: str(args, "target_type"),
          p_target_id: str(args, "target_id"),
          p_relation_kind: str(args, "relation_kind", false) || "references",
          p_origin: "manual",
        });
        return link
          ? {
              id: link.id,
              source: { type: link.source_type, id: link.source_id },
              target: { type: link.target_type, id: link.target_id },
              relation_kind: link.relation_kind,
            }
          : null;
      },
    },
    {
      name: "email_remove",
      description:
        "Remove a thread from the tissue — soft-deletes the ref, drops its links, tombstones the entity (the inbox itself is untouched; the mailbox is on desktop).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { ref_id: { type: "string", description: "The email_refs uuid." } },
        required: ["ref_id"],
      },
      handler: async (args, ctx) => {
        await callOp(ctx, "email_op_ref_remove", { p_ref_id: str(args, "ref_id") });
        return { id: str(args, "ref_id"), ok: true };
      },
    },
  ],
};
