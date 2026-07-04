// Tissue-ref shaping (EM-3, AC14). Pure helpers over the cloud email_refs — a
// thread only becomes a ref through a DELIBERATE action (convert / link / snooze /
// follow-up / tag), so this module shapes those payloads and derives the
// snooze/follow-up state transitions the widget + notifications read. No I/O.

import type { EmailThreadRef } from "@/lib/runtime.types";

/** Cloud storage bounds — a subject/snippet is metadata, not the body. */
export const SUBJECT_MAX = 200;
export const SNIPPET_MAX = 280;

/** A desktop thread about to be pulled into the tissue. */
export type EmailThreadInput = {
  threadKey: string;
  accountId?: string | null;
  messageKey?: string | null;
  fromAddr?: string | null;
  fromName?: string | null;
  subject?: string | null;
  snippet?: string | null;
  sentAt?: string | null;
};

/** The `email_op_ref_upsert` payload, normalized + bounded. */
export type EmailRefUpsertArgs = {
  threadKey: string;
  accountId: string | null;
  messageKey: string | null;
  fromAddr: string | null;
  fromName: string | null;
  subject: string;
  snippet: string;
  sentAt: string | null;
};

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Shape a desktop thread into the ref-upsert payload: subject/snippet bounded,
 * from-address lowercased (matches the contact-resolution key), blanks → null so
 * the cloud row never carries junk empty strings.
 */
export function buildRefUpsertArgs(input: EmailThreadInput): EmailRefUpsertArgs {
  return {
    threadKey: input.threadKey.trim(),
    accountId: input.accountId ?? null,
    messageKey: input.messageKey?.trim() || null,
    fromAddr: input.fromAddr?.trim().toLowerCase() || null,
    fromName: input.fromName?.trim() || null,
    subject: truncate(input.subject ?? "", SUBJECT_MAX),
    snippet: truncate(input.snippet ?? "", SNIPPET_MAX),
    sentAt: input.sentAt ?? null,
  };
}

type SnoozeState = Pick<EmailThreadRef, "isSnoozed" | "snoozeUntil">;
type FollowUpState = Pick<EmailThreadRef, "followUpAt" | "followUpClearedAt">;

/** A snoozed thread whose time has come — it returns to the inbox + notifies. */
export function isSnoozeDue(ref: SnoozeState, nowMs: number): boolean {
  if (!ref.isSnoozed || !ref.snoozeUntil) return false;
  const at = Date.parse(ref.snoozeUntil);
  return Number.isFinite(at) && at <= nowMs;
}

/** A follow-up still waiting for a reply (set, and not yet cleared). */
export function isAwaitingFollowUp(ref: FollowUpState): boolean {
  return Boolean(ref.followUpAt) && !ref.followUpClearedAt;
}

/** A follow-up whose deadline passed with no reply → quiet notification. */
export function isFollowUpDue(ref: FollowUpState, nowMs: number): boolean {
  if (!isAwaitingFollowUp(ref)) return false;
  const at = Date.parse(ref.followUpAt as string);
  return Number.isFinite(at) && at <= nowMs;
}
