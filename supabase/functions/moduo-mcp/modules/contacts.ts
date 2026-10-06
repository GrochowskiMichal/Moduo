/**
 * Contacts (the light CRM) — module #3 on the Moduo MCP connector
 * (docs/moduo-mcp-connector.md; block CO-5, AC9).
 *
 * Connector-side mirror of the app's contacts manifest (src/features/contacts/
 * ops-manifest.ts — keep descriptions in sync). Read tools expose the directory,
 * a contact's roll-up, and search; write tools are the contacts intent ops,
 * calling the same contacts_op_* RPCs the app uses. Workspace scoping comes from
 * the key, never from tool args. Reads run as service_role (RLS bypassed), so
 * every query MUST filter on ctx.key.workspaceId.
 */

import { RELATION_KINDS } from "../../_shared/contracts/vocabularies.ts";
import type { ConnectorModule, ToolContext } from "../registry.ts";
import { visibleIds } from "../share.ts";

type Row = Record<string, any>;

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

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

/** Compact contact shape for agents. */
function shapeContact(c: Row): Row {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    title: c.title,
    company_id: c.company_id,
    status: c.status,
  };
}

function shapeCompany(c: Row): Row {
  return { id: c.id, name: c.name, domains: c.domains, website: c.website };
}

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

/** Call a contacts op RPC and return its raw result row. */
async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row | null> {
  const { data, error } = await ctx.db.rpc(fn, { p_workspace_id: ctx.key.workspaceId, ...args });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export const contactsConnectorModule: ConnectorModule = {
  module: "contacts",
  tools: [
    // ── reads (view scope) ───────────────────────────────────────────────────
    {
      name: "contacts_list",
      description: "All people and companies in the workspace — the directory source.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "Max rows per kind (default 100, max 500)." } },
      },
      handler: async (args, ctx) => {
        const limit = clampLimit(args, 100, 500);
        const [people, companies] = await Promise.all([
          rows(
            ctx.db
              .from("contacts")
              .select("*")
              .eq("workspace_id", ctx.key.workspaceId)
              .is("deleted_at", null)
              .order("name")
              .limit(limit),
          ),
          rows(
            ctx.db
              .from("companies")
              .select("*")
              .eq("workspace_id", ctx.key.workspaceId)
              .is("deleted_at", null)
              .order("name")
              .limit(limit),
          ),
        ]);
        const visible = await visibleIds(ctx, "contact");
        const mine = people.filter((p) => visible.has(p.id));
        const companyIds = new Set(mine.map((p) => p.company_id).filter(Boolean));
        return {
          contacts: mine.map(shapeContact),
          companies: companies
            .filter((c) => c.owner_id === ctx.key.createdBy || companyIds.has(c.id))
            .map(shapeCompany),
        };
      },
    },
    {
      name: "contacts_get",
      description: "A contact (or company) with every live link touching it — the roll-up hub source.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          entity_type: { type: "string", description: "contact | company (default contact)." },
          entity_id: { type: "string", description: "The contact/company uuid." },
        },
        required: ["entity_id"],
      },
      handler: async (args, ctx) => {
        // Normalize to the two known types so the .or() interpolation is a safe token.
        const type = (str(args, "entity_type", false) || "contact") === "company" ? "company" : "contact";
        const id = safeToken(args, "entity_id");
        const table = type === "company" ? "companies" : "contacts";
        const found = await rows(
          ctx.db.from(table).select("*").eq("workspace_id", ctx.key.workspaceId).eq("id", id).is("deleted_at", null),
        );
        if (found.length === 0) return null;
        // Private contacts/companies read as absent unless shared with you.
        if (!(await visibleIds(ctx, type)).has(found[0].id)) return null;
        const links = await rows(
          ctx.db
            .from("entity_links")
            .select("*")
            .eq("workspace_id", ctx.key.workspaceId)
            .is("deleted_at", null)
            .or(`and(source_type.eq.${type},source_id.eq.${id}),and(target_type.eq.${type},target_id.eq.${id})`)
            .order("created_at", { ascending: false }),
        );
        const entity = type === "company" ? shapeCompany(found[0]) : shapeContact(found[0]);
        return { entity, links: links.map(shapeLink) };
      },
    },
    {
      name: "contacts_search",
      description: "Search people and companies by name or email.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name / email substring to match." },
          limit: { type: "number", description: "Max results (default 20, max 50)." },
        },
        required: ["query"],
      },
      handler: async (args, ctx) => {
        const q = str(args, "query");
        const limit = clampLimit(args, 20, 50);
        const like = `%${q}%`;
        // Two single-column ilike queries (merged) rather than a `.or()` — the
        // .or grammar is delimited by , ( ) . so a query like "acme.com" would
        // malform it; a plain .ilike value has no such grammar.
        const peopleQ = (col: "name" | "email") =>
          rows(
            ctx.db
              .from("contacts")
              .select("*")
              .eq("workspace_id", ctx.key.workspaceId)
              .is("deleted_at", null)
              .ilike(col, like)
              .order("name")
              .limit(limit),
          );
        const [byName, byEmail, companies] = await Promise.all([
          peopleQ("name"),
          peopleQ("email"),
          rows(
            ctx.db
              .from("companies")
              .select("*")
              .eq("workspace_id", ctx.key.workspaceId)
              .is("deleted_at", null)
              .ilike("name", like)
              .order("name")
              .limit(limit),
          ),
        ]);
        const peopleById = new Map<string, Row>();
        for (const c of [...byName, ...byEmail]) if (!peopleById.has(c.id)) peopleById.set(c.id, c);
        const visible = await visibleIds(ctx, "contact");
        const people = [...peopleById.values()].filter((p) => visible.has(p.id)).slice(0, limit);
        const companyIds = new Set(people.map((p) => p.company_id).filter(Boolean));
        return {
          contacts: people.map(shapeContact),
          companies: companies
            .filter((c) => c.owner_id === ctx.key.createdBy || companyIds.has(c.id))
            .map(shapeCompany),
        };
      },
    },
    // ── writes (edit scope) ──────────────────────────────────────────────────
    {
      name: "contacts_create",
      description: "Create a person; registers them so they're immediately linkable/@mentionable.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Person's display name." },
          email: { type: "string", description: "Primary email (optional)." },
          phone: { type: "string", description: "Phone (optional)." },
          title: { type: "string", description: "Job title (optional)." },
          company_id: { type: "string", description: "Company uuid to associate (optional)." },
          status: { type: "string", description: "Flat status label (default lead)." },
        },
        required: ["name"],
      },
      handler: async (args, ctx) => {
        const c = await callOp(ctx, "contacts_op_create", {
          p_name: str(args, "name"),
          p_email: str(args, "email", false) || null,
          p_phone: str(args, "phone", false) || null,
          p_title: str(args, "title", false) || null,
          p_company_id: str(args, "company_id", false) || null,
          p_status: str(args, "status", false) || "lead",
        });
        return c ? shapeContact(c) : null;
      },
    },
    {
      name: "contacts_update",
      description: "Edit a person's fields (omit a field to leave it unchanged).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "Contact uuid." },
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          title: { type: "string" },
        },
        required: ["contact_id"],
      },
      handler: async (args, ctx) => {
        const c = await callOp(ctx, "contacts_op_update", {
          p_contact_id: str(args, "contact_id"),
          p_name: str(args, "name", false) || null,
          p_email: str(args, "email", false) || null,
          p_phone: str(args, "phone", false) || null,
          p_title: str(args, "title", false) || null,
        });
        return c ? shapeContact(c) : null;
      },
    },
    {
      name: "contacts_set_status",
      description: "Set a person's flat status (any non-empty label; no pipeline). No-op if unchanged.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "Contact uuid." },
          status: { type: "string", description: "The status label." },
        },
        required: ["contact_id", "status"],
      },
      handler: async (args, ctx) => {
        const c = await callOp(ctx, "contacts_op_set_status", {
          p_contact_id: str(args, "contact_id"),
          p_status: str(args, "status"),
        });
        return c ? shapeContact(c) : null;
      },
    },
    {
      name: "contacts_link",
      description: "Link a contact/company to another entity (idempotent). Kinds: works-at, follow-up, references, …",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          contact_type: { type: "string", description: "contact | company." },
          contact_id: { type: "string", description: "The contact/company uuid." },
          target_type: { type: "string", description: "Other entity type (task|note|company|…)." },
          target_id: { type: "string", description: "Other entity uuid." },
          relation_kind: { type: "string", enum: RELATION_KINDS, description: "Relation kind (default references)." },
        },
        required: ["contact_type", "contact_id", "target_type", "target_id"],
      },
      handler: async (args, ctx) => {
        const link = await callOp(ctx, "contacts_op_link", {
          p_contact_type: str(args, "contact_type"),
          p_contact_id: str(args, "contact_id"),
          p_target_type: str(args, "target_type"),
          p_target_id: str(args, "target_id"),
          p_relation_kind: str(args, "relation_kind", false) || "references",
          p_origin: "manual",
        });
        return link ? shapeLink(link) : null;
      },
    },
    {
      name: "contacts_unlink",
      description: "Soft-delete a link a contact/company owns (Undo-friendly, idempotent).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { link_id: { type: "string", description: "Link uuid." } },
        required: ["link_id"],
      },
      handler: async (args, ctx) => {
        const link = await callOp(ctx, "contacts_op_unlink", { p_link_id: str(args, "link_id") });
        return link?.id ? shapeLink(link) : { ok: true };
      },
    },
    {
      name: "contacts_delete",
      description: "Soft-delete a contact: drops its links and removes it from search / @mention / roll-ups.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string", description: "Contact uuid." } },
        required: ["contact_id"],
      },
      handler: async (args, ctx) => {
        const c = await callOp(ctx, "contacts_op_delete", { p_contact_id: str(args, "contact_id") });
        return c ? shapeContact(c) : { ok: true };
      },
    },
    {
      name: "contacts_import",
      description:
        "Bulk-create people from a deduped plan: each row { op:'create'|'merge', contactId?, name, email, phone, title, company, status }.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            description: "The rows to import (each with op='create'|'merge').",
            items: {
              type: "object",
              properties: {
                op: { type: "string", enum: ["create", "merge"] },
                contactId: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
                phone: { type: "string" },
                title: { type: "string" },
                company: { type: "string" },
                status: { type: "string" },
              },
              required: ["name"],
            },
          },
        },
        required: ["rows"],
      },
      handler: async (args, ctx) => {
        const rowsArg = Array.isArray(args.rows) ? args.rows : [];
        const result = await callOp(ctx, "contacts_op_import", { p_rows: rowsArg });
        return result ?? { created: 0, merged: 0 };
      },
    },
  ],
};
