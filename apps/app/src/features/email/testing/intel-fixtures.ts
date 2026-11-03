import type { MailMessage, MailThreadRow } from "@/lib/runtime.types.mail-engine";

export function row(
  p: Partial<MailThreadRow> & { threadId: string; from: string; name?: string },
): MailThreadRow {
  const { from, name, ...rest } = p;
  return {
    accountId: "a1",
    subject: "s",
    snippet: "",
    senders: [{ name: name ?? "", email: from }],
    lastDateMs: 0,
    messageCount: 1,
    unread: false,
    pinned: false,
    hasAttachments: false,
    hasInvite: false,
    tab: "personal",
    priority: false,
    muted: false,
    snoozedUntilMs: null,
    ...rest,
  };
}

export function msg(
  p: Partial<MailMessage> & { id: string; threadId: string; from: string; to?: string[] },
): MailMessage & { threadId: string } {
  const { from, to, ...rest } = p;
  return {
    messageId: `<${p.id}@x>`,
    from: { name: "", email: from },
    to: (to ?? []).map((email) => ({ name: "", email })),
    cc: [],
    dateMs: 0,
    subject: "s",
    snippet: "",
    unread: false,
    bodyState: "full",
    html: null,
    text: null,
    quoteOffset: null,
    trackerCount: 0,
    attachments: [],
    listUnsubscribe: null,
    hasInvite: false,
    ...rest,
  };
}
