// Newsletters group by sender (AC25) and the Subscriptions view lists every
// newsletter sender with when they last mailed you (AC29, X6).

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

export type SenderGroup = {
  email: string;
  name: string;
  lastDateMs: number;
  unread: number;
  threadIds: string[];
  accountIds: string[];
};

/** The sender a row is grouped under: its newest sender. */
export function rowSender(row: MailThreadRow): { name: string; email: string } | null {
  return row.senders[row.senders.length - 1] ?? null;
}

/** Groups newsletter rows by sender, newest sender first. */
export function groupBySender(rows: readonly MailThreadRow[]): SenderGroup[] {
  const by = new Map<string, SenderGroup>();
  for (const row of rows) {
    if (row.tab !== "newsletters") continue;
    const s = rowSender(row);
    if (!s) continue;
    const key = s.email.toLowerCase();
    const g = by.get(key) ?? {
      email: key,
      name: s.name,
      lastDateMs: 0,
      unread: 0,
      threadIds: [],
      accountIds: [],
    };
    if (row.lastDateMs >= g.lastDateMs) {
      g.lastDateMs = row.lastDateMs;
      if (s.name) g.name = s.name;
    }
    if (row.unread) g.unread += 1;
    if (!g.threadIds.includes(row.threadId)) g.threadIds.push(row.threadId);
    if (!g.accountIds.includes(row.accountId)) g.accountIds.push(row.accountId);
    by.set(key, g);
  }
  return [...by.values()].sort(
    (a, b) => b.lastDateMs - a.lastDateMs || a.email.localeCompare(b.email),
  );
}
