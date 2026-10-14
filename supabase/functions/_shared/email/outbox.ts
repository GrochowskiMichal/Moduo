/**
 * The outbox worker's logic (specs/transactional-email.md TX-3, T12): claim due
 * rows, render each with its template, send it through Resend, record the
 * outcome. The Edge Function `email-worker` wires the database calls; the tests
 * inject fakes.
 *
 * - Claims come from `email_outbox__claim` (FOR UPDATE SKIP LOCKED, a 5-minute
 *   lease, suppressed addresses already set aside), a small batch at a time,
 *   until nothing is due, `maxRows` were handled or the time budget is spent.
 * - Every send carries `Idempotency-Key: <dedupe_key>`, so a run that crashes
 *   between sending and recording never sends twice: the next run's resend gets
 *   Resend's first answer back.
 * - A temporary failure (timeout, 429, 5xx) goes back to the queue after 1, 5,
 *   15, then 60 minutes; the 5th failed attempt, a permanent refusal, or a
 *   payload its template refuses is marked failed (the health job then alerts).
 *   A kind the deployed worker has no template for is retried the same way, so
 *   a worker deploy up to ~80 minutes behind the migration that queues the kind
 *   loses nothing (deploy the worker first; docs/email-runbook.md). A kind
 *   missing from EMAIL_KINDS altogether fails at once.
 *   A run lost between sending and recording gets one extra claim in SQL before
 *   it counts as failed; it sends with the same key, so never a second copy.
 * - One run at a time (the database's run lease, `lock`), and its sends are
 *   paced, so a burst stays well inside Resend's per-team rate limit, which
 *   sign-in codes share. A kick that finds a run going exits; the running loop
 *   or the next minute's kick picks its rows up.
 * - A run stays short: 30 s of claiming, sends that give up after 5 s, so the
 *   longest run (~90 s, ~170 s if every database call also times out) ends
 *   inside the run lease (180 s) and the Edge
 *   Function's wall-clock limit (150 s on the free plan).
 */

import { type EmailKind, isEmailKind } from "../contracts/vocabularies.ts";
import { redactAddresses } from "../escape.ts";
import type { EmailDoc } from "./blocks.ts";
import { renderEmail } from "./render.ts";
import {
  ACCOUNT_SENDER_ADDRESS,
  type EmailAttachment,
  formatFrom,
  type OutgoingEmail,
  type SendResult,
  UPDATES_SENDER_ADDRESS,
} from "./send.ts";
import { BOOKING_QUEUED } from "./templates/booking.ts";
import { opsAlertEmail, parseOpsAlertPayload } from "./templates/ops-alert.ts";
import { parseWaitlistInvitePayload, waitlistInviteEmail } from "./templates/waitlist-invite.ts";

export const OUTBOX_MAX_ATTEMPTS = 5;
/** Wait before attempt n+1, after attempt n failed (n = 1…4). */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 15, 60] as const;
export const OUTBOX_BATCH_SIZE = 10;
export const OUTBOX_MAX_ROWS_PER_RUN = 100;
/** Stop claiming new batches after this long; claimed rows are always finished. */
export const OUTBOX_BUDGET_MS = 30_000;
/** Longest wait for one Resend request (a timeout is retried on a later run). */
export const OUTBOX_SEND_TIMEOUT_MS = 5_000;
/** At most ~4 sends a second from the worker (Resend's default is 10 per team). */
export const OUTBOX_PACE_MS = 250;

/** One row as `email_outbox__claim` returns it. */
export type OutboxRow = {
  id: string;
  kind: string;
  stream: string;
  to_email: string;
  to_user_id: string | null;
  payload: unknown;
  dedupe_key: string;
  /** Including the attempt being made now. */
  attempts: number;
};

export type OutboxOutcome =
  | { id: string; outcome: "sent"; providerId: string }
  | { id: string; outcome: "retry"; error: string; retryAt: string }
  | { id: string; outcome: "failed"; error: string };

/** What a queued template produces from a row's payload. */
export type QueuedEmail = {
  doc: EmailDoc;
  /** Display name for the From header ("Anna Carter via Moduo"); "Moduo" when absent. */
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
};

export type QueuedTemplate = (payload: Record<string, unknown>) => QueuedEmail;

/**
 * The kinds the worker can send, keyed by kind. Each TX block adds its queued
 * kinds here. `auth_code` is never queued (the auth hook sends it within Auth's
 * five seconds and only logs it).
 */
export const OUTBOX_TEMPLATES: Partial<Record<EmailKind, QueuedTemplate>> = {
  waitlist_invite: (payload) => ({ doc: waitlistInviteEmail(parseWaitlistInvitePayload(payload)) }),
  ops_alert: (payload) => ({ doc: opsAlertEmail(parseOpsAlertPayload(payload)) }),
  ...BOOKING_QUEUED,
};

/** The run lease: `email_outbox__run_start` / `email_outbox__run_stop`. */
export type OutboxRunLock = {
  /** A token when this run may go ahead, null when another run holds the lease. */
  start: () => Promise<string | null>;
  stop: (token: string) => Promise<void>;
};

export type OutboxDeps = {
  /** `email_outbox__claim(limit)`. */
  claim: (limit: number) => Promise<OutboxRow[]>;
  /** `email_outbox__finish(...)`. May throw; the row then waits for its lease to end. */
  finish: (outcome: OutboxOutcome) => Promise<void>;
  send: (email: OutgoingEmail) => Promise<SendResult>;
  /** Without it the run goes ahead unconditionally (tests). */
  lock?: OutboxRunLock;
  templates?: Partial<Record<EmailKind, QueuedTemplate>>;
  render?: typeof renderEmail;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  batchSize?: number;
  maxRows?: number;
  budgetMs?: number;
  paceMs?: number;
  /** Something worth an operator's attention. Never passed a payload. */
  report?: (event: string, detail: Record<string, unknown>) => void;
};

export type OutboxRunSummary = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** Outcomes the database didn't take; those rows go again when their lease ends. */
  unrecorded: number;
  /** Another run held the lease, so this one did nothing. */
  busy?: boolean;
};

/** When a row whose attempt `attempts` just failed temporarily should be tried again, or null when it's out of attempts. */
export function nextRetryAt(attempts: number, nowMs: number): string | null {
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return null;
  const index = Math.min(Math.max(attempts, 1), OUTBOX_BACKOFF_MINUTES.length) - 1;
  return new Date(nowMs + OUTBOX_BACKOFF_MINUTES[index] * 60_000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The email for one claimed row, or why it can't be built (never worth retrying). */
export function buildOutboxEmail(
  row: OutboxRow,
  templates: Partial<Record<EmailKind, QueuedTemplate>> = OUTBOX_TEMPLATES,
  render: typeof renderEmail = renderEmail,
): { ok: true; email: OutgoingEmail } | { ok: false; error: string } {
  if (!isEmailKind(row.kind)) return { ok: false, error: `unknown_kind:${row.kind}`.slice(0, 200) };
  const template = templates[row.kind];
  if (!template) return { ok: false, error: `no_template:${row.kind}` };
  if (!isRecord(row.payload)) return { ok: false, error: "payload_not_object" };

  let queued: QueuedEmail;
  let rendered: ReturnType<typeof renderEmail>;
  try {
    queued = template(row.payload);
    rendered = render(queued.doc);
  } catch (error) {
    return { ok: false, error: `render_failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 500) };
  }

  const address = row.stream === "updates" ? UPDATES_SENDER_ADDRESS : ACCOUNT_SENDER_ADDRESS;
  return {
    ok: true,
    email: {
      from: formatFrom(queued.fromName ?? "Moduo", address),
      to: row.to_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(queued.replyTo ? { replyTo: queued.replyTo } : {}),
      ...(queued.headers ? { headers: queued.headers } : {}),
      ...(queued.attachments ? { attachments: queued.attachments } : {}),
      tags: [{ name: "kind", value: row.kind }],
      idempotencyKey: row.dedupe_key,
    },
  };
}

/** What to record for one row after its send. */
export function outcomeFor(row: OutboxRow, result: SendResult, nowMs: number): OutboxOutcome {
  if (result.ok) return { id: row.id, outcome: "sent", providerId: result.id };
  const error = result.error.slice(0, 1000);
  const retryAt = result.retryable ? nextRetryAt(row.attempts, nowMs) : null;
  return retryAt ? { id: row.id, outcome: "retry", error, retryAt } : { id: row.id, outcome: "failed", error };
}

export async function runOutbox(deps: OutboxDeps): Promise<OutboxRunSummary> {
  if (!deps.lock) return runBatches(deps);
  const token = await deps.lock.start();
  if (!token) return { claimed: 0, sent: 0, retried: 0, failed: 0, unrecorded: 0, busy: true };
  try {
    return await runBatches(deps);
  } finally {
    // A failed release only means the next run waits for the lease to end.
    await deps.lock.stop(token).catch((error: unknown) => {
      deps.report?.("lock_release_failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }
}

async function runBatches(deps: OutboxDeps): Promise<OutboxRunSummary> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const report = deps.report ?? (() => {});
  const batchSize = deps.batchSize ?? OUTBOX_BATCH_SIZE;
  const maxRows = deps.maxRows ?? OUTBOX_MAX_ROWS_PER_RUN;
  const budgetMs = deps.budgetMs ?? OUTBOX_BUDGET_MS;
  const paceMs = deps.paceMs ?? OUTBOX_PACE_MS;
  const startedAt = now();
  const summary: OutboxRunSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, unrecorded: 0 };
  let lastSendAt: number | null = null;

  while (summary.claimed < maxRows && now() - startedAt < budgetMs) {
    const rows = await deps.claim(Math.min(batchSize, maxRows - summary.claimed));
    if (rows.length === 0) break;
    summary.claimed += rows.length;

    for (const row of rows) {
      const built = buildOutboxEmail(row, deps.templates ?? OUTBOX_TEMPLATES, deps.render ?? renderEmail);
      let outcome: OutboxOutcome;
      if (!built.ok) {
        report("unsendable", { id: row.id, kind: row.kind, error: redactAddresses(built.error) });
        const retryAt = built.error.startsWith("no_template:") ? nextRetryAt(row.attempts, now()) : null;
        outcome = retryAt
          ? { id: row.id, outcome: "retry", error: built.error, retryAt }
          : { id: row.id, outcome: "failed", error: built.error };
      } else {
        if (lastSendAt !== null) {
          const wait = paceMs - (now() - lastSendAt);
          if (wait > 0) await sleep(wait);
        }
        lastSendAt = now();
        const result = await deps.send(built.email);
        outcome = outcomeFor(row, result, now());
        if (!result.ok) {
          report("send_failed", {
            id: row.id,
            kind: row.kind,
            attempt: row.attempts,
            status: result.status,
            error: redactAddresses(result.error),
          });
        }
      }

      try {
        await deps.finish(outcome);
      } catch (error) {
        summary.unrecorded += 1;
        report("finish_failed", { id: row.id, error: redactAddresses(error instanceof Error ? error.message : String(error)) });
      }
      if (outcome.outcome === "sent") summary.sent += 1;
      else if (outcome.outcome === "retry") summary.retried += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
