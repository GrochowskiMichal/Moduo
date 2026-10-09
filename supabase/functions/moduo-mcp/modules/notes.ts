/**
 * Notes (Notion-style nested pages) — module #5 on the Moduo MCP connector
 * (docs/moduo-mcp-connector.md; block NO-10, AC13).
 *
 * Connector-side mirror of the app's notes manifest (src/features/notes/
 * ops-manifest.ts — keep descriptions in sync). Reads expose the tree, a note's
 * markdown, and search; writes are the notes intent ops. Workspace scoping
 * comes from the key, never from tool args; reads run as service_role (RLS
 * bypassed) so every query MUST filter on ctx.key.workspaceId.
 *
 * Markdown, not CRDT (specs/notes.md assumption 10). The server never parses
 * the Yjs doc; the connector writes the derived `body_md` (the read/search/
 * publish source) and a plain-text `body_text` for FTS. A headless Deno Yjs
 * builder was deliberately NOT attempted here. Consequence: a note
 * created/appended here is immediately listable, gettable-as-markdown,
 * searchable, exportable, and publishable.
 *
 * UPDATED by NOTE-FIX-1 (2026-07-29) — read this before touching the writes.
 * A headless builder IS now proven in the APP (`src/features/notes/editor/
 * materialize.ts`, `@lexical/headless` + `createBindingV2__EXPERIMENTAL`), and
 * the app repairs body-only notes via `notes_op_seed_doc`. So:
 *   - a note CREATED here still lands correctly — it has a body and no doc, so
 *     the app's blank-note sweep materializes it the next time /notes loads;
 *   - a note APPENDED/UPDATED here that is ALREADY materialized no longer
 *     reaches the editor at all. The doc wins on open, and the user's next
 *     keystroke flushes `deriveBody(doc)` over this body write, discarding it.
 * That second case used to self-heal (imported notes stayed un-materialized);
 * it no longer does. Giving the connector a real CRDT write path — or routing
 * its edits through the same materializer — is now REQUIRED for MCP-1.
 */

import type { ConnectorModule, ToolContext } from "../registry.ts";
import { assertReach, visibleIds } from "../share.ts";

type Row = Record<string, any>;

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

/** A markdown string with no length constraint (bodies), preserving internal
 * whitespace but trimming the ends. */
function md(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.replace(/\s+$/g, "");
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
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

/** Light markdown → plain text for the FTS body_text (the CRDT is the faithful
 * serializer; this is a good-enough approximation for search/snippets). */
function mdToPlain(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, " ") // task-line id comments etc.
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links / chips → label
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, "") // list / checkbox markers
    .replace(/[*_~]/g, "") // emphasis marks
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Build a note's stored body from a title + a markdown body: the first line IS
 * the title (the app's first-line-title convention), so the note reads
 * identically once its CRDT materializes. */
function composeBody(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim();
  if (!t) return b;
  if (!b) return t;
  return `${t}\n\n${b}`;
}

function shapeNote(n: Row): Row {
  return {
    id: n.id,
    title: (n.title ?? "").trim() || "Untitled",
    parent_id: n.parent_id ?? null,
    icon: n.icon ?? null,
    archived: Boolean(n.is_archived),
    published: n.published_at != null,
  };
}

async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row | null> {
  const { data, error } = await ctx.db.rpc(fn, { p_workspace_id: ctx.key.workspaceId, ...args });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/** Read one live note's row (or null). */
async function getNote(ctx: ToolContext, id: string, cols: string): Promise<Row | null> {
  const found = await rows(
    ctx.db
      .from("notes")
      .select(cols)
      .eq("workspace_id", ctx.key.workspaceId)
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
  );
  return found[0] ?? null;
}

export const notesConnectorModule: ConnectorModule = {
  module: "notes",
  tools: [
    // ── reads (view scope) ───────────────────────────────────────────────────
    {
      name: "notes_list",
      description:
        "The note tree — every live note's id, title, parent, icon, and published flag (trashed excluded). Reconstruct the hierarchy from parent_id.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "Max notes (default 200, max 1000)." } },
      },
      handler: async (args, ctx) => {
        const data = await rows(
          ctx.db
            .from("notes")
            .select("id, title, parent_id, icon, is_archived, published_at, position")
            .eq("workspace_id", ctx.key.workspaceId)
            .is("deleted_at", null)
            .order("position")
            .limit(clampLimit(args, 200, 1000)),
        );
        const visible = await visibleIds(ctx, "note");
        return data.filter((n) => visible.has(n.id)).map(shapeNote);
      },
    },
    {
      name: "notes_get",
      description: "One note as markdown (`body_md`) plus its meta — the read source.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { note_id: { type: "string", description: "The note uuid." } },
        required: ["note_id"],
      },
      handler: async (args, ctx) => {
        const n = await getNote(
          ctx,
          str(args, "note_id"),
          "id, title, parent_id, icon, is_archived, published_at, publish_token, body_md",
        );
        if (!n || !(await visibleIds(ctx, "note")).has(n.id)) return null;
        return {
          ...shapeNote(n),
          markdown: n.body_md ?? "",
          // Only expose a token an agent could act on when actually published.
          publish_token: n.published_at != null ? (n.publish_token ?? null) : null,
        };
      },
    },
    {
      name: "notes_search",
      description: "Full-text search over note titles and body — returns matches with a snippet.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query (websearch syntax)." },
          limit: { type: "number", description: "Max results (default 20, max 50)." },
        },
        required: ["query"],
      },
      handler: async (args, ctx) => {
        const q = str(args, "query");
        const data = await rows(
          ctx.db
            .from("notes")
            .select("id, title, body_text, is_archived")
            .eq("workspace_id", ctx.key.workspaceId)
            .is("deleted_at", null)
            .textSearch("search_tsv", q, { type: "websearch", config: "simple" })
            .limit(clampLimit(args, 20, 50)),
        );
        const visible = await visibleIds(ctx, "note");
        return data.filter((n) => visible.has(n.id)).map((n) => ({
          id: n.id,
          title: (n.title ?? "").trim() || "Untitled",
          archived: Boolean(n.is_archived),
          snippet: String(n.body_text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        }));
      },
    },
    // ── writes (edit scope) ──────────────────────────────────────────────────
    {
      name: "notes_create",
      description:
        "Create a note from markdown (optionally under a parent) — agents build whole trees this way. The note is immediately listable / searchable / publishable; its rich editor materializes from the markdown on first open.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The note title (becomes its first line)." },
          markdown: { type: "string", description: "The note body as markdown (optional)." },
          parent_id: { type: "string", description: "Parent note uuid to nest under (optional)." },
        },
        required: ["title"],
      },
      handler: async (args, ctx) => {
        const title = str(args, "title");
        const body = md(args, "markdown", false);
        const parentId = str(args, "parent_id", false) || null;
        // notes_op_import (unlike notes_op_create) does NOT guard the parent —
        // there's no FK on parent_id — so an unresolvable/foreign parent would
        // silently import the note as an orphan root. Guard it here so the agent
        // gets a clear error instead of a mis-parented note.
        if (parentId) await assertReach(ctx, "note", parentId);
        const id = crypto.randomUUID();
        const bodyMd = composeBody(title, body);
        const result = await callOp(ctx, "notes_op_import", {
          p_rows: [
            {
              id,
              parentId,
              title,
              bodyMd,
              bodyText: mdToPlain(bodyMd),
            },
          ],
        });
        const imported = Number((result as Row)?.imported ?? 0);
        if (imported < 1) throw new Error("The note could not be created.");
        return { id, title, parent_id: parentId };
      },
    },
    {
      name: "notes_append",
      description:
        "Append markdown to the end of a note's body (adds to the read/search/publish source; the live editor reflects it after its next materialization).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "The note uuid." },
          markdown: { type: "string", description: "The markdown to append." },
        },
        required: ["note_id", "markdown"],
      },
      handler: async (args, ctx) => {
        const noteId = str(args, "note_id");
        const addition = md(args, "markdown");
        await assertReach(ctx, "note", noteId);
        const existing = await getNote(ctx, noteId, "id, body_md");
        if (!existing) throw new Error("Note not found in this workspace.");
        const combined = `${(existing.body_md ?? "").replace(/\s+$/g, "")}\n\n${addition}`.trim();
        await callOp(ctx, "notes_op_apply_updates", {
          p_note_id: noteId,
          p_client_id: "mcp",
          p_updates: null,
          p_body_md: combined,
          p_body_text: mdToPlain(combined),
        });
        return { id: noteId, ok: true };
      },
    },
    {
      name: "notes_update",
      description:
        "Replace a note's markdown body wholesale (optionally rename it). The live editor reflects it after its next materialization.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "The note uuid." },
          markdown: { type: "string", description: "The replacement markdown body." },
          title: { type: "string", description: "New title (optional; also its first line)." },
        },
        required: ["note_id", "markdown"],
      },
      handler: async (args, ctx) => {
        const noteId = str(args, "note_id");
        const body = md(args, "markdown");
        const title = str(args, "title", false);
        await assertReach(ctx, "note", noteId);
        if (title) {
          await callOp(ctx, "notes_op_rename", { p_note_id: noteId, p_title: title });
        }
        // Preserve the current title as the first line when the caller didn't
        // pass a new one, so the first-line-title convention holds.
        let firstLine = title;
        if (!firstLine) {
          const cur = await getNote(ctx, noteId, "id, title");
          if (!cur) throw new Error("Note not found in this workspace.");
          firstLine = (cur.title ?? "").trim();
        }
        const bodyMd = composeBody(firstLine, body);
        await callOp(ctx, "notes_op_apply_updates", {
          p_note_id: noteId,
          p_client_id: "mcp",
          p_updates: null,
          p_body_md: bodyMd,
          p_body_text: mdToPlain(bodyMd),
        });
        return { id: noteId, ok: true };
      },
    },
    {
      name: "notes_move",
      description:
        "Reparent a note (with its subtree) under another note, or to the root (omit parent_id). Cycle-guarded server-side. Ordering among siblings is not controllable here — the note takes a default position.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "The note uuid." },
          parent_id: { type: "string", description: "New parent uuid, or omit for a root." },
        },
        required: ["note_id"],
      },
      handler: async (args, ctx) => {
        const parentId = str(args, "parent_id", false) || null;
        // The op guards the module; the new parent must also be one you can open.
        if (parentId) await assertReach(ctx, "note", parentId);
        const n = await callOp(ctx, "notes_op_move", {
          p_note_id: str(args, "note_id"),
          p_parent_id: parentId,
          p_position: "",
        });
        return n ? shapeNote(n) : null;
      },
    },
    {
      name: "notes_archive",
      description: "Archive a note (with its subtree) — hides it from the tree, reversible.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { note_id: { type: "string", description: "The note uuid." } },
        required: ["note_id"],
      },
      handler: async (args, ctx) => {
        const n = await callOp(ctx, "notes_op_archive", { p_note_id: str(args, "note_id") });
        return n ? shapeNote(n) : { ok: true };
      },
    },
    {
      name: "notes_trash",
      description: "Move a note (with its subtree) to the Trash (soft-delete; 30-day purge, Undo-friendly).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { note_id: { type: "string", description: "The note uuid." } },
        required: ["note_id"],
      },
      handler: async (args, ctx) => {
        await callOp(ctx, "notes_op_trash", { p_note_id: str(args, "note_id") });
        return { id: str(args, "note_id"), ok: true };
      },
    },
    {
      name: "notes_link",
      description:
        "Link a note to another entity with a typed relation (idempotent; rides the spine, so the key also needs Links: Edit). Use `references` for a manual connection.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "The note uuid (the link source)." },
          target_type: { type: "string", description: "Other entity type (task|contact|company|note|…)." },
          target_id: { type: "string", description: "Other entity uuid." },
          relation_kind: { type: "string", description: "Relation kind (default references)." },
        },
        required: ["note_id", "target_type", "target_id"],
      },
      handler: async (args, ctx) => {
        await assertReach(ctx, "note", str(args, "note_id"));
        await assertReach(ctx, str(args, "target_type"), str(args, "target_id"));
        const link = await callOp(ctx, "links_op_create", {
          p_source_type: "note",
          p_source_id: str(args, "note_id"),
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
  ],
};
