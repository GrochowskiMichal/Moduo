/**
 * Ops alert (internal, to hello@moduo.app). Not in the ratified email set: it
 * is never sent to a user, so its copy follows the system voice (unsigned,
 * plain, American English) and lives only here.
 *
 * Two variants:
 * - `failures`: queued by `email_outbox__health()` (T19) when a sign-in code
 *   failed, or 3+ emails failed, in the last 10 minutes; at most one per 30.
 * - `test`: queued by hand to prove the outbox end to end (docs/email-runbook.md
 *   §TX-3), the internal kind the queue is tested with before any feature uses it.
 *
 * The payload is written by SQL in snake_case; `parseOpsAlertPayload` checks it
 * and maps it to the template's data. Rendering depends on the payload alone (no
 * clock), so a retry renders the same email and Resend's idempotency key holds.
 */

import { singleLine } from "../../escape.ts";
import { type EmailDoc, heading, link, lockup, muted, paragraph, strong } from "../blocks.ts";
import { dateLong, time24 } from "../format.ts";

export const OPS_ALERT_RECIPIENT = "hello@moduo.app";
export const EMAIL_RUNBOOK_URL = "https://github.com/GrochowskiMichal/Moduo/blob/develop/docs/email-runbook.md";

export type OpsAlertData =
  | {
      reason: "failures";
      windowMinutes: number;
      authCodeFailed: number;
      otherFailed: number;
      /** The commonest errors, addresses already blanked by SQL. */
      errors: { error: string; count: number }[];
      /** ISO time the health check noticed. */
      detectedAt: string;
    }
  | { reason: "test"; requestedAt?: string };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isoTime(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

/** "8 October 2026 at 21:40 UTC" */
function utcTime(iso: string): string {
  const date = new Date(iso);
  return `${dateLong(date, "UTC")} at ${time24(date, "UTC")} UTC`;
}

/** The payload an outbox row carries, checked. Throws on a shape the template can't render. */
export function parseOpsAlertPayload(payload: Record<string, unknown>): OpsAlertData {
  if (payload.reason === "test") {
    return { reason: "test", requestedAt: isoTime(payload.requested_at) };
  }
  if (payload.reason === "failures") {
    const detectedAt = isoTime(payload.detected_at);
    if (!detectedAt) throw new Error("ops_alert: detected_at missing");
    const errors = Array.isArray(payload.errors)
      ? payload.errors
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => ({ error: typeof item.error === "string" ? item.error : "unknown_error", count: count(item.count) }))
          .slice(0, 3)
      : [];
    return {
      reason: "failures",
      windowMinutes: count(payload.window_minutes) || 10,
      authCodeFailed: count(payload.auth_code_failed),
      otherFailed: count(payload.other_failed),
      errors,
      detectedAt,
    };
  }
  throw new Error("ops_alert: unknown reason");
}

export function opsAlertEmail(data: OpsAlertData): EmailDoc {
  if (data.reason === "test") {
    return {
      subject: "Email test: the outbox works",
      preheader: "This went through the queue, the email worker and Resend.",
      blocks: [
        lockup(),
        heading("The outbox works"),
        paragraph("This test email went through the queue, the email worker and Resend."),
        ...(data.requestedAt ? [muted(`Queued ${utcTime(data.requestedAt)}.`)] : []),
      ],
      footer: { reason: `You got this email because someone queued an outbox test to ${OPS_ALERT_RECIPIENT}.` },
    };
  }

  const total = data.authCodeFailed + data.otherFailed;
  const window = plural(data.windowMinutes, "minute", "minutes");
  const subject =
    data.authCodeFailed > 0
      ? `Email alert: ${plural(data.authCodeFailed, "sign-in code", "sign-in codes")} failed`
      : `Email alert: ${plural(total, "email", "emails")} failed in ${window}`;
  return {
    subject,
    preheader: "Open the email runbook to see what to check.",
    blocks: [
      lockup(),
      heading("Emails are failing"),
      paragraph(`In the ${window} before ${utcTime(data.detectedAt)}, `, strong(plural(total, "email", "emails")), " failed to send."),
      {
        type: "rows",
        rows: [
          { label: "Sign-in codes", value: `${data.authCodeFailed} failed` },
          { label: "Other emails", value: `${data.otherFailed} failed` },
          ...data.errors.map((item, index) => ({
            label: index === 0 ? "Commonest error" : "Also",
            value: `${singleLine(item.error, 200)} (${item.count}×)`,
          })),
        ],
      },
      paragraph(
        data.authCodeFailed > 0
          ? "People can't sign in while codes fail. If Resend is refusing them, switch the Send Email Hook off in the Supabase dashboard (Authentication → Auth Hooks): Auth goes back to the old sender at once."
          : "Other emails are tried again on their own, 5 attempts over about 80 minutes, then stay failed in email_outbox. Some of the ones counted here may still go out.",
      ),
      link("Open the email runbook", EMAIL_RUNBOOK_URL),
      muted("You get at most one of these every 30 minutes, so more may have failed since."),
    ],
    footer: {
      reason: `You got this email because ${OPS_ALERT_RECIPIENT} receives Moduo's email delivery alerts.`,
    },
  };
}
