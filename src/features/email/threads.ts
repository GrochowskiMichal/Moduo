// Pure inbox-shaping logic (EM-4): group synced envelopes into conversation rows
// across accounts. No I/O — unit-tested in threads.test.ts.

import type { EmailEnvelope, EmailThread, SavedAccount } from "./model/email-types";

function toMs(raw: string): number {
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Group envelopes into one thread per (accountId, threadId), rolled up. */
export function shapeInboxThreads(
  envelopes: EmailEnvelope[],
  accounts: SavedAccount[],
): EmailThread[] {
  const emailById = new Map(accounts.map((a) => [a.id, a.email] as const));
  const groups = new Map<string, EmailEnvelope[]>();

  for (const env of envelopes) {
    const key = `${env.accountId}::${env.threadId}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(env);
    else groups.set(key, [env]);
  }

  const threads: EmailThread[] = [];
  for (const bucket of groups.values()) {
    // Chronological (oldest → newest); newest drives the row's headline fields.
    const sorted = [...bucket].sort((a, b) => toMs(a.date) - toMs(b.date) || a.uid - b.uid);
    const latest = sorted[sorted.length - 1];

    const participants: string[] = [];
    for (const env of sorted) {
      const name = env.sender.trim();
      if (name && !participants.includes(name)) participants.push(name);
    }

    const unreadCount = sorted.reduce((n, env) => n + (env.read ? 0 : 1), 0);
    // The subject is the newest non-empty one (a bare "Re:" reply inherits it).
    const subject =
      [...sorted].reverse().find((env) => env.subject.trim() && env.subject !== "(No subject)")
        ?.subject ??
      latest.subject ??
      "(No subject)";

    threads.push({
      threadId: latest.threadId,
      accountId: latest.accountId,
      accountEmail: emailById.get(latest.accountId) ?? "",
      subject,
      participants,
      fromName: latest.sender,
      fromEmail: latest.senderEmail,
      snippet: latest.preview,
      date: latest.date,
      timestampMs: toMs(latest.date),
      messageCount: sorted.length,
      unread: unreadCount > 0,
      unreadCount,
      starred: sorted.some((env) => env.starred),
      folder: latest.folder,
      latestUid: latest.uid,
      // Smart-inbox signals ride the newest message (EM-10).
      listUnsubscribe: latest.listUnsubscribe ?? null,
      precedence: latest.precedence ?? null,
      autoSubmitted: latest.autoSubmitted ?? null,
    });
  }

  // Pinned (starred) float to the top; otherwise newest-first (brief §3).
  return threads.sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    return b.timestampMs - a.timestampMs;
  });
}

/** Total unread across a set of threads (for the nav badge / account counts). */
export function unreadCount(threads: EmailThread[]): number {
  return threads.reduce((n, t) => n + t.unreadCount, 0);
}

/** Threads for one account (the per-account rail filter). */
export function threadsForAccount(threads: EmailThread[], accountId: string): EmailThread[] {
  return threads.filter((t) => t.accountId === accountId);
}
