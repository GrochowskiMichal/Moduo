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
 * push the resulting update through `notes_op_apply_updates` as an agent
 * write. The server records the key and logs `notes.agent_edit`; the update
 * is broadcast on the note's live channel so an open editor shows it at once,
 * and a closed one pulls it on the next open. `body_md` / `body_text` come
 * from the same converter the app uses, so reads, search and publish agree
 * with the doc. Create builds the doc up front, so a new note is complete
 * the moment it exists.
 */

import type { ConnectorModule, ToolContext } from "../registry.ts";
import { assertReach, visibleIds } from "../share.ts";
import {
  agentCreateDoc,
  agentWriteFromLog,
} from "../../_shared/notes-doc/notes-doc.bundle.js";

/** Mirrors `AgentEdit` in src/features/notes/editor/agent-write.ts (the
 * bundle ships no types). */
type AgentEdit = { kind: "append" | "replace"; markdown: string };

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

/** The app's live channel for a note (src/features/notes/sync/notes-realtime.ts
 * `noteChannelName`, event `NOTE_UPDATE_EVENT`). */
const NOTE_CHANNEL_PREFIX = "notes:";
const NOTE_UPDATE_EVENT = "u";
const UPDATE_PAGE = 1000;

/** Every update row after the snapshot, paged past PostgREST's 1000-row cap. */
async function noteUpdateLog(ctx: ToolContext, noteId: string): Promise<string[]> {
  const out: string[] = [];
  let after = 0;
  for (;;) {
    const page = await rows(
      ctx.db
        .from("note_updates")
        .select("id, update_b64")
        .eq("workspace_id", ctx.key.workspaceId)
        .eq("note_id", noteId)
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(UPDATE_PAGE),
    );
    for (const r of page) {
      if (typeof r.update_b64 === "string") out.push(r.update_b64);
      after = Math.max(after, Number(r.id));
    }
    if (page.length < UPDATE_PAGE) return out;
  }
}

/** Tell open editors right away. Best effort: a missed broadcast is caught
 * up by the editor's next pull, so it never fails the write. */
async function broadcastAgentUpdate(ctx: ToolContext, noteId: string, updateB64: string) {
  const payload = {
    b64: updateB64,
    origin: "agent",
    keyId: ctx.key.id,
    label: ctx.key.name ?? null,
  };
  try {
    const channel = ctx.db.channel(`${NOTE_CHANNEL_PREFIX}${noteId}`);
    try {
      if (typeof channel.httpSend === "function") {
        await channel.httpSend(NOTE_UPDATE_EVENT, payload);
      } else {
        await channel.send({ type: "broadcast", event: NOTE_UPDATE_EVENT, payload });
      }
    } finally {
      await ctx.db.removeChannel(channel);
    }
  } catch (e) {
    console.warn("[notes] live broadcast failed; editors catch up on their next pull", e);
  }
}

/** Apply an agent edit to the note's doc as the server holds it. Returns
 * the `notes_op_apply_updates` arguments for the write, or null when the edit
 * changed nothing. The tool itself makes the call (so the key-scope check
 * sees which tool needs what). */
async function prepareAgentEdit(
  ctx: ToolContext,
  noteId: string,
  edit: AgentEdit,
): Promise<{ args: Row; updateB64: string } | null> {
  // Log first, snapshot second (the app's pull order): a compaction in between
  // only makes the snapshot newer than the log, and applying both is lossless.
  const updatesB64 = await noteUpdateLog(ctx, noteId);
  const note = await getNote(ctx, noteId, "id, body_md, doc_state");
  if (!note) throw new Error("Note not found in this workspace.");
  const result = agentWriteFromLog({
    noteId,
    snapshotB64: typeof note.doc_state === "string" && note.doc_state ? note.doc_state : null,
    updatesB64,
    bodyMd: String(note.body_md ?? ""),
    edit,
  });
  if (!result.updateB64) return null;
  return {
    updateB64: result.updateB64,
    args: {
      p_note_id: noteId,
      // A fresh client id per write: seq 1 can never collide with an earlier
      // write's row (a reused id would be dropped as a duplicate).
      p_client_id: `agent:${crypto.randomUUID()}`,
      p_updates: [{ clientSeq: 1, updateB64: result.updateB64 }],
      p_body_md: result.bodyMd,
      p_body_text: result.bodyText,
      p_origin: "agent",
    },
  };
}

/** After the write: refuse a silent no-op, then tell open editors. */
async function finishAgentEdit(
  ctx: ToolContext,
  noteId: string,
  applied: Row | null,
  updateB64: string,
): Promise<void> {
  if (Number(applied?.inserted ?? 0) < 1) throw new Error("The edit could not be saved.");
  await broadcastAgentUpdate(ctx, noteId, updateB64);
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
        const built = agentCreateDoc(id, bodyMd);
        const result = await callOp(ctx, "notes_op_import", {
          p_rows: [
            {
              id,
              parentId,
              title,
              docStateB64: built?.docStateB64 ?? null,
              bodyMd: built?.bodyMd ?? bodyMd,
              bodyText: built?.bodyText ?? mdToPlain(bodyMd),
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
        const edit = await prepareAgentEdit(ctx, noteId, { kind: "append", markdown: addition });
        if (edit) {
          const applied = await callOp(ctx, "notes_op_apply_updates", edit.args);
          await finishAgentEdit(ctx, noteId, applied, edit.updateB64);
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
        const edit = await prepareAgentEdit(ctx, noteId, {
          kind: "replace",
          markdown: composeBody(firstLine, body),
        });
        if (edit) {
          const applied = await callOp(ctx, "notes_op_apply_updates", edit.args);
          await finishAgentEdit(ctx, noteId, applied, edit.updateB64);
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
