// Contact panel mail (AC30): "All mail with this person" and their files, plus
// the "Add as contact" suggestion for a non-contact (X23; never automatic).

import { Button } from "@/components/ui/button";
import type { MailMessage, MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { AttachmentList } from "../views/attachments";
import { type AttachmentEntry, collectAttachments } from "../views/attachments-model";
import { formatLastMailed } from "../views/format";

/** Threads where the person is a sender. */
export function threadsWithPerson(rows: readonly MailThreadRow[], email: string): MailThreadRow[] {
  const e = email.toLowerCase();
  return rows
    .filter((r) => r.senders.some((s) => s.email.toLowerCase() === e))
    .sort((a, b) => b.lastDateMs - a.lastDateMs);
}

/** Messages the person sent or received from you. */
export function messagesWithPerson<M extends MailMessage>(
  messages: readonly M[],
  email: string,
): M[] {
  const e = email.toLowerCase();
  return messages.filter(
    (m) =>
      m.from.email.toLowerCase() === e ||
      [...m.to, ...m.cc].some((a) => a.email.toLowerCase() === e),
  );
}

export function ContactMailPanel({
  email,
  name,
  rows,
  messages,
  nowMs,
  suggestAdd,
  onOpenThread,
  onPreview,
  onAddContact,
}: {
  email: string;
  name: string;
  rows: readonly MailThreadRow[];
  messages: readonly (MailMessage & { threadId: string })[];
  nowMs: number;
  suggestAdd: boolean;
  onOpenThread: (threadId: string) => void;
  onPreview: (entry: AttachmentEntry) => void;
  onAddContact: (email: string, name: string) => void;
}) {
  const threads = threadsWithPerson(rows, email);
  const files = collectAttachments(messagesWithPerson(messages, email));
  return (
    <div className="flex flex-col gap-4">
      {suggestAdd ? (
        <div className="flex items-center gap-2 px-4">
          <span className="flex-1 text-sm text-muted-foreground">
            You often reply to {name || email}.
          </span>
          <Button size="sm" variant="secondary" onClick={() => onAddContact(email, name)}>
            Add as contact
          </Button>
        </div>
      ) : null}
      <section aria-label="All mail with this person">
        <h3 className="px-4 text-xs font-medium text-muted-foreground">
          All mail with this person
        </h3>
        <ul className="flex flex-col">
          {threads.map((t) => (
            <li key={t.threadId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-1 text-left hover:bg-state-hover"
                onClick={() => onOpenThread(t.threadId)}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {t.subject || "(no subject)"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatLastMailed(t.lastDateMs, nowMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Files">
        <h3 className="px-4 text-xs font-medium text-muted-foreground">Files</h3>
        <AttachmentList entries={files} onPreview={onPreview} emptyTitle="No files" />
      </section>
    </div>
  );
}
