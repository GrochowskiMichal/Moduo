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
 * Writes are real CRDT changes (specs/notes-refresh.md NR-6, AC11). Append
 * and update rebuild the note's Yjs doc from the server (snapshot + update
 * log), apply the edit through the app's own headless editor (the prebuilt
 * `_shared/notes-doc/notes-doc.bundle.js`; rebuild it with
 * `bun run build:notes-doc` whenever the notes editor schema changes), and
 * push the edit's own update through `notes_op_apply_updates`. The server
 * sees the key and records the row as the key's (`origin = 'api_key'`) and
 * logs `notes.agent_edit`. A cue on the note's live channel makes open
 * editors pull it at once (the cue carries no content, so nobody can pass an
 * edit off as an agent's); a closed note gets it on its next pull.
 * `body_md` / `body_text` come from the same converter the app uses, and are
 * re-derived when another write raced this one. A note that has a body but no
 * doc yet is seeded first through `notes_op_seed_doc`, the once-only guard.
 * Create builds the doc up front, so a new note is complete the moment it
 * exists. The bundle is loaded on the first notes write only, so the other
 * modules' tools never pay for it.
 */

import type { ConnectorModule, ToolContext } from "../registry.ts";
import { assertReach, visibleIds } from "../share.ts";

/** Mirrors `AgentEdit` in src/features/notes/editor/agent-write.ts (the
 * bundle ships no types). */
type AgentEdit = { kind: "append" | "replace"; markdown: string };

// deno-lint-ignore no-explicit-any
let notesDocModule: Promise<any> | null = null;
/** The headless notes-doc writer, loaded once, on the first notes write. */
function notesDoc() {
  notesDocModule ??= import("../../_shared/notes-doc/notes-doc.bundle.js");
  return notesDocModule;
}

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

const UPDATE_PAGE = 1000;

/** Every update row after `after`, paged past PostgREST's 1000-row cap, and
 * the highest id read. */
async function noteUpdateLog(
  ctx: ToolContext,
  noteId: string,
  after = 0,
): Promise<{ updates: string[]; upto: number }> {
  const updates: string[] = [];
  let upto = after;
  for (;;) {
    const page = await rows(
      ctx.db
        .from("note_updates")
        .select("id, update_b64")
        .eq("workspace_id", ctx.key.workspaceId)
        .eq("note_id", noteId)
        .gt("id", upto)
        .order("id", { ascending: true })
        .limit(UPDATE_PAGE),
    );
    const before = upto;
    for (const r of page) {
      if (typeof r.update_b64 === "string") updates.push(r.update_b64);
      upto = Math.max(upto, Number(r.id));
    }
    if (page.length < UPDATE_PAGE || upto === before) return { updates, upto };
  }
}

/** Log first, snapshot second (the app's pull order): a compaction in
 * between only makes the snapshot newer than the log, and applying both is
 * lossless. */
async function readNoteDoc(ctx: ToolContext, noteId: string) {
  const log = await noteUpdateLog(ctx, noteId);
  const note = await getNote(ctx, noteId, "id, body_md, doc_state");
  if (!note) throw new Error("Note not found in this workspace.");
  const snapshotB64 = typeof note.doc_state === "string" && note.doc_state ? note.doc_state : null;
  return { log, snapshotB64, bodyMd: String(note.body_md ?? "") };
}

type AgentPlan =
  /** The note has a body but no doc: seed it first, then plan again. */
  | { kind: "seed"; args: Row }
  | { kind: "write"; args: Row; readUpto: number }
  | { kind: "noop" };

/** Work out the write for an agent edit. Each tool makes the calls itself
 * (so the key-scope check sees which tool needs what). */
async function planAgentEdit(
  ctx: ToolContext,
  noteId: string,
  edit: AgentEdit,
  seeded = false,
): Promise<AgentPlan> {
  const lib = await notesDoc();
  const { log, snapshotB64, bodyMd } = await readNoteDoc(ctx, noteId);
  if (!seeded && !snapshotB64 && log.updates.length === 0 && bodyMd.trim()) {
    const built = lib.agentCreateDoc(noteId, bodyMd);
    if (built) {
      // Bodies stay as stored (an imported note keeps its raw file).
      return {
        kind: "seed",
        args: { p_note_id: noteId, p_doc_state_b64: built.docStateB64 },
      };
    }
  }
  const result = lib.agentWriteFromLog({ snapshotB64, updatesB64: log.updates, edit });
  if (!result.updateB64) return { kind: "noop" };
  return {
    kind: "write",
    readUpto: log.upto,
    args: {
      p_note_id: noteId,
      // A fresh client id per write: seq 1 can never collide with an earlier
      // write's row (a reused id would be dropped as a duplicate).
      p_client_id: `agent:${crypto.randomUUID()}`,
      p_updates: [{ clientSeq: 1, updateB64: result.updateB64 }],
      p_body_md: result.bodyMd,
      p_body_text: result.bodyText,
    },
  };
}

/** After the write: refuse a silent no-op (open editors hear of it from the
 * server: NR-7's note_updates trigger), and return the
 * arguments for a body re-save when another write landed between this one's
 * read and its insert (its bodies were derived without that write). */
async function afterAgentWrite(
  ctx: ToolContext,
  noteId: string,
  plan: { args: Row; readUpto: number },
  applied: Row | null,
): Promise<Row | null> {
  if (Number(applied?.inserted ?? 0) < 1) throw new Error("The edit could not be saved.");
  const since = await noteUpdateLog(ctx, noteId, plan.readUpto);
  if (since.updates.length <= 1) return null;
  const lib = await notesDoc();
  const { log, snapshotB64 } = await readNoteDoc(ctx, noteId);
  const body = lib.bodyFromLog({ snapshotB64, updatesB64: log.updates });
  return {
    p_note_id: noteId,
    p_client_id: plan.args.p_client_id,
    p_updates: null,
    p_body_md: body.bodyMd,
    p_body_text: body.bodyText,
  };
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
        "Create a note from markdown (optionally under a parent) — agents build whole trees this way. The note is immediately listable, searchable, publishable and editable, and lands in the Inbox when it has no parent.",
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
        // Built here, so the note opens complete everywhere, with no seeding.
        const built = (await notesDoc()).agentCreateDoc(id, bodyMd);
        if (!built) throw new Error("The note could not be built from that markdown.");
        const result = await callOp(ctx, "notes_op_import", {
          p_rows: [
            {
              id,
              parentId,
              title,
              docStateB64: built.docStateB64,
              bodyMd: built.bodyMd,
              bodyText: built.bodyText,
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
        "Append markdown to the end of a note. It appears live for anyone with the note open, is attributed to this key, and they can undo it.",
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
        const edit: AgentEdit = { kind: "append", markdown: addition };
        let plan = await planAgentEdit(ctx, noteId, edit);
        if (plan.kind === "seed") {
          await callOp(ctx, "notes_op_seed_doc", plan.args);
          plan = await planAgentEdit(ctx, noteId, edit, true);
        }
        if (plan.kind === "write") {
          const applied = await callOp(ctx, "notes_op_apply_updates", plan.args);
          const resave = await afterAgentWrite(ctx, noteId, plan, applied);
          if (resave) await callOp(ctx, "notes_op_apply_updates", resave);
        }
        return { id: noteId, ok: true };
      },
    },
    {
      name: "notes_update",
      description:
        "Replace a note's markdown body wholesale (optionally rename it). It appears live for anyone with the note open, is attributed to this key, and they can undo it.",
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
        // Preserve the current title as the first line when the caller didn't
        // pass a new one, so the first-line-title convention holds.
        let firstLine = title;
        if (!firstLine) {
          const cur = await getNote(ctx, noteId, "id, title");
          if (!cur) throw new Error("Note not found in this workspace.");
          firstLine = (cur.title ?? "").trim();
        }
        const edit: AgentEdit = { kind: "replace", markdown: composeBody(firstLine, body) };
        let plan = await planAgentEdit(ctx, noteId, edit);
        if (plan.kind === "seed") {
          await callOp(ctx, "notes_op_seed_doc", plan.args);
          plan = await planAgentEdit(ctx, noteId, edit, true);
        }
        if (plan.kind === "write") {
          const applied = await callOp(ctx, "notes_op_apply_updates", plan.args);
          const resave = await afterAgentWrite(ctx, noteId, plan, applied);
          if (resave) await callOp(ctx, "notes_op_apply_updates", resave);
        }
        // Renamed only once the body is in, so a failed edit leaves the title.
        if (title) {
          await callOp(ctx, "notes_op_rename", { p_note_id: noteId, p_title: title });
        }
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
