// The Contacts module-contract manifest (block CO-5, AC9).
//
// Contacts' AI-interactable surface: the people/company intent ops (writes) and
// the directory/roll-up/search reads. Consumed by the module registry
// (src/lib/module-registry.ts) and mirrored connector-side by
// supabase/functions/moduo-mcp/modules/contacts.ts. Keep in sync with the
// contacts RPCs (supabase/migrations/2026062612…contacts_module.sql +
// 2026062714…contacts_import.sql). Contacts rides the Tasks permission lane at
// alpha (permissionKey "tasks"; CO-1 decision a).

import type { ModuleManifest } from "../../lib/module-manifest";

export const contactsModuleManifest: ModuleManifest = {
  module: "contacts",
  summary:
    "A light CRM: people and companies as hub entities whose pages roll up every linked task, note, email, and payment — zero manual logging.",
  // Alpha: Contacts rides the Tasks permission lane (permissions_tasks). A
  // dedicated permissions_contacts is a one-line future migration (CO-1).
  permissionKey: "tasks",
  activityEntityTypes: ["contact", "company"],
  ops: [
    {
      op: "contacts.create",
      rpc: "contacts_op_create",
      summary: "Create a person; registers them in the entities registry so they're immediately linkable/@mentionable.",
      args: {
        p_workspace_id: "workspace uuid",
        p_name: "person's display name",
        p_email: "primary email (optional)",
        p_phone: "phone (optional)",
        p_title: "job title (optional)",
        p_company_id: "company uuid to associate (optional)",
        p_status: "flat status label: lead (default) | active | dormant | archived | a custom label",
        p_notes_inline: "one-line scratch note (optional)",
      },
    },
    {
      op: "contacts.update",
      rpc: "contacts_op_update",
      summary: "Edit a person's scalar fields (NULL args leave a field unchanged). A name change refreshes the registry label.",
      args: {
        p_workspace_id: "workspace uuid",
        p_contact_id: "contact uuid",
        p_name: "new name (optional)",
        p_email: "new primary email (optional)",
        p_phone: "new phone (optional)",
        p_title: "new title (optional)",
        p_notes_inline: "new scratch note (optional)",
        p_set_company: "true to set/clear the company FK (else company is left unchanged)",
        p_company_id: "company uuid (with p_set_company; NULL clears)",
      },
    },
    {
      op: "contacts.set_status",
      rpc: "contacts_op_set_status",
      summary: "Set a person's flat status (any non-empty label; no pipeline, no transition rules). No-op if unchanged.",
      args: { p_workspace_id: "workspace uuid", p_contact_id: "contact uuid", p_status: "the status label" },
    },
    {
      op: "contacts.link",
      rpc: "contacts_op_link",
      summary:
        "Link a contact/company to any other entity (idempotent, direction-agnostic), attributed to Contacts. Typical kinds: works-at, follow-up, references.",
      args: {
        p_workspace_id: "workspace uuid",
        p_contact_type: "the contact endpoint type: contact | company",
        p_contact_id: "the contact/company uuid",
        p_target_type: "other entity type (task|note|company|…)",
        p_target_id: "other entity uuid",
        p_relation_kind:
          "relation kind: references (default) | works-at | follow-up | mentions | attachment | spawned-from | blocks | paid-by",
        p_origin: "origin gesture: manual (default) | drag | mention | ref | suggest",
        p_contact_label: "best-effort contact label for the registry (optional)",
        p_target_label: "best-effort target label for the registry (optional)",
        p_target_icon: "target type glyph hint (optional)",
      },
    },
    {
      op: "contacts.unlink",
      rpc: "contacts_op_unlink",
      summary: "Soft-delete a link a contact/company owns (Undo-friendly, idempotent). Refuses links with no contact endpoint.",
      args: { p_workspace_id: "workspace uuid", p_link_id: "link uuid" },
    },
    {
      op: "contacts.import",
      rpc: "contacts_op_import",
      summary:
        "Bulk-import people from an already-deduped plan (one attributed op): each row op='create' | 'merge'; companies are resolved/created by name.",
      args: {
        p_workspace_id: "workspace uuid",
        p_rows:
          "jsonb array of { op:'create'|'merge', contactId?, name, email, phone, title, company, status } — the client previews dedupe before calling",
      },
    },
  ],
  resources: [
    { name: "contacts.list", summary: "All people + companies in the workspace (the directory source)." },
    { name: "contacts.get", summary: "A contact/company with its links (the roll-up hub source)." },
    { name: "contacts.search", summary: "Search people + companies by name / email." },
  ],
};
