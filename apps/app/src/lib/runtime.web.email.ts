/** The web runtime's email (Supabase). */

import {
  emailAccountRowSchema,
  emailRefRowSchema,
  mapKnownRows,
  parsedMailboxProvider,
  requireRow,
} from "@contracts/rows";
import { collectTruncations, READ_CAPS } from "./paged-select";
import { runRpc, untypedDb } from "./runtime.db";
import type { EmailAccountRef, EmailRuntime, EmailThreadRef } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { desktopOnly, firstRow, type SelectOpts, selectCapped } from "./runtime.web.shared";

// ── Email module (EM-3) row → model mappers ───────────────────────────────────
function emailAccountRowToModel(raw: unknown): EmailAccountRef {
  const r = requireRow(emailAccountRowSchema, raw, "email account");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id,
    provider: parsedMailboxProvider(r.provider),
    address: r.address,
    status: r.status,
    signatureHtml: r.signature_html ?? "",
    unreadCount: r.unread_count ?? 0,
    color: r.color ?? null,
    lastSyncAt: r.last_sync_at ?? null,
    lastError: r.last_error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function emailRefRowToModel(raw: unknown): EmailThreadRef {
  const r = requireRow(emailRefRowSchema, raw, "email ref");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id,
    accountId: r.account_id ?? null,
    threadKey: r.thread_key,
    messageKey: r.message_key ?? null,
    fromAddr: r.from_addr ?? null,
    fromName: r.from_name ?? null,
    subject: r.subject ?? "",
    snippet: r.snippet ?? "",
    sentAt: r.sent_at ?? null,
    isSnoozed: Boolean(r.is_snoozed),
    snoozeUntil: r.snooze_until ?? null,
    followUpAt: r.follow_up_at ?? null,
    followUpClearedAt: r.follow_up_cleared_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const webEmail: EmailRuntime = {
  async listAccounts() {
    return [];
  },
  async connectAndSave() {
    throw new Error(desktopOnly().message);
  },
  async disconnect() {
    throw new Error(desktopOnly().message);
  },
  async listEnvelopes() {
    throw new Error(desktopOnly().message);
  },
  async getMessageBody() {
    throw new Error(desktopOnly().message);
  },
  async prefetchBodies() {
    throw new Error(desktopOnly().message);
  },
  async syncNow() {
    throw new Error(desktopOnly().message);
  },
  async setActivityState() {
    /* no-op on web */
  },
  async applyFlag() {
    throw new Error(desktopOnly().message);
  },
  async getMailboxStatus() {
    return [];
  },
  async setHistoryDepth() {
    throw new Error(desktopOnly().message);
  },
  async sendSaved() {
    throw new Error(desktopOnly().message);
  },
  async startGoogleOAuth() {
    throw new Error(desktopOnly().message);
  },
  async getThread() {
    throw new Error(desktopOnly().message);
  },
  async listFolders() {
    return [];
  },
  async applyMessageOp() {
    throw new Error(desktopOnly().message);
  },
  async snoozeThread() {
    throw new Error(desktopOnly().message);
  },
  async snoozeRestore() {
    throw new Error(desktopOnly().message);
  },
  async sendMessage() {
    throw new Error(desktopOnly().message);
  },
  async listAttachments() {
    return [];
  },
  async saveAttachment() {
    throw new Error(desktopOnly().message);
  },
  async pickAttachments() {
    return [];
  },
  async getInlineImages() {
    return [];
  },
  // Local search rides the desktop engine cache — web has no envelopes to scan.
  async searchBodies() {
    return [];
  },
  async searchServer() {
    return { status: "unsupported", message: null, envelopes: [] };
  },

  // ── EM-3 cloud tissue surface (Supabase-first; works on web + desktop) ──
  async listModule(workspaceId) {
    try {
      const live = (table: string) => (opts?: SelectOpts) =>
        untypedDb(supabaseClient)
          .from(table)
          .select("*", opts)
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null);
      const [accountsRes, refsRes] = await Promise.all([
        selectCapped<any>({
          scope: "mailboxes",
          cap: READ_CAPS.emailAccounts,
          build: live("email_accounts"),
          order: (q) => q.order("created_at", { ascending: true }).order("id"),
        }),
        selectCapped<any>({
          scope: "threads",
          cap: READ_CAPS.emailRefs,
          build: live("email_refs"),
          order: (q) => q.order("updated_at", { ascending: false }).order("id"),
        }),
      ]);
      // Either table missing (pre-migration) → degrade to empty, never crash.
      if (accountsRes.error || refsRes.error) {
        return { accounts: [], refs: [], degraded: true, truncated: [] };
      }
      return {
        accounts: mapKnownRows(accountsRes.rows, emailAccountRowToModel),
        refs: mapKnownRows(refsRes.rows, emailRefRowToModel),
        degraded: false,
        truncated: collectTruncations(accountsRes.truncation, refsRes.truncation),
      };
    } catch {
      return { accounts: [], refs: [], degraded: true, truncated: [] };
    }
  },
  async upsertAccountRef({
    workspaceId,
    provider,
    address,
    signatureHtml,
    color,
    status,
    unreadCount,
  }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_account_upsert", {
        p_workspace_id: workspaceId,
        p_provider: provider,
        p_address: address,
        p_signature_html: signatureHtml ?? null,
        p_color: color ?? null,
        p_status: status ?? null,
        p_unread_count: unreadCount ?? null,
      }),
    );
    return emailAccountRowToModel(firstRow(data, "email_op_account_upsert"));
  },
  async removeAccountRef({ workspaceId, accountId }) {
    await runRpc(
      supabaseClient.rpc("email_op_account_remove", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
      }),
    );
  },
  async upsertRef({
    workspaceId,
    threadKey,
    accountId,
    messageKey,
    fromAddr,
    fromName,
    subject,
    snippet,
    sentAt,
  }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_ref_upsert", {
        p_workspace_id: workspaceId,
        p_thread_key: threadKey,
        p_account_id: accountId ?? null,
        p_message_key: messageKey ?? null,
        p_from_addr: fromAddr ?? null,
        p_from_name: fromName ?? null,
        p_subject: subject ?? "",
        p_snippet: snippet ?? "",
        p_sent_at: sentAt ?? null,
      }),
    );
    return emailRefRowToModel(firstRow(data, "email_op_ref_upsert"));
  },
  async snooze({ workspaceId, refId, snoozeUntil }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_snooze", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
        p_snooze_until: snoozeUntil,
      }),
    );
    return emailRefRowToModel(firstRow(data, "email_op_snooze"));
  },
  async unsnooze({ workspaceId, refId }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_unsnooze", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      }),
    );
    return emailRefRowToModel(firstRow(data, "email_op_unsnooze"));
  },
  async snoozeDue({ workspaceId, refId }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_snooze_due", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      }),
    );
    return emailRefRowToModel(firstRow(data, "email_op_snooze_due"));
  },
  async followUp({ workspaceId, refId, followUpAt }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_follow_up", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
        p_follow_up_at: followUpAt,
      }),
    );
    return emailRefRowToModel(firstRow(data, "email_op_follow_up"));
  },
  async clearFollowUp({ workspaceId, refId }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_clear_follow_up", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      }),
    );
    return emailRefRowToModel(firstRow(data, "email_op_clear_follow_up"));
  },
  async followUpDue({ workspaceId, refId }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_follow_up_due", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      }),
    );
    // Returns SQL NULL (→ no row) when there's nothing to do; not an error.
    // Guard on row.id too (the all-NULL-composite gotcha) like deleteLink does.
    const row = Array.isArray(data) ? data[0] : data;
    return row?.id ? emailRefRowToModel(row) : null;
  },
  async removeRef({ workspaceId, refId }) {
    await runRpc(
      supabaseClient.rpc("email_op_ref_remove", {
        p_workspace_id: workspaceId,
        p_ref_id: refId,
      }),
    );
  },
  async linkThread({
    workspaceId,
    threadId,
    targetType,
    targetId,
    relationKind,
    origin,
    threadLabel,
    targetLabel,
    targetIcon,
  }) {
    const data = await runRpc(
      supabaseClient.rpc("email_op_link", {
        p_workspace_id: workspaceId,
        p_thread_id: threadId,
        p_target_type: targetType,
        p_target_id: targetId,
        p_relation_kind: relationKind ?? "references",
        p_origin: origin ?? "manual",
        p_thread_label: threadLabel ?? null,
        p_target_label: targetLabel ?? null,
        p_target_icon: targetIcon ?? null,
      }),
    );
    return firstRow(data, "email_op_link");
  },
};
