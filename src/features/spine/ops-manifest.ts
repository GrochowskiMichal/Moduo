// The Spine (connective tissue) module-contract manifest (block CT-7, AC12).
//
// The spine's AI-interactable surface: the link / comment / notification intent
// ops (writes) and the registry-backed reads (entities.search, links.list,
// links.suggest). Consumed by the module registry (src/lib/module-registry.ts)
// and mirrored connector-side by supabase/functions/moduo-mcp/modules/links.ts.
// Keep in sync with the spine RPCs (supabase/migrations/2026062512…/2026062613…/
// 2026062712…spine_*.sql). The spine reuses the Tasks permission lane at alpha
// (permissionKey "tasks"; CT-1 decision a), so its scope rides on permissions_tasks.

import type { ModuleManifest } from "../../lib/module-manifest";

export const linksModuleManifest: ModuleManifest = {
  module: "links",
  summary:
    "The connective tissue: typed links between any two entities, polymorphic comments, and the derived notification feed.",
  // Alpha: the spine rides the Tasks permission lane (permissions_tasks). A
  // dedicated permissions_spine is a one-line future migration (CT-1).
  permissionKey: "tasks",
  // Link/comment activity is polymorphic — logged under the source entity's type.
  activityEntityTypes: ["task", "contact", "company", "note", "email", "event", "payment", "project"],
  ops: [
    {
      op: "links.create",
      rpc: "links_op_create",
      summary:
        "Link two entities with a typed, direction-agnostic relation (idempotent; rejects self-links and unknown kinds). Registers both endpoints.",
      args: {
        p_workspace_id: "workspace uuid",
        p_source_type: "source entity type (task|contact|company|note|…)",
        p_source_id: "source entity uuid",
        p_target_type: "target entity type",
        p_target_id: "target entity uuid",
        p_relation_kind:
          "relation kind: references (default) | spawned-from | blocks | attachment | mentions | works-at | follow-up | paid-by",
        p_origin: "origin gesture: manual (default) | drag | mention | ref | suggest",
        p_source_label: "best-effort source label for the registry (optional)",
        p_source_icon: "source type glyph hint (optional)",
        p_target_label: "best-effort target label for the registry (optional)",
        p_target_icon: "target type glyph hint (optional)",
      },
    },
    {
      op: "links.set_kind",
      rpc: "links_op_set_kind",
      summary: "Re-type an existing link's relation kind (re-groups it in the hub). No-op if unchanged.",
      args: {
        p_workspace_id: "workspace uuid",
        p_link_id: "link uuid",
        p_relation_kind: "new relation kind (closed set)",
      },
    },
    {
      op: "links.delete",
      rpc: "links_op_delete",
      summary: "Soft-delete a link (Undo-friendly, idempotent).",
      args: { p_workspace_id: "workspace uuid", p_link_id: "link uuid" },
    },
    {
      op: "links.decline_suggestion",
      rpc: "links_op_decline_suggestion",
      summary: "Record a 'no' for a suggested pair so it is never re-offered (direction-agnostic).",
      args: {
        p_workspace_id: "workspace uuid",
        p_source_type: "one endpoint's type",
        p_source_id: "one endpoint's uuid",
        p_target_type: "other endpoint's type",
        p_target_id: "other endpoint's uuid",
      },
    },
    {
      op: "comments.add",
      rpc: "comments_op_add",
      summary:
        "Add a comment to any entity; member @mentions become attributed notifications for those members.",
      args: {
        p_workspace_id: "workspace uuid",
        p_entity_type: "commented entity type",
        p_entity_id: "commented entity uuid",
        p_body: "comment text",
        p_mentioned_user_ids: "uuid[] of @-mentioned workspace members (optional)",
        p_entity_label: "best-effort entity label for the registry (optional)",
        p_entity_icon: "entity type glyph hint (optional)",
      },
    },
    {
      op: "notifications.mark_read",
      rpc: "notifications_op_mark_read",
      summary: "Mark one notification (activity row) read. Idempotent.",
      args: { p_workspace_id: "workspace uuid", p_activity_id: "module_activity uuid" },
    },
    {
      op: "notifications.mark_all_read",
      rpc: "notifications_op_mark_all_read",
      summary: "Mark every targeting-me notification in the workspace read.",
      args: { p_workspace_id: "workspace uuid" },
    },
  ],
  resources: [
    { name: "entities.search", summary: "Search the central registry by label (the @mention / link picker source)." },
    { name: "links.list", summary: "Every live link touching an entity (the hub roll-up source)." },
    {
      name: "links.suggest",
      summary: "Deterministic auto-suggested links for an entity (shared tags / email domain / time-window).",
    },
  ],
};
