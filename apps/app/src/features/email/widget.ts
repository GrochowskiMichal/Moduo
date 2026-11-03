// Pure shaper for the "Inbox & follow-ups" dashboard widget (EM-11, AC18). Over
// the cloud tissue bundle (accounts with desktop-pushed unread counts + tissue
// refs), it surfaces: unread-per-account, snoozed threads returning today, and
// follow-ups awaiting a reply. No I/O — unit-tested in widget.test.ts.

import type { EmailModuleBundle, EmailThreadRef } from "../../lib/runtime.types";
import { mailViewKey } from "../../lib/runtime.types";
import type { MailCounts, MailThreadRow } from "../../lib/runtime.types.mail-engine";
import { isAwaitingFollowUp } from "./refs";

const PERSONAL_INBOX_KEY = mailViewKey({ kind: "unified", role: "inbox" }, { kind: "personal" });

/** The desktop engine's truth (MR-14, AC41); absent on web. */
export type EmailWidgetLocal = { counts: MailCounts | null; snoozed: MailThreadRow[] };

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
  /** A local engine thread (not a tissue ref): open Mail, not the entity. */
  local?: boolean;
};

export type EmailInboxView = {
  accounts: EmailInboxAccountRow[];
  totalUnread: number;
  /** Unread Personal from the local engine; null on web (no engine). */
  personalUnread: number | null;
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
  opts: { now: Date; limit?: number; local?: EmailWidgetLocal | null },
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

  const local = opts.local ?? null;
  const personalUnread = local?.counts
    ? (local.counts.byViewKey[PERSONAL_INBOX_KEY] ?? local.counts.badge)
    : null;

  // Snoozed threads returning today (or overdue-but-still-snoozed) — newest-due first.
  // On desktop the engine's snoozed view is the truth; web reads the tissue refs.
  const snoozedDueToday = local
    ? local.snoozed
        .filter((r) => r.snoozedUntilMs !== null && r.snoozedUntilMs <= endToday)
        .sort((a, b) => (a.snoozedUntilMs ?? 0) - (b.snoozedUntilMs ?? 0))
        .slice(0, limit)
        .map((r) => ({
          refId: r.threadId,
          threadKey: r.threadId,
          fromName: (() => {
            const s = r.senders[r.senders.length - 1];
            return s?.name?.trim() || s?.email?.trim() || "Unknown sender";
          })(),
          subject: r.subject.trim() || "(No subject)",
          when: new Date(r.snoozedUntilMs ?? 0).toISOString(),
          local: true,
        }))
    : bundle.refs
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
    personalUnread,
    snoozedDueToday,
    awaitingFollowUp,
    degraded: bundle.degraded,
  };
}
