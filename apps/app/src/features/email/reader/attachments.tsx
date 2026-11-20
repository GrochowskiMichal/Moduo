// The reader's attachments strip (MR-10, AC17): one chip per real attachment.
// Space on a focused chip opens the Quick-Look-style preview; dragging a chip
// gives Finder the file (`DownloadURL`) and a Moduo task or day a link to the
// thread (`application/x-moduo-entity`).

import { type DragEvent, type KeyboardEvent, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MailAttachment } from "@/lib/runtime.types.mail-engine";

import { MiddleTruncate } from "../ui/middle-truncate";
import { ATTACHMENT_TYPE_LABEL, attachmentType } from "../views/attachments-model";

export const MODUO_ENTITY_MIME = "application/x-moduo-entity";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The dataTransfer entries a dragged attachment carries. */
export function attachmentDragPayload(
  a: MailAttachment,
  ctx: { threadId: string; messageId: string; fileUrl?: string | null },
): Record<string, string> {
  const out: Record<string, string> = {
    [MODUO_ENTITY_MIME]: JSON.stringify({
      type: "email_thread",
      id: ctx.threadId,
      label: a.filename,
    }),
    "text/plain": a.filename,
  };
  if (ctx.fileUrl) out.DownloadURL = `${a.mime}:${a.filename}:${ctx.fileUrl}`;
  return out;
}

export type AttachmentStripProps = {
  attachments: readonly MailAttachment[];
  threadId: string;
  messageId: string;
  /** The attachment's local file URL once cached (Finder drags need it). */
  fileUrl?: (a: MailAttachment) => string | null;
  /** An inline URL the preview can show (the engine's `data:` URL); falls back to `fileUrl`. */
  previewUrl?: (a: MailAttachment) => string | null;
  onPreview?: (a: MailAttachment) => void;
  onOpen?: (a: MailAttachment) => void;
};

export function AttachmentStrip({
  attachments,
  threadId,
  messageId,
  fileUrl,
  previewUrl: inlineUrl,
  onPreview,
  onOpen,
}: AttachmentStripProps) {
  const [preview, setPreview] = useState<MailAttachment | null>(null);
  const files = attachments.filter((a) => !a.isInline);
  if (files.length === 0) return null;

  const showPreview = (a: MailAttachment) => {
    setPreview(a);
    onPreview?.(a);
  };
  const onKeyDown = (a: MailAttachment) => (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    showPreview(a);
  };
  const onDragStart = (a: MailAttachment) => (e: DragEvent) => {
    const payload = attachmentDragPayload(a, { threadId, messageId, fileUrl: fileUrl?.(a) });
    for (const [type, value] of Object.entries(payload)) e.dataTransfer.setData(type, value);
    e.dataTransfer.effectAllowed = "copyLink";
  };

  const previewUrl = preview ? (inlineUrl?.(preview) ?? fileUrl?.(preview) ?? null) : null;
  return (
    <>
      <ul aria-label="Attachments" className="flex flex-wrap gap-2">
        {files.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              draggable
              onDragStart={onDragStart(a)}
              onKeyDown={onKeyDown(a)}
              onClick={() => (onOpen ? onOpen(a) : showPreview(a))}
              className="flex items-center gap-2 rounded-md border border-hairline px-2 py-1 text-xs text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Cut in the middle: the version and extension stay (§4, AC18). */}
              <MiddleTruncate text={a.filename} className="max-w-48" />
              <span className="text-muted-foreground">{formatBytes(a.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={preview !== null} onOpenChange={(o) => (o ? null : setPreview(null))}>
        <DialogContent>
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle>{preview.filename}</DialogTitle>
                <DialogDescription>
                  {ATTACHMENT_TYPE_LABEL[attachmentType(preview)]} · {formatBytes(preview.size)}
                </DialogDescription>
              </DialogHeader>
              {previewUrl && preview.mime.startsWith("image/") ? (
                <img
                  src={previewUrl}
                  alt={preview.filename}
                  className="max-h-96 w-full object-contain"
                />
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
