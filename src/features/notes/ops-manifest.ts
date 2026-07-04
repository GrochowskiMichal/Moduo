import type { ModuleManifest } from "../../lib/module-manifest";

/**
 * Notes module manifest (Wave-3 NO-10, AC13) — the connector-side mirror of the
 * app's notes surface. Reads come from `body_md` (the client-derived markdown;
 * the server never parses the CRDT). Writes ride the shipped `notes_op_*` RPCs.
 *
 * Notes has its OWN permission lane (`permissions_notes` / a key's
 * `scopes->>'notes'`), not the Tasks lane — `notes_module_permission` carries
 * the `module_api_key_id()` branch, so a properly-scoped key's WRITES work
 * (the three-module gotcha). Keep this in lockstep with
 * supabase/functions/moduo-mcp/modules/notes.ts descriptions.
 *
 * Materialization note (assumption 10): the connector writes `body_md`, not the
 * Yjs CRDT — a headless Deno Yjs builder was deliberately NOT attempted (the
 * `root-v2` XML shape is experimental/fragile; see gotchas). A connector-created
 * or -appended note is immediately listable / gettable-as-markdown / searchable
 * / exportable / publishable; the live editor materializes its CRDT on first
 * open (the recorded cross-device gap). The real CRDT write path is the MCP-1
 * follow-up.
 */
export const notesModuleManifest: ModuleManifest = {
  module: "notes",
  summary:
    "Notion-style nested notes as hub entities: arbitrary-depth pages, markdown in and out. Agents build whole doc trees; content is stored as CRDT but read/written as markdown.",
  permissionKey: "notes",
  activityEntityTypes: ["note"],
  ops: [
    {
      op: "notes.create",
      rpc: "notes_op_import",
      summary:
        "Create a note from markdown (optionally under a parent) — registers it so it's immediately linkable/@mentionable and searchable. Body materializes in the live editor on first open.",
      args: {
        p_workspace_id: "workspace uuid",
        p_rows: "a single-element array: [{ id?, parentId?, title, bodyMd, position? }]",
      },
    },
    {
      op: "notes.append",
      rpc: "notes_op_apply_updates",
      summary: "Append markdown to a note's body (adds to the read/search/publish source).",
      args: {
        p_workspace_id: "workspace uuid",
        p_note_id: "the note uuid",
        p_client_id: "writer id (the connector uses 'mcp')",
        p_updates: "null — the connector writes derived body only, not CRDT updates",
        p_body_md: "the full new markdown body (existing + appended)",
        p_body_text: "the derived plain text for FTS",
      },
    },
    {
      op: "notes.update",
      rpc: "notes_op_apply_updates",
      summary: "Replace a note's markdown body wholesale.",
      args: {
        p_workspace_id: "workspace uuid",
        p_note_id: "the note uuid",
        p_client_id: "writer id ('mcp')",
        p_updates: "null",
        p_body_md: "the replacement markdown body",
        p_body_text: "the derived plain text for FTS",
      },
    },
    {
      op: "notes.move",
      rpc: "notes_op_move",
      summary: "Reparent/reorder a note in the tree (cycle-guarded server-side).",
      args: {
        p_workspace_id: "workspace uuid",
        p_note_id: "the note uuid",
        p_parent_id: "new parent uuid, or null for a root",
        p_position: "fractional position among the new siblings (optional)",
      },
    },
    {
      op: "notes.archive",
      rpc: "notes_op_archive",
      summary: "Archive a note (with its subtree) — hides it from the tree, reversible.",
      args: { p_workspace_id: "workspace uuid", p_note_id: "the note uuid" },
    },
    {
      op: "notes.trash",
      rpc: "notes_op_trash",
      summary: "Move a note (with its subtree) to the Trash (soft-delete; 30-day purge).",
      args: { p_workspace_id: "workspace uuid", p_note_id: "the note uuid" },
    },
    {
      op: "notes.link",
      rpc: "links_op_create",
      summary:
        "Link a note to another entity with a typed relation (idempotent; rides the spine). Notes use `references` for a manual connection.",
      args: {
        p_workspace_id: "workspace uuid",
        p_source_type: "'note'",
        p_source_id: "the note uuid",
        p_target_type: "the other entity type (task|contact|company|note|…)",
        p_target_id: "the other entity uuid",
        p_relation_kind: "relation kind (default references)",
        p_origin: "'manual'",
      },
    },
  ],
  resources: [
    { name: "notes.list", summary: "The note tree — id, title, parent, icon, published flag (the sidebar/tree source)." },
    { name: "notes.get", summary: "One note as markdown (`body_md`) plus its meta — the read source." },
    { name: "notes.search", summary: "Full-text search over note titles + body (the FTS index)." },
  ],
};
