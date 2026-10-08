/**
 * Supabase Auth's Send Email Hook (specs/transactional-email.md TX-2, T7):
 * every email Auth would send goes through here and out through Resend.
 *
 * - The request must carry a valid Standard Webhooks signature (webhook.ts).
 * - `signup`, `magiclink` and `email` get A1, the sign-in code. `invite` (the
 *   dashboard's "Send invitation") keeps its confirmation link: with sign-ups off
 *   it is the only way an invitee's address gets confirmed (auth-variants.ts).
 *   `recovery`, `email_change` and `reauthentication` get a neutral code. The
 *   `*_notification` types are ignored: answered 200, nothing sent.
 * - Sending is synchronous, with one quick retry only while it still fits:
 *   Supabase gives the whole call five seconds, and answering late is worse than
 *   failing, because Auth then rolls back and the code that did go out never
 *   works. If the designed email fails to render, a plain-text one carrying the
 *   same code goes out instead, so a template bug never blocks sign-in.
 * - Each send is logged in email_outbox without the code or its hash, after the
 *   answer when the runtime allows it (`defer`). Logging never fails the hook:
 *   the email is already out.
 *
 * Plain TypeScript with injected dependencies (no Deno globals, no URL imports)
 * so the unit tests run it; index.ts wires the real ones.
 */

import { allowListedOrigin, APP_ORIGINS, CANONICAL_APP_ORIGIN } from "../_shared/app-origin.ts";
import { escapeHtml } from "../_shared/escape.ts";
import { type RenderedEmail, renderEmail } from "../_shared/email/render.ts";
import {
  ACCOUNT_SENDER_ADDRESS,
  formatFrom,
  type OutgoingEmail,
  type SendResult,
  sendViaResend,
} from "../_shared/email/send.ts";
import { AUTH_CODE_VALID_MINUTES, authCodeEmail } from "../_shared/email/templates/auth-code.ts";
import { authConfirmCodeEmail, authInviteEmail } from "../_shared/email/templates/auth-variants.ts";
import type { EmailKind, EmailOutboxStatus, EmailStream } from "../_shared/contracts/vocabularies.ts";
import { verifyWebhook, type WebhookHeaders } from "./webhook.ts";

/** A sanity cap on what we hash and parse. Auth's payload is a user object and a few tokens. */
export const MAX_HOOK_BODY_BYTES = 256 * 1024;
/**
 * Answer within this long of the request reaching the function. Auth's 5 s also
 * covers the gateway and a cold boot before that, which the last 0.5 s absorbs.
 */
export const HOOK_DEADLINE_MS = 4500;
/** Longest wait for one Resend request. */
export const HOOK_SEND_TIMEOUT_MS = 2000;
export const HOOK_RETRY_DELAY_MS = 300;
/** Retry only when at least this much time is left for the second request. */
export const HOOK_MIN_RETRY_WINDOW_MS = 1200;

const SIGN_IN_ACTIONS = new Set(["signup", "magiclink", "email"]);
/**
 * Actions where Auth may be creating the user in the same transaction. If the
 * send fails, Auth rolls that user back, so a failure row names nobody
 * (to_user_id null) and the purge's deleted-account rule leaves it alone.
 */
const MAY_CREATE_USER = new Set(["signup", "invite"]);
const CONFIRM_ACTIONS = new Set(["recovery", "reauthentication"]);

/** A row for public.email_outbox (TX-2 writes the log role only). Never the code. */
export type AuthEmailLogRow = {
  kind: Extract<EmailKind, "auth_code">;
  stream: Extract<EmailStream, "account">;
  to_email: string;
  to_user_id: string | null;
  payload: { action: string; variant: AuthEmailVariant; fallback: boolean };
  dedupe_key: string;
  status: Extract<EmailOutboxStatus, "sent" | "failed">;
  attempts: number;
  last_error: string | null;
  provider_id: string | null;
  sent_at: string | null;
};

export type AuthEmailVariant = "sign_in" | "invite" | "confirm";

export type HookDeps = {
  /** SEND_EMAIL_HOOK_SECRET: `v1,whsec_<base64>`, several joined by `|`. */
  hookSecret: string | null | undefined;
  resendApiKey: string | null | undefined;
  /** This project's API origin, for the invite's /auth/v1/verify link. */
  supabaseUrl: string | null | undefined;
  /** Writes one log row; may throw (the hook carries on). */
  log: (row: AuthEmailLogRow) => Promise<void>;
  /**
   * Runs a task after the answer has gone (EdgeRuntime.waitUntil), so the log
   * write doesn't spend Auth's time. Without it the log is awaited (tests).
   */
  defer?: (task: Promise<void>) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Builds the designed email; tests swap it to prove the plain-text fallback. */
  render?: typeof renderEmail;
  /** Something worth an operator's attention. Never passed the payload or a code. */
  report?: (event: string, detail: Record<string, unknown>) => void;
};

export type HookRequest = {
  method: string;
  body: string;
  headers: WebhookHeaders;
  /** When the request arrived (ms), taken before reading the body; the deadline counts from here. */
  receivedAt?: number;
};

export type HookResponse = { status: number; body: Record<string, unknown> };

type HookUser = { id?: unknown; email?: unknown; new_email?: unknown };
type HookEmailData = {
  token?: unknown;
  token_hash?: unknown;
  token_new?: unknown;
  token_hash_new?: unknown;
  redirect_to?: unknown;
  site_url?: unknown;
  email_action_type?: unknown;
};

/** One email to send: who gets it and what it says. */
type Outgoing = {
  to: string;
  variant: AuthEmailVariant;
  code: string | null;
  confirmUrl: string | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeAddress(value: unknown): string {
  return str(value).trim().toLowerCase();
}

function looksLikeAddress(value: string): boolean {
  return value.length >= 3 && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
}

function errorResponse(status: number, message: string): HookResponse {
  return { status, body: { error: { http_code: status, message } } };
}

/**
 * The /auth/v1/verify link a dashboard invite carries. It lands on one of our
 * app hosts only; GoTrue confirms the address before redirecting.
 */
export function inviteConfirmUrl(supabaseUrl: string, tokenHash: string, redirectTo: unknown, siteUrl: unknown): string {
  const target =
    allowListedOrigin(redirectTo, APP_ORIGINS) ?? allowListedOrigin(siteUrl, APP_ORIGINS) ?? CANONICAL_APP_ORIGIN;
  const url = new URL("/auth/v1/verify", supabaseUrl);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", "invite");
  url.searchParams.set("redirect_to", target);
  return url.toString();
}

/** Who gets what for one Auth email request; null when the action sends nothing. */
export function planEmails(
  action: string,
  user: HookUser,
  data: HookEmailData,
  supabaseUrl: string | null | undefined,
): Outgoing[] | null | "invalid" {
  if (action.endsWith("_notification")) return null;
  const current = normalizeAddress(user.email);
  const token = str(data.token);
  const tokenNew = str(data.token_new);

  if (SIGN_IN_ACTIONS.has(action) || CONFIRM_ACTIONS.has(action)) {
    if (!looksLikeAddress(current) || !token) return "invalid";
    return [{ to: current, variant: SIGN_IN_ACTIONS.has(action) ? "sign_in" : "confirm", code: token, confirmUrl: null }];
  }

  if (action === "invite") {
    const tokenHash = str(data.token_hash);
    if (!looksLikeAddress(current) || !tokenHash || !supabaseUrl) return "invalid";
    let confirmUrl: string;
    try {
      confirmUrl = inviteConfirmUrl(supabaseUrl, tokenHash, data.redirect_to, data.site_url);
    } catch {
      return "invalid";
    }
    return [{ to: current, variant: "invite", code: null, confirmUrl }];
  }

  if (action === "email_change") {
    const next = normalizeAddress(user.new_email);
    if (!looksLikeAddress(next)) return "invalid";
    // Supabase's naming is reversed (docs: "Email change behavior"): with Secure
    // Email Change on, `token` goes to the current address and `token_new` to
    // the new one; with it off, the one code goes to the new address.
    if (token && tokenNew) {
      if (!looksLikeAddress(current)) return "invalid";
      return [
        { to: current, variant: "confirm", code: token, confirmUrl: null },
        { to: next, variant: "confirm", code: tokenNew, confirmUrl: null },
      ];
    }
    const only = token || tokenNew;
    if (!only) return "invalid";
    return [{ to: next, variant: "confirm", code: only, confirmUrl: null }];
  }

  return "invalid";
}

function designedEmail(item: Outgoing, render: typeof renderEmail): RenderedEmail {
  if (item.variant === "invite") {
    return render(authInviteEmail({ email: item.to, confirmUrl: item.confirmUrl ?? "" }));
  }
  const data = { code: item.code ?? "", email: item.to, validMinutes: AUTH_CODE_VALID_MINUTES };
  return render(item.variant === "sign_in" ? authCodeEmail(data) : authConfirmCodeEmail(data));
}

/** The bare email sent when the designed one fails to render. Same code or link, no styling. */
export function fallbackEmail(item: Outgoing): RenderedEmail {
  const minutes = `${AUTH_CODE_VALID_MINUTES} minutes`;
  if (item.variant === "invite") {
    const link = item.confirmUrl ?? "";
    const text = `You've been invited to Moduo.\n\nConfirm your address: ${link}\n\nThe link works for ${minutes}. Then sign in with ${item.to}; we'll email you a code.`;
    return {
      subject: "You're invited to Moduo",
      preheader: "",
      text,
      html: `<p>You've been invited to Moduo.</p><p><a href="${escapeHtml(link)}">Confirm your address</a></p><p>The link works for ${minutes}. Then sign in with ${escapeHtml(item.to)}; we'll email you a code.</p>`,
    };
  }
  const code = (item.code ?? "").replace(/[^0-9A-Za-z]/g, "").slice(0, 12);
  const what = item.variant === "sign_in" ? "sign-in" : "confirmation";
  return {
    subject: `${code} is your Moduo ${item.variant === "sign_in" ? "code" : "confirmation code"}`,
    preheader: "",
    text: `Your Moduo ${what} code: ${code}\n\nIt works once, for ${minutes}. If you didn't ask for it, ignore this email.`,
    html: `<p>Your Moduo ${what} code:</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${escapeHtml(code)}</p><p>It works once, for ${minutes}. If you didn't ask for it, ignore this email.</p>`,
  };
}

/**
 * One Resend request, and a second after a short pause when the first failed in
 * a way worth retrying and there is still time before the deadline.
 */
async function sendBeforeDeadline(
  email: OutgoingEmail,
  deps: HookDeps,
  startedAt: number,
): Promise<{ result: SendResult; attempts: number }> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = startedAt + HOOK_DEADLINE_MS;
  const sendDeps = (timeoutMs: number) => ({ apiKey: deps.resendApiKey, fetch: deps.fetch, timeoutMs });

  const first = await sendViaResend(email, sendDeps(Math.max(500, Math.min(HOOK_SEND_TIMEOUT_MS, deadline - now()))));
  if (first.ok || !first.retryable) return { result: first, attempts: 1 };
  const left = deadline - now() - HOOK_RETRY_DELAY_MS;
  if (left < HOOK_MIN_RETRY_WINDOW_MS) return { result: first, attempts: 1 };
  await sleep(HOOK_RETRY_DELAY_MS);
  const second = await sendViaResend(email, sendDeps(Math.min(HOOK_SEND_TIMEOUT_MS, left)));
  return { result: second, attempts: 2 };
}

export async function handleAuthEmailHook(request: HookRequest, deps: HookDeps): Promise<HookResponse> {
  const report = deps.report ?? (() => {});
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed");
  if (new TextEncoder().encode(request.body).length > MAX_HOOK_BODY_BYTES) {
    return errorResponse(413, "payload_too_large");
  }

  const now = deps.now ?? Date.now;
  const startedAt = request.receivedAt ?? now();
  const check = await verifyWebhook(request.body, request.headers, deps.hookSecret, Math.floor(now() / 1000));
  if (!check.ok) {
    report("signature_rejected", { reason: check.reason });
    return errorResponse(401, "invalid_signature");
  }

  let payload: { user?: HookUser; email_data?: HookEmailData };
  try {
    payload = JSON.parse(request.body);
  } catch {
    return errorResponse(400, "invalid_payload");
  }
  const user = payload?.user ?? {};
  const data = payload?.email_data ?? {};
  const action = str(data.email_action_type);

  const plan = planEmails(action, user, data, deps.supabaseUrl);
  if (plan === null) return { status: 200, body: {} };
  if (plan === "invalid") {
    report("invalid_payload", { action });
    return errorResponse(400, "invalid_payload");
  }

  const render = deps.render ?? renderEmail;
  const userId = typeof user.id === "string" && user.id ? user.id : null;
  const webhookId = (request.headers.id ?? "").slice(0, 200);

  const results = await Promise.all(
    plan.map(async (item, index) => {
      let rendered: RenderedEmail;
      let fallback = false;
      try {
        rendered = designedEmail(item, render);
      } catch (error) {
        fallback = true;
        report("render_failed", { action, error: error instanceof Error ? error.message : String(error) });
        rendered = fallbackEmail(item);
      }

      const dedupeKey = `auth_code:${webhookId}:${index}`;
      const { result, attempts } = await sendBeforeDeadline(
        {
          from: formatFrom("Moduo", ACCOUNT_SENDER_ADDRESS),
          to: item.to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: "kind", value: "auth_code" }],
          // Makes our own retry safe: Resend returns the first send instead of a
          // second email. (Auth's retries carry a new webhook-id, so they don't share it.)
          idempotencyKey: dedupeKey,
        },
        deps,
        startedAt,
      );

      const write = Promise.resolve()
        .then(() =>
          deps.log({
            kind: "auth_code",
            stream: "account",
            to_email: item.to,
            to_user_id: result.ok || !MAY_CREATE_USER.has(action) ? userId : null,
            payload: { action, variant: item.variant, fallback },
            dedupe_key: dedupeKey,
            status: result.ok ? "sent" : "failed",
            attempts,
            last_error: result.ok ? null : result.error.slice(0, 1000),
            provider_id: result.ok ? result.id : null,
            sent_at: result.ok ? new Date(now()).toISOString() : null,
          }),
        )
        .catch((error: unknown) => {
          report("log_failed", { action, error: error instanceof Error ? error.message : String(error) });
        });
      if (deps.defer) deps.defer(write);
      else await write;
      return result;
    }),
  );

  const failed = results.find((result): result is Extract<SendResult, { ok: false }> => !result.ok);
  if (failed) {
    report("send_failed", { action, status: failed.status, error: failed.error });
    return errorResponse(500, "email_send_failed");
  }
  return { status: 200, body: {} };
}
