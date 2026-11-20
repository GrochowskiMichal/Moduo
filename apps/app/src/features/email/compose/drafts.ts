// Drafts UX (AC21): the Drafts list reads the engine (local plus server
// drafts made elsewhere), and a draft reopens as a compose. A draft whose send
// failed carries the reason, shown on reopen (AC22, E44).

import type { MailDraftRow } from "@/lib/runtime.types.mail-compose";

import type { ComposeOpenSpec } from "./session";

export function draftToOpenSpec(
  row: MailDraftRow,
  opts: { fromInbox?: boolean } = {},
): ComposeOpenSpec {
  const d = row.doc;
  return {
    kind: d.inReplyTo ? "reply" : "new",
    accountId: row.accountId,
    threadId: row.threadId,
    draftId: row.id,
    fromAddr: d.fromAddr,
    fromName: d.fromName,
    to: d.to.join(", "),
    cc: d.cc.join(", "),
    bcc: d.bcc.join(", "),
    subject: d.subject,
    bodyHtml: d.html ?? d.text,
    inReplyTo: d.inReplyTo,
    references: d.references,
    attachments: d.attachments,
    fromInbox: opts.fromInbox ?? false,
    lastError: d.lastError,
  };
}

/** The draft for a thread, so `r` on a thread with a saved reply resumes it. */
export function draftForThread(rows: MailDraftRow[], threadId: string): MailDraftRow | null {
  return rows.find((r) => r.threadId === threadId && !r.queued) ?? null;
}
