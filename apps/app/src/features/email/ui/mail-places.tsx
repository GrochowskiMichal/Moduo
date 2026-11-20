// Places that read the compose port, not the thread store (specs/mail-v3.md
// AC1, AC11): the Outbox list (`OutboxView`) and, at the top of Drafts, the
// sends that failed with "Not sent: {reason}" and Fix and send. MV-5 folds
// them into the row design; this block mounts them on real data.

import { Paperclip, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  MailComposeEngine,
  MailDraftRow,
  MailOutboxItem,
} from "@/lib/runtime.types.mail-compose";
import type { MailEngine, MailMessage } from "@/lib/runtime.types.mail-engine";

import { OutboxView } from "../compose/outbox-view";
import { sendFailure } from "../compose/send-failure";
import { emptyMailQuery } from "../search/query";
import { AttachmentsView } from "../views/attachments";
import type { AttachmentEntry } from "../views/attachments-model";
import { MiddleTruncate } from "./middle-truncate";

export { type SendFailure, sendFailure } from "../compose/send-failure";

/** A port read re-run whenever `key` changes; failures read as empty. */
function usePortRead<T>(read: () => Promise<T[]>, key: string): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    let gone = false;
    void read().then(
      (r) => !gone && setRows(r),
      () => !gone && setRows([]),
    );
    return () => {
      gone = true;
    };
    // `read` is rebuilt every render; `key` names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return rows;
}

export function OutboxPlace({
  port,
  refreshKey,
  nowMs,
  onEdit,
}: {
  port: MailComposeEngine;
  /** Changes when the outbox may have changed (counts, thread version). */
  refreshKey: string;
  nowMs: number;
  onEdit: (outboxId: string) => void;
}) {
  const items = usePortRead<MailOutboxItem>(() => port.listOutbox(), refreshKey);
  if (items.length === 0) {
    // The place stays while the user is on it, showing its empty copy (spec edge cases).
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Send}
          size="inline"
          title="Outbox is empty"
          description="Messages you send offline wait here."
        />
      </div>
    );
  }
  return (
    <div className="pane-scroll min-h-0 flex-1 overflow-y-auto">
      <OutboxView items={items} nowMs={nowMs} onEdit={onEdit} />
    </div>
  );
}

/** Drafts whose send failed (AC11, AC19): the cause first, on two lines at most, and the
 *  action that fits it: "Remove {file} and send" for a size limit, else Retry; Edit always. */
export function FailedSends({
  port,
  refreshKey,
  onFix,
  onRetry,
  onRemoveAndSend,
}: {
  port: MailComposeEngine;
  refreshKey: string;
  /** Edit: reopens the draft in the composer. */
  onFix: (draft: MailDraftRow) => void;
  onRetry?: (draft: MailDraftRow) => void;
  onRemoveAndSend?: (draft: MailDraftRow, filename: string) => void;
}) {
  const drafts = usePortRead<MailDraftRow>(() => port.listDrafts(), refreshKey);
  const failed = drafts.filter((d) => d.doc.lastError);
  if (failed.length === 0) return null;
  return (
    <ul aria-label="Not sent" className="mx-2 mb-2 flex flex-col divide-y divide-border">
      {failed.map((d) => {
        const f = sendFailure(d.doc.lastError!, d.doc.attachments);
        return (
          <li key={d.id} className="flex flex-col gap-1.5 px-1 py-2">
            <div className="flex min-w-0 flex-col text-sm">
              <span className="truncate text-foreground">{d.doc.subject || "(no subject)"}</span>
              <span className="truncate text-xs text-muted-foreground">
                To {d.doc.to.join(", ") || "no one yet"}
              </span>
              <span role="alert" className="line-clamp-2 text-xs text-destructive">
                Not sent · {f.cause}
              </span>
            </div>
            {f.kind === "size" && f.file ? (
              <span
                data-attachment-flag={f.file}
                className="flex max-w-full items-center gap-1 self-start rounded-md border border-warning px-1.5 py-0.5 text-xs text-warning"
              >
                <Paperclip aria-hidden className="size-3 shrink-0" />
                <MiddleTruncate text={f.file} />
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {f.kind === "size" && f.file ? (
                <Button size="sm" variant="secondary" onClick={() => onRemoveAndSend?.(d, f.file!)}>
                  Remove {f.file} and send
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => onRetry?.(d)}>
                  Retry
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onFix(d)}>
                Edit
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const NO_PORT_READ = async () => [];

/** Threads with a draft whose send failed: their rows carry "Not sent" (spec §3). */
export function useNotSentThreadIds(
  port: MailComposeEngine | null,
  refreshKey: string,
): ReadonlySet<string> {
  const drafts = usePortRead<MailDraftRow>(
    port ? () => port.listDrafts() : NO_PORT_READ,
    `${port ? "port" : "none"}:${refreshKey}`,
  );
  return useMemo(
    () =>
      new Set(drafts.filter((d) => d.doc.lastError && d.threadId).map((d) => d.threadId as string)),
    [drafts],
  );
}

/** How many conversations with files the Attachments place opens (newest first). */
export const ATTACHMENT_THREADS = 50;

/** The messages of the newest conversations with files (the engine's `has:attachment`). */
async function readAttachmentMessages(engine: MailEngine) {
  const rows = await engine.search({
    query: { ...emptyMailQuery(), hasAttachment: true },
    limit: ATTACHMENT_THREADS,
  });
  const threads = await Promise.all(rows.map((r) => engine.getThread(r.threadId)));
  return threads.flatMap((t) =>
    t
      ? t.messages.map((m): MailMessage & { threadId: string } => ({
          ...m,
          threadId: t.row.threadId,
        }))
      : [],
  );
}

/** The Attachments place (specs/mail-v3.md §1): every file across recent mail, by type. */
export function AttachmentsPlace({
  engine,
  refreshKey,
  onPreview,
}: {
  engine: MailEngine;
  refreshKey: string;
  onPreview: (entry: AttachmentEntry) => void;
}) {
  const messages = usePortRead(() => readAttachmentMessages(engine), refreshKey);
  return (
    <div className="pane-scroll min-h-0 flex-1 overflow-y-auto">
      <AttachmentsView messages={messages} onPreview={onPreview} />
    </div>
  );
}
