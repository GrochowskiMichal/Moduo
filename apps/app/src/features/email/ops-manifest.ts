import type { ModuleManifest } from "../../lib/module-manifest";

/**
 * Email module manifest (EM-11, AC17) — the connector-side mirror of the email
 * tissue surface. Email is desktop-first; only "tissue" threads (deliberately
 * converted / linked / snoozed / followed-up) reach Supabase, so the MCP surface
 * is **metadata only** — no message body read, no send (spec Out of scope / Q-E6).
 *
 * Email has its OWN permission lane (`permissions_email` / a key's
 * `scopes->>'email'`) — `email_module_permission` carries the `module_api_key_id()`
 * branch from day one (EM-3), so a properly-scoped key's WRITES work (the
 * three-module gotcha). Keep this in lockstep with
 * supabase/functions/moduo-mcp/modules/email.ts descriptions.
 *
 * Convert-to-task minting is NOT an op here (tasks are written client-direct —
 * there is no `tasks_op_create` to PERFORM, and the tasks connector deliberately
 * mints nothing; EM-8 decision). An agent instead pulls a thread into the tissue
 * (`ref_upsert`) and `link`s it to an existing task/contact. Tags ride the shared
 * client-direct `tag_links` path (no RPC) — a connector tag write is an MCP-1
 * follow-up, so it is not declared here.
 */
export const emailModuleManifest: ModuleManifest = {
  module: "email",
  summary:
    "Email threads as hub entities — the tissue an inbox deliberately pulls in (convert / link / snooze / follow-up). Metadata only: from/subject/snippet + snooze & follow-up state; never the message body, never send.",
  permissionKey: "email",
  activityEntityTypes: ["email_thread"],
  ops: [
    {
      op: "email.ref_upsert",
      rpc: "email_op_ref_upsert",
      summary:
        "Pull a thread into the tissue (idempotent by thread key) — registers the email_thread entity so it's linkable/@mentionable. Metadata only (from/subject/snippet).",
      args: {
        p_workspace_id: "workspace uuid",
        p_thread_key: "the thread's stable key (the entity id)",
        p_account_id: "the cloud email_accounts uuid (optional)",
        p_message_key: "the newest message's key (optional)",
        p_from_addr: "sender address (optional)",
        p_from_name: "sender display name (optional)",
        p_subject: "subject (optional)",
        p_snippet: "preview snippet (optional)",
        p_sent_at: "the newest message timestamp (optional)",
      },
    },
    {
      op: "email.snooze",
      rpc: "email_op_snooze",
      summary: "Snooze a thread until a time — it leaves the inbox and returns when due.",
      args: {
        p_workspace_id: "workspace uuid",
        p_ref_id: "the email_refs uuid",
        p_snooze_until: "the return time (ISO timestamptz)",
      },
    },
    {
      op: "email.unsnooze",
      rpc: "email_op_unsnooze",
      summary: "Cancel a snooze — the thread returns to the inbox now.",
      args: { p_workspace_id: "workspace uuid", p_ref_id: "the email_refs uuid" },
    },
    {
      op: "email.follow_up",
      rpc: "email_op_follow_up",
      summary: "Set a follow-up reminder — notifies at the deadline if no reply arrived.",
      args: {
        p_workspace_id: "workspace uuid",
        p_ref_id: "the email_refs uuid",
        p_follow_up_at: "the reminder time (ISO timestamptz)",
      },
    },
    {
      op: "email.clear_follow_up",
      rpc: "email_op_clear_follow_up",
      summary: "Clear a follow-up reminder.",
      args: { p_workspace_id: "workspace uuid", p_ref_id: "the email_refs uuid" },
    },
    {
      op: "email.link",
      rpc: "email_op_link",
      summary:
        "Link a thread to another entity with a typed relation (idempotent; rides the spine). Use `references` for a manual connection, `spawned-from` when a task came from the thread.",
      args: {
        p_workspace_id: "workspace uuid",
        p_thread_id: "the email_thread entity id (the email_refs uuid, what ref_upsert registers)",
        p_target_type: "the other entity type (task|contact|company|note|…)",
        p_target_id: "the other entity uuid",
        p_relation_kind: "relation kind (default references)",
        p_origin: "'manual'",
      },
    },
    {
      op: "email.ref_remove",
      rpc: "email_op_ref_remove",
      summary:
        "Remove a thread from the tissue — soft-deletes the ref, drops its links, tombstones the entity (a clean convert-undo).",
      args: { p_workspace_id: "workspace uuid", p_ref_id: "the email_refs uuid" },
    },
  ],
  resources: [
    {
      name: "email.list",
      summary: "The tissue threads — from/subject/snippet + snooze & follow-up state.",
    },
    { name: "email.get", summary: "One tissue thread's metadata by ref id." },
    { name: "email.search", summary: "Search the tissue threads by sender / subject / snippet." },
  ],
};
