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
 * Writes are real CRDT changes (NR-6, closing MCP-1's notes half): the
 * connector rebuilds the note's Yjs doc with the app's own headless editor
 * (a prebuilt bundle), pushes the edit's update, and derives `body_md` with
 * the same converter the app uses. A created note is stored with its doc.
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
        "Create a note from markdown (optionally under a parent) — registers it so it's immediately linkable/@mentionable and searchable. The connector builds its document up front, so it opens complete.",
      args: {
        p_workspace_id: "workspace uuid",
        p_rows:
          "a single-element array: [{ id?, parentId?, title, bodyMd, bodyText, docStateB64, position? }]",
      },
    },
    {
      op: "notes.append",
      rpc: "notes_op_apply_updates",
      summary:
        "Append markdown to a note as a real document change (NR-6): it appears live in open editors, is attributed to the key, and can be undone.",
      args: {
        p_workspace_id: "workspace uuid",
        p_note_id: "the note uuid",
        p_client_id: "writer id (the connector uses a fresh 'agent:<uuid>' per write)",
        p_updates: "[{ clientSeq: 1, updateB64 }] — the edit's own Yjs update",
        p_body_md: "the markdown derived from the edited document",
        p_body_text: "the derived plain text for FTS",
      },
    },
    {
      op: "notes.update",
      rpc: "notes_op_apply_updates",
      summary:
        "Replace a note's body wholesale as a real document change (NR-6), attributed and undoable like an append.",
      args: {
        p_workspace_id: "workspace uuid",
        p_note_id: "the note uuid",
        p_client_id: "writer id ('agent:<uuid>')",
        p_updates: "[{ clientSeq: 1, updateB64 }] — the edit's own Yjs update",
        p_body_md: "the markdown derived from the edited document",
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
        p_follow_parent:
          "true: also follow the new parent's sharing, in the same transaction (optional, default false)",
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
      alsoNeeds: ["links"],
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
    {
      name: "notes.list",
      summary: "The note tree — id, title, parent, icon, published flag (the sidebar/tree source).",
    },
    {
      name: "notes.get",
      summary: "One note as markdown (`body_md`) plus its meta — the read source.",
    },
    { name: "notes.search", summary: "Full-text search over note titles + body (the FTS index)." },
  ],
};
