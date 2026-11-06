// Attachments view (AC30): every attachment across synced mail, filterable by
// type, with Space/click preview handed to the reader's preview surface.

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { MailMessage } from "@/lib/runtime.types.mail-engine";

import {
  ATTACHMENT_TYPE_LABEL,
  ATTACHMENT_TYPES,
  type AttachmentEntry,
  type AttachmentType,
  collectAttachments,
} from "./attachments-model";
import { formatBytes } from "./format";

export function AttachmentList({
  entries,
  onPreview,
  emptyTitle = "No attachments",
}: {
  entries: readonly AttachmentEntry[];
  onPreview: (entry: AttachmentEntry) => void;
  emptyTitle?: string;
}) {
  const base = useId();
  if (entries.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <ul aria-label="Attachments" className="flex flex-col divide-y divide-border">
      {entries.map((e, i) => (
        <li key={`${e.messageId}:${e.attachment.id}`}>
          <button
            type="button"
            // Named by what it shows (axe label-content-name-mismatch); the verb is the title.
            aria-labelledby={`${base}-${i}-name ${base}-${i}-meta`}
            title={`Preview ${e.attachment.filename}`}
            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-state-hover"
            onClick={() => onPreview(e)}
            onKeyDown={(ev) => {
              if (ev.key === " ") {
                ev.preventDefault();
                onPreview(e);
              }
            }}
          >
            <span className="min-w-0 flex-1">
              <span id={`${base}-${i}-name`} className="block truncate text-sm text-foreground">
                {e.attachment.filename}
              </span>
              <span
                id={`${base}-${i}-meta`}
                className="block truncate text-xs text-muted-foreground"
              >
                {e.from.name || e.from.email} · {formatBytes(e.attachment.size)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachmentsView({
  messages,
  onPreview,
}: {
  messages: readonly (MailMessage & { threadId: string })[];
  onPreview: (entry: AttachmentEntry) => void;
}) {
  const [filter, setFilter] = useState<AttachmentType>("all");
  const entries = collectAttachments(messages, filter);
  return (
    <div className="flex flex-col">
      <div role="toolbar" aria-label="Filter by type" className="flex gap-1 px-4 py-2">
        {ATTACHMENT_TYPES.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={filter === t ? "secondary" : "ghost"}
            aria-pressed={filter === t}
            onClick={() => setFilter(t)}
          >
            {ATTACHMENT_TYPE_LABEL[t]}
          </Button>
        ))}
      </div>
      <AttachmentList entries={entries} onPreview={onPreview} />
    </div>
  );
}
