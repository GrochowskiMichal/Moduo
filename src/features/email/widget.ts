// Pure shaper for the "Inbox & follow-ups" dashboard widget (EM-11, AC18). Over
// the cloud tissue bundle (accounts with desktop-pushed unread counts + tissue
// refs), it surfaces: unread-per-account, snoozed threads returning today, and
// follow-ups awaiting a reply. No I/O — unit-tested in widget.test.ts.

import type { EmailModuleBundle, EmailThreadRef } from "../../lib/runtime.types";
import { isAwaitingFollowUp } from "./refs";

export type EmailInboxAccountRow = {
  id: string;
  address: string;
  provider: string;
  unread: number;
};

export type EmailInboxThreadRow = {
  refId: string;
  threadKey: string;
  fromName: string;
  subject: string;
  /** The relevant time (snooze return / follow-up deadline), ISO or null. */
  when: string | null;
};

export type EmailInboxView = {
  accounts: EmailInboxAccountRow[];
  totalUnread: number;
  snoozedDueToday: EmailInboxThreadRow[];
  awaitingFollowUp: EmailInboxThreadRow[];
  /** True pre-migration (cloud tables absent) — the widget shows a calm note. */
  degraded: boolean;
};

function parseMs(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function endOfLocalDayMs(now: Date): number {
  const d = new Date(now.getTime());
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function fromLabel(ref: EmailThreadRef): string {
  return ref.fromName?.trim() || ref.fromAddr?.trim() || "Unknown sender";
}

function threadRow(ref: EmailThreadRef, when: string | null): EmailInboxThreadRow {
  return {
    refId: ref.id,
    threadKey: ref.threadKey,
    fromName: fromLabel(ref),
    subject: ref.subject?.trim() || "(No subject)",
    when,
  };
}

export function shapeEmailInbox(
  bundle: EmailModuleBundle,
  opts: { now: Date; limit?: number },
): EmailInboxView {
  const limit = opts.limit ?? 5;
  const endToday = endOfLocalDayMs(opts.now);

  const accounts: EmailInboxAccountRow[] = bundle.accounts
    .map((a) => ({
      id: a.id,
      address: a.address,
      provider: a.provider,
      unread: Math.max(0, a.unreadCount),
    }))
    .sort((a, b) => b.unread - a.unread || a.address.localeCompare(b.address));
  const totalUnread = accounts.reduce((n, a) => n + a.unread, 0);

  // Snoozed threads returning today (or overdue-but-still-snoozed) — newest-due first.
  const snoozedDueToday = bundle.refs
    .filter((r) => r.isSnoozed && r.snoozeUntil != null && parseMs(r.snoozeUntil) <= endToday)
    .sort((a, b) => parseMs(a.snoozeUntil) - parseMs(b.snoozeUntil))
    .slice(0, limit)
    .map((r) => threadRow(r, r.snoozeUntil));

  // Follow-ups still awaiting a reply — most-urgent deadline first.
  const awaitingFollowUp = bundle.refs
    .filter((r) => isAwaitingFollowUp(r))
    .sort((a, b) => parseMs(a.followUpAt) - parseMs(b.followUpAt))
    .slice(0, limit)
    .map((r) => threadRow(r, r.followUpAt));

  return {
    accounts,
    totalUnread,
    snoozedDueToday,
    awaitingFollowUp,
    degraded: bundle.degraded,
  };
}
