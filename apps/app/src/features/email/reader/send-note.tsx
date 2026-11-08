// The send notes in the reader (specs/mail-v3.md §8, AC11): a reply waiting in
// the Outbox reads "Waiting for connection" (or "Sending…") with Edit; a draft
// of this thread whose send failed reads "Not sent · {cause}" with Retry (or "Remove
// {file} and send" for a size limit) and Edit, which reopens it in the composer.

import { AlertTriangle, Pencil, Send, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { MailComposeEngine, MailDraftRow } from "@/lib/runtime.types.mail-compose";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { sendFailure } from "../compose/send-failure";

export type SendNoteState =
  | { kind: "outbox"; outboxId: string | null }
  | { kind: "failed"; reason: string; draft: MailDraftRow };

export type SendNotePort = Pick<MailComposeEngine, "listDrafts" | "listOutbox">;

/** The thread's failed draft first, else its queued send. */
async function readSendNote(port: SendNotePort, row: MailThreadRow): Promise<SendNoteState | null> {
  const drafts = (await port.listDrafts(row.accountId)).filter((d) => d.threadId === row.threadId);
  const failed = drafts.find((d) => d.doc.lastError);
  if (failed) return { kind: "failed", reason: failed.doc.lastError!, draft: failed };
  if (!row.outboxState) return null;
  const queued = new Set(drafts.filter((d) => d.queued).map((d) => d.id));
  const item = (await port.listOutbox(row.accountId)).find(
    (o) => o.draftId !== null && queued.has(o.draftId),
  );
  return { kind: "outbox", outboxId: item?.id ?? null };
}

/** Re-read whenever the thread or `refreshKey` (counts, thread version) changes. */
export function useSendNote(
  port: SendNotePort | null | undefined,
  row: MailThreadRow | null,
  refreshKey: string,
): SendNoteState | null {
  const [got, setGot] = useState<{ key: string; note: SendNoteState | null } | null>(null);
  const threadId = row?.threadId ?? null;
  const key = `${threadId}:${refreshKey}:${row?.outboxState ?? ""}`;
  useEffect(() => {
    if (!port || !row) return;
    let gone = false;
    void readSendNote(port, row).then(
      (note) => !gone && setGot({ key, note }),
      () => !gone && setGot({ key, note: null }),
    );
    return () => {
      gone = true;
    };
    // `row` is a fresh object per read; `key` names what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, key]);
  if (!row) return null;
  if (got?.key === key) return got.note;
  // Until the port answers, the row's own flag already says it is queued.
  return row.outboxState ? { kind: "outbox", outboxId: null } : null;
}

export function SendNote({
  note,
  offline,
  onEditOutbox,
  onFix,
  onRetry,
  onRemoveAndSend,
}: {
  note: SendNoteState;
  offline: boolean;
  onEditOutbox?: (outboxId: string) => void;
  /** Edit: reopens the draft. */
  onFix?: (draft: MailDraftRow) => void;
  onRetry?: (draft: MailDraftRow) => void;
  onRemoveAndSend?: (draft: MailDraftRow, filename: string) => void;
}) {
  if (note.kind === "failed") {
    // The cause first, unclipped, and the action that fits it (specs/mail-improve.md AC19).
    const f = sendFailure(note.reason, note.draft.doc.attachments);
    return (
      <div
        role="alert"
        className="mx-4 mb-2 flex items-start gap-2 rounded-md bg-tag-chip-surface p-2 text-sm"
      >
        <AlertTriangle aria-hidden className="mt-0.5 size-icon-sm shrink-0 text-warning" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="line-clamp-2 font-medium text-foreground">Not sent · {f.cause}</b>
          <small className="text-xs text-muted-foreground">
            Moduo put it back in Drafts with everything you wrote.
          </small>
        </div>
        {f.kind === "size" && f.file && onRemoveAndSend ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onRemoveAndSend(note.draft, f.file!)}
          >
            Remove {f.file} and send
          </Button>
        ) : onRetry ? (
          <Button size="sm" variant="secondary" onClick={() => onRetry(note.draft)}>
            Retry
          </Button>
        ) : null}
        {onFix ? (
          <Button size="sm" variant="ghost" onClick={() => onFix(note.draft)}>
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : null}
      </div>
    );
  }
  const id = note.outboxId;
  return (
    <div
      role="status"
      className="mx-4 mb-2 flex items-start gap-2 rounded-md bg-tag-chip-surface p-2 text-sm"
    >
      {offline ? (
        <WifiOff aria-hidden className="mt-0.5 size-icon-sm shrink-0 text-muted-foreground" />
      ) : (
        <Send aria-hidden className="mt-0.5 size-icon-sm shrink-0 text-muted-foreground" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="font-medium text-foreground">
          {offline ? "Waiting for connection" : "Sending…"}
        </b>
        <small className="text-xs text-muted-foreground">
          {offline
            ? "It waits in Outbox on this Mac and goes out on its own when you're back online."
            : "Edit pulls it back into Drafts before it leaves."}
        </small>
      </div>
      {id && onEditOutbox ? (
        <Button size="sm" variant="ghost" onClick={() => onEditOutbox(id)}>
          <Pencil aria-hidden />
          Edit
        </Button>
      ) : null}
    </div>
  );
}
