/**
 * Resend's webhook (specs/transactional-email.md TX-3, T13): what each event
 * means for us, behind a Svix signature check. The Edge Function
 * `resend-webhook` wires the database calls; the tests inject fakes.
 *
 * - `email.bounced` with `bounce.type` "Permanent" (a hard bounce) and
 *   `email.complained` (marked as spam) suppress the address: the worker sends
 *   it nothing more except sign-in codes. A soft bounce ("Transient",
 *   "Undetermined") suppresses nothing; Resend retries those itself.
 * - `email.suppressed` (Resend refused to send because the address is on its own
 *   suppression list, built from earlier bounces and complaints) suppresses it
 *   here too, so our record matches what can actually be delivered.
 * - `email.delivered` stamps `delivered_at` on the outbox row with that Resend id.
 * - Every other event is acknowledged and ignored.
 *
 * Signatures: Svix signs `${svix-id}.${svix-timestamp}.${body}` with HMAC-SHA256
 * under the `whsec_…` secret (RESEND_WEBHOOK_SECRET), the Standard Webhooks
 * scheme auth-email-hook already checks. A database failure answers 500 so Svix
 * delivers the event again; writes are idempotent, so a repeat changes nothing.
 */

import type { EmailSuppressionReason } from "../contracts/vocabularies.ts";
import { verifyWebhook, type WebhookHeaders } from "../standard-webhooks.ts";

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export type ResendWebhookAction =
  | { type: "suppress"; emails: string[]; reason: Extract<EmailSuppressionReason, "bounce" | "complaint"> }
  | { type: "delivered"; providerId: string; at: string }
  | { type: "ignore"; why: string };

export type ResendWebhookDeps = {
  /** RESEND_WEBHOOK_SECRET: `whsec_<base64>` from the Resend dashboard. */
  secret: string | null | undefined;
  suppress: (entry: { email: string; reason: "bounce" | "complaint"; eventId: string }) => Promise<void>;
  markDelivered: (entry: { providerId: string; at: string }) => Promise<void>;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Never passed the payload. */
  report?: (event: string, detail: Record<string, unknown>) => void;
};

export type ResendWebhookRequest = { method: string; body: string; headers: WebhookHeaders };
export type ResendWebhookResponse = { status: number; body: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addresses(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    // "Tom Becker <tom@becker.studio>" or a bare address.
    const match = item.match(/<([^<>\s]+)>\s*$/);
    const address = (match ? match[1] : item).trim().toLowerCase();
    if (address.length >= 3 && address.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(address)) out.add(address);
  }
  return [...out];
}

/** What one parsed event asks of us. Pure; unknown shapes are ignored rather than trusted. */
export function classifyResendEvent(event: unknown): ResendWebhookAction {
  if (!isRecord(event) || typeof event.type !== "string") return { type: "ignore", why: "no_type" };
  const data = isRecord(event.data) ? event.data : {};

  if (event.type === "email.bounced") {
    const bounce = isRecord(data.bounce) ? data.bounce : {};
    if (bounce.type !== "Permanent") return { type: "ignore", why: "soft_bounce" };
    const emails = addresses(data.to);
    return emails.length ? { type: "suppress", emails, reason: "bounce" } : { type: "ignore", why: "no_recipient" };
  }
  if (event.type === "email.complained") {
    const emails = addresses(data.to);
    return emails.length ? { type: "suppress", emails, reason: "complaint" } : { type: "ignore", why: "no_recipient" };
  }
  if (event.type === "email.suppressed") {
    const emails = addresses(data.to);
    return emails.length ? { type: "suppress", emails, reason: "bounce" } : { type: "ignore", why: "no_recipient" };
  }
  if (event.type === "email.delivered") {
    const providerId = typeof data.email_id === "string" ? data.email_id.slice(0, 200) : "";
    if (!providerId) return { type: "ignore", why: "no_email_id" };
    // The event's own time is when it was delivered; data.created_at is when it was sent.
    const at = [event.created_at, data.created_at].find(
      (value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)),
    );
    return { type: "delivered", providerId, at: at ?? "" };
  }
  return { type: "ignore", why: event.type.slice(0, 60) };
}

export async function handleResendWebhook(
  request: ResendWebhookRequest,
  deps: ResendWebhookDeps,
): Promise<ResendWebhookResponse> {
  const report = deps.report ?? (() => {});
  const now = deps.now ?? Date.now;
  if (request.method !== "POST") return { status: 405, body: { error: "method_not_allowed" } };
  if (new TextEncoder().encode(request.body).length > MAX_WEBHOOK_BODY_BYTES) {
    return { status: 413, body: { error: "payload_too_large" } };
  }

  const check = await verifyWebhook(request.body, request.headers, deps.secret, Math.floor(now() / 1000));
  if (!check.ok) {
    report("signature_rejected", { reason: check.reason });
    return { status: 401, body: { error: "invalid_signature" } };
  }

  let event: unknown;
  try {
    event = JSON.parse(request.body);
  } catch {
    return { status: 400, body: { error: "invalid_payload" } };
  }

  const action = classifyResendEvent(event);
  const eventId = (request.headers.id ?? "").slice(0, 200);
  try {
    if (action.type === "suppress") {
      for (const email of action.emails) await deps.suppress({ email, reason: action.reason, eventId });
    } else if (action.type === "delivered") {
      await deps.markDelivered({ providerId: action.providerId, at: action.at || new Date(now()).toISOString() });
    }
  } catch (error) {
    report("write_failed", { action: action.type, error: error instanceof Error ? error.message : String(error) });
    return { status: 500, body: { error: "write_failed" } };
  }
  return { status: 200, body: { ok: true, action: action.type } };
}
