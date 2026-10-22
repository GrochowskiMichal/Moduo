/** The web runtime's attachments (Supabase). */

import { ATTACHMENTS_BUCKET } from "@contracts/attachments";
import { attachmentRowSchema, mapKnownRows, requireRow } from "@contracts/rows";
import { isAttachmentPreviewMime, normalizeAttachmentStatus } from "@contracts/vocabularies";

import { READ_CAPS } from "./paged-select";
import { DbError, runRpc } from "./runtime.db";
import type { AttachmentRecord, AttachmentsRuntime, LargestAttachment } from "./runtime.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseClient } from "./runtime.web.client";
import { selectCapped } from "./runtime.web.shared";
import { AttachmentOpError, parseOpDetail } from "./uploads/errors";
import { uploadObject } from "./uploads/transport";

/** Map a raw `attachments` row (AT-1). Untyped client: keep in lockstep with
 * 20261008210500_attachments_storage.sql. */
function mapAttachmentRow(raw: unknown): AttachmentRecord {
  const r = requireRow(attachmentRowSchema, raw, "attachment");
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    uploaderId: r.uploader_id ?? null,
    fileName: r.file_name,
    mime: r.mime,
    sizeBytes: Number(r.size_bytes),
    width: r.width ?? null,
    height: r.height ?? null,
    status: normalizeAttachmentStatus(r.status),
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at,
    objectPath: r.object_path ?? null,
    previewPath: r.preview_path ?? null,
    previewMime: isAttachmentPreviewMime(r.preview_mime) ? r.preview_mime : null,
  };
}

const ATTACHMENT_COLUMNS =
  "id, entity_type, entity_id, uploader_id, file_name, mime, size_bytes, width, height, status, deleted_at, created_at, object_path, preview_path, preview_mime";

/** One row of `attachments_largest` (AT-3, 20261013272000) → the model. */
function mapLargestAttachmentRow(raw: unknown): LargestAttachment {
  const r = raw as Record<string, unknown> | null;
  if (typeof r?.id !== "string" || typeof r.task_id !== "string") {
    throw new Error("Malformed largest-files row");
  }
  return {
    id: r.id,
    taskId: r.task_id,
    taskTitle: typeof r.task_title === "string" ? r.task_title : "",
    fileName: typeof r.file_name === "string" ? r.file_name : "file",
    mime: typeof r.mime === "string" ? r.mime : "application/octet-stream",
    sizeBytes: Number.isFinite(Number(r.size_bytes)) ? Number(r.size_bytes) : 0,
    uploaderId: typeof r.uploader_id === "string" ? r.uploader_id : null,
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
    canDelete: r.can_delete === true,
  };
}

/** An attachments op's answer → the record, or AT-1's refusal as a typed error
 *  (machine code in the message, numbers as JSON in `details`). */
function attachmentOpResult(
  data: unknown,
  error: { message?: string; details?: unknown; code?: string } | null,
): AttachmentRecord {
  if (error) {
    const code = (error.message ?? "").trim();
    if (/^[a-z_]+$/.test(code)) throw new AttachmentOpError(code, parseOpDetail(error.details));
    throw new Error(error.message ?? "The attachment operation failed.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The operation returned nothing.");
  return mapAttachmentRow(row);
}

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.access_token ?? null;
}

export const webAttachments: AttachmentsRuntime = {
  async list(workspaceId) {
    const res = await selectCapped<any>({
      scope: "attachments",
      cap: READ_CAPS.attachments,
      build: (opts) =>
        supabaseClient
          .from("attachments")
          .select(ATTACHMENT_COLUMNS, opts)
          .eq("workspace_id", workspaceId)
          // Task files: a chat file is read with its conversation (CV-9).
          .eq("entity_type", "task"),
      order: (q) => q.order("created_at").order("id"),
    });
    if (res.error) {
      // Before AT-1's migration the table doesn't exist: nothing to list.
      if (res.error.code === "42P01" || res.error.code === "PGRST205") {
        return { attachments: [], truncation: null };
      }
      throw new DbError(res.error);
    }
    return { attachments: mapKnownRows(res.rows, mapAttachmentRow), truncation: res.truncation };
  },

  async listForEntity({ workspaceId, entityType, entityId }) {
    const { data, error } = await supabaseClient
      .from("attachments")
      .select(ATTACHMENT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("status", "ready")
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .limit(500);
    if (error) throw new DbError(error);
    return mapKnownRows(data ?? [], mapAttachmentRow);
  },

  async begin(input) {
    const { data, error } = await supabaseClient.rpc("attachments_op_begin", {
      p_workspace_id: input.workspaceId,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId,
      p_file_name: input.fileName,
      p_mime: input.mime,
      p_size_bytes: input.sizeBytes,
      p_preview_mime: input.previewMime,
      p_width: input.width,
      p_height: input.height,
      // CV-9: a chat file names its conversation (a task's call stays as it was).
      ...(input.channelId ? { p_channel_id: input.channelId } : {}),
    });
    return attachmentOpResult(data, error);
  },

  uploadObject({ path, blob, contentType, onProgress, signal }) {
    return uploadObject({
      supabaseUrl: SUPABASE_URL,
      apiKey: SUPABASE_PUBLISHABLE_KEY,
      getToken: currentAccessToken,
      bucket: ATTACHMENTS_BUCKET,
      path,
      blob,
      contentType,
      onProgress,
      signal,
    });
  },

  async finalize(id) {
    const { data, error } = await supabaseClient.rpc("attachments_op_finalize", { p_id: id });
    return attachmentOpResult(data, error);
  },

  async remove(id) {
    const { data, error } = await supabaseClient.rpc("attachments_op_delete", { p_id: id });
    return attachmentOpResult(data, error);
  },

  async restore(id) {
    const { data, error } = await supabaseClient.rpc("attachments_op_restore", { p_id: id });
    return attachmentOpResult(data, error);
  },

  async abandon(id) {
    const { error } = await supabaseClient.rpc("attachments_op_abandon", { p_id: id });
    if (!error) return;
    const code = (error.message ?? "").trim();
    if (/^[a-z_]+$/.test(code)) throw new AttachmentOpError(code, parseOpDetail(error.details));
    throw new Error(error.message ?? "Couldn't let the upload go.");
  },

  async largest(workspaceId, limit = 50) {
    const data = await runRpc(
      supabaseClient.rpc("attachments_largest", { p_workspace_id: workspaceId, p_limit: limit }),
    );
    return mapKnownRows((data ?? []) as unknown[], mapLargestAttachmentRow);
  },

  async status(workspaceId) {
    const { data, error } = await supabaseClient.rpc("storage_status", {
      p_workspace_id: workspaceId,
    });
    if (error) {
      const code = (error.message ?? "").trim();
      if (/^[a-z_]+$/.test(code)) throw new AttachmentOpError(code, parseOpDetail(error.details));
      throw new DbError(error);
    }
    const r = (data ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      tier: typeof r.tier === "string" ? r.tier : "free",
      perFileBytes: n(r.per_file_bytes),
      totalBytes: n(r.total_bytes),
      usedBytes: n(r.used_bytes),
      pendingBytes: n(r.pending_bytes),
      level: n(r.level),
      overLimit: r.over_limit === true,
      isOwner: r.is_owner === true,
      ownedWorkspaces: r.owned_workspaces == null ? null : n(r.owned_workspaces),
    };
  },

  async signedUrls(paths, ttlSeconds) {
    const out = new Map<string, string>();
    if (paths.length === 0) return out;
    const { data, error } = await supabaseClient.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(paths, ttlSeconds);
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
    }
    return out;
  },
};
