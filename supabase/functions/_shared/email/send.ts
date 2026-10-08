/**
 * Sending through Resend (specs/transactional-email.md T1). The caller injects
 * the API key and `fetch`, so this runs unchanged in Edge Functions and tests.
 *
 * A send never throws: it returns `{ ok: true, id }` or a classified failure,
 * and `retryable` tells the caller (the outbox worker, the auth hook) whether
 * trying again could help. `idempotencyKey` goes out as Resend's
 * `Idempotency-Key`, so a retry after a crash never sends twice.
 */

import { singleLine } from "../escape.ts";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** The account address every email comes from (ratified Q1). */
export const ACCOUNT_SENDER_ADDRESS = "hello@moduo.app";
/** Build updates only, on their own domain so complaints can't touch sign-in mail (T2). */
export const UPDATES_SENDER_ADDRESS = "updates@news.moduo.app";

export type EmailAttachment = {
  filename: string;
  /** Base64 of the file's bytes. */
  content: string;
  contentType?: string;
};

export type OutgoingEmail = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
};

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; retryable: boolean; status: number | null; error: string };

export type SendDeps = {
  apiKey: string | null | undefined;
  fetch?: typeof fetch;
  endpoint?: string;
  /** Give up on a hanging request after this long (ms); counts as retryable. */
  timeoutMs?: number;
};

export const DEFAULT_SEND_TIMEOUT_MS = 10_000;

/**
 * A From header: `"Anna Carter via Moduo" <hello@moduo.app>`. The display name
 * is user-typed (a host, an inviter), so it is flattened to one line, stripped
 * of the characters that could end the quoted string or start an address, and
 * capped; an empty name falls back to "Moduo".
 */
export function formatFrom(displayName: string, address: string): string {
  const name = singleLine(displayName.replace(/["\\<>]/g, ""), 64) || "Moduo";
  return `"${name}" <${address}>`;
}

/** "<name> via Moduo", the sender name for email sent on someone's behalf (Q39). */
export function viaModuo(personName: string): string {
  const name = singleLine(personName.replace(/["\\<>]/g, ""), 50);
  return name ? `${name} via Moduo` : "Moduo";
}

/** Base64 of a string's UTF-8 bytes, without Node's Buffer. */
export function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Whether trying again could help. Resend answers 409 both for two requests
 * racing on one idempotency key (worth retrying) and for a key reused with a
 * different payload (never succeeds), and tells them apart by `name`.
 */
/**
 * Resend accepts keys up to 256 characters. A longer key is hashed rather than
 * cut, so two different keys sharing their first 256 characters never collide.
 */
export async function idempotencyKeyHeader(key: string): Promise<string> {
  if (key.length <= 256) return key;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function retryableStatus(status: number, name: string | null): boolean {
  if (status === 409) return name === "concurrent_idempotent_requests";
  return status === 408 || status === 429 || status >= 500;
}

export async function sendViaResend(email: OutgoingEmail, deps: SendDeps): Promise<SendResult> {
  if (!deps.apiKey) {
    return { ok: false, retryable: false, status: null, error: "resend_not_configured" };
  }
  const doFetch = deps.fetch ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${deps.apiKey}`,
    "Content-Type": "application/json",
  };
  if (email.idempotencyKey) headers["Idempotency-Key"] = await idempotencyKeyHeader(email.idempotencyKey);

  const body = {
    from: email.from,
    to: Array.isArray(email.to) ? email.to : [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    ...(email.headers ? { headers: email.headers } : {}),
    ...(email.tags ? { tags: email.tags } : {}),
    ...(email.attachments
      ? {
          attachments: email.attachments.map((file) => ({
            filename: file.filename,
            content: file.content,
            ...(file.contentType ? { content_type: file.contentType } : {}),
          })),
        }
      : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(deps.endpoint ?? RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      retryable: true,
      status: null,
      error: timedOut ? "timeout" : error instanceof Error ? error.message : "network_error",
    };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  } finally {
    // The body read counts against the timeout too: a stalled body is a hang.
    clearTimeout(timer);
  }

  if (response.ok) {
    const id =
      payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string"
        ? payload.id
        : "";
    if (id) return { ok: true, id };
    // A 2xx whose body timed out or didn't parse: Resend may well have sent it, so
    // report it as retryable. With an idempotency key (every caller passes one),
    // the retry returns the original send instead of a second email.
    return {
      ok: false,
      retryable: true,
      status: response.status,
      error: controller.signal.aborted ? "timeout" : "resend_no_id",
    };
  }

  const message =
    payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : `resend_http_${response.status}`;
  const name =
    payload && typeof payload === "object" && "name" in payload && typeof payload.name === "string"
      ? payload.name
      : null;
  return {
    ok: false,
    retryable: retryableStatus(response.status, name),
    status: response.status,
    error: message.slice(0, 500),
  };
}

/**
 * `sendViaResend`, tried again after a short pause while the failure is
 * retryable. For synchronous senders (the auth hook); the outbox worker does
 * its own backoff across runs instead. Supabase gives an HTTP auth hook about
 * five seconds, so the hook must pass a short `timeoutMs` (≈2000) rather than
 * the 10 s default, or Supabase gives up before the retry.
 */
export async function sendWithRetry(
  email: OutgoingEmail,
  deps: SendDeps,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SendResult> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let result: SendResult = await sendViaResend(email, deps);
  for (let attempt = 1; attempt < attempts && !result.ok && result.retryable; attempt += 1) {
    await sleep(options.delayMs ?? 400);
    result = await sendViaResend(email, deps);
  }
  return result;
}
