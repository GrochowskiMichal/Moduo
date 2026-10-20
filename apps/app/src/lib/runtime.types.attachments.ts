/** The runtime port's attachments (implemented in runtime.web.attachments.ts). */

import type { AttachmentPreviewMime, AttachmentStatus } from "@contracts/vocabularies";
import type { Truncation } from "./paged-select";

/** One file on a task (AT-1). The bytes live in the private `attachments`
 * Storage bucket; this is the row. */
export type AttachmentRecord = {
  id: string;
  entityType: string;
  entityId: string;
  /** Null once the uploader's account is deleted. */
  uploaderId: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: AttachmentStatus;
  /** Set while the file is in the trash (restorable for 30 days). */
  deletedAt: string | null;
  createdAt: string;
  /** Storage paths in the `attachments` bucket (signed links only). */
  objectPath: string | null;
  previewPath: string | null;
  previewMime: AttachmentPreviewMime | null;
};

/** The owner's storage pool as `storage_status` reports it (AT-1). */
export type StorageStatus = {
  tier: string;
  perFileBytes: number;
  totalBytes: number;
  usedBytes: number;
  pendingBytes: number;
  /** 0, 80 or 95: the alert level the pool is at. */
  level: number;
  overLimit: boolean;
  isOwner: boolean;
  /** Only told to the owner. */
  ownedWorkspaces: number | null;
};

/** One row of Settings → Storage's largest-files list (`attachments_largest`, AT-3). */
export type LargestAttachment = {
  id: string;
  taskId: string;
  taskTitle: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  /** Null once the uploader's account is deleted. */
  uploaderId: string | null;
  createdAt: string;
  /** The reader has edit access to the task. */
  canDelete: boolean;
};

export type AttachmentBeginInput = {
  workspaceId: string;
  /** A task's file, or a chat message's (CV-9: the id the app minted, before it's sent). */
  entityType: "task" | "chat_message";
  entityId: string;
  /** chat_message only: the conversation it will be sent in (who may post decides). */
  channelId?: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  previewMime: AttachmentPreviewMime | null;
  width: number | null;
  height: number | null;
};

/**
 * Attachments (AT-1 storage, AT-2 upload) — files on tasks. `list` returns
 * every row this person can see (trash included; the workspace export reads
 * it), and [] until the migration reaches the database. Uploads go begin →
 * `uploadObject` (original, then preview) → finalize; refusals throw
 * `AttachmentOpError` with AT-1's machine code and numbers.
 */
export type AttachmentsRuntime = {
  list(workspaceId: string): Promise<{
    attachments: AttachmentRecord[];
    truncation: Truncation | null;
  }>;
  /** The ready, undeleted files on one entity, oldest first. */
  listForEntity(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
  }): Promise<AttachmentRecord[]>;
  begin(input: AttachmentBeginInput): Promise<AttachmentRecord>;
  uploadObject(input: {
    path: string;
    blob: Blob;
    contentType: string;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  }): Promise<void>;
  finalize(id: string): Promise<AttachmentRecord>;
  /** To the trash: the space is free at once, restorable for 30 days. */
  remove(id: string): Promise<AttachmentRecord>;
  restore(id: string): Promise<AttachmentRecord>;
  /**
   * Let go of one's own upload that never finished (dismissed, or begun
   * again): its space is free at once (AT-3). A finished file is left as it
   * is. Quiet on a database without the op.
   */
  abandon(id: string): Promise<void>;
  status(workspaceId: string): Promise<StorageStatus>;
  /**
   * Settings → Storage (AT-3): the biggest finished files in a workspace
   * whose task the reader can see, with whether the reader may delete each.
   */
  largest(workspaceId: string, limit?: number): Promise<LargestAttachment[]>;
  /** Signed links by path (missing paths are left out). */
  signedUrls(paths: string[], ttlSeconds: number): Promise<Map<string, string>>;
};
