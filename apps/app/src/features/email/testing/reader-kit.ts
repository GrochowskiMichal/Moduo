// Test doubles for the reader's tests: a message and a thread builder and an
// engine that serves one thread (no store, no IMAP, never Supabase).

import type {
  MailEngine,
  MailMessage,
  MailThread,
  MailThreadRow,
} from "@/lib/runtime.types.mail-engine";

export const NOW = Date.UTC(2026, 10, 5, 10); // Thu 5 Nov 2026

export function message(over: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "m1",
    messageId: "<m1@acme.test>",
    from: { name: "Jonas Weber", email: "jonas@acme.test" },
    to: [{ name: "Robin Hale", email: "robin@me.test" }],
    cc: [],
    dateMs: NOW - 3_600_000,
    subject: "Pilot week",
    snippet: "Can you confirm by Thursday?",
    unread: false,
    bodyState: "full",
    html: null,
    text: "Can you confirm by Thursday?",
    quoteOffset: null,
    trackerCount: 0,
    attachments: [],
    listUnsubscribe: null,
    hasInvite: false,
    ...over,
  };
}

export function row(over: Partial<MailThreadRow> = {}): MailThreadRow {
  return {
    threadId: "t1",
    accountId: "acc-1",
    subject: "Pilot week",
    snippet: "Can you confirm by Thursday?",
    senders: [{ name: "Jonas Weber", email: "jonas@acme.test" }],
    lastDateMs: NOW - 3_600_000,
    messageCount: 1,
    unread: false,
    pinned: false,
    hasAttachments: false,
    hasInvite: false,
    tab: "personal",
    priority: false,
    muted: false,
    snoozedUntilMs: null,
    ...over,
  };
}

/** An engine that serves `thread()` (re-read on every call, so a test can swap it). */
export function oneThreadEngine(
  thread: () => MailThread,
  extra: Partial<MailEngine> = {},
): MailEngine {
  return {
    getThread: async (id: string) => (thread().row.threadId === id ? thread() : null),
    subscribe: () => () => {},
    ...extra,
  } as unknown as MailEngine;
}
