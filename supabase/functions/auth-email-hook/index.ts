/**
 * Edge Function: auth-email-hook (TX-2, specs/transactional-email.md T7)
 *
 * Supabase Auth's Send Email Hook. Auth calls it instead of its SMTP sender for
 * every auth email (sign-in codes, dashboard invites, …); it renders the email
 * with the kit and sends it through Resend. The logic is ./handler.ts.
 *
 * Deploy with verify_jwt = false: Auth signs the request (Standard Webhooks)
 * instead of sending a JWT, and handler.ts checks that signature.
 *
 * Secrets: SEND_EMAIL_HOOK_SECRET (the `v1,whsec_…` value the dashboard shows when
 * the hook is created; Maciej sets it with `supabase secrets set`), RESEND_API_KEY,
 * SUPABASE_URL and SUPABASE_SECRET_KEYS (both provided by the platform).
 *
 * The log insert goes straight to PostgREST with fetch rather than supabase-js:
 * no esm.sh import on a cold start, which matters inside Auth's 5 s budget.
 *
 * Returns 200 {} when the email went out (or the action sends nothing), and
 * { error: { http_code, message } } otherwise; Auth then fails the request and
 * the sign-in screen says the code couldn't be sent. Rollback: switch the hook
 * off in the dashboard (docs/email-runbook.md); Auth goes back to its SMTP.
 */

import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { type AuthEmailLogRow, handleAuthEmailHook } from "./handler.ts";

/** Supabase's background-task hook: work that may finish after the response. */
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

const LOG_TIMEOUT_MS = 3000;

async function logToOutbox(row: AuthEmailLogRow): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) throw new Error("SUPABASE_URL is not set");
  const key = getDefaultSecretKey();
  const response = await fetch(`${base}/rest/v1/email_outbox?on_conflict=dedupe_key`, {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(LOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`email_outbox insert: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
}

Deno.serve(async (req: Request) => {
  const receivedAt = Date.now();
  const result = await handleAuthEmailHook(
    {
      receivedAt,
      method: req.method,
      body: await req.text(),
      headers: {
        id: req.headers.get("webhook-id"),
        timestamp: req.headers.get("webhook-timestamp"),
        signature: req.headers.get("webhook-signature"),
      },
    },
    {
      hookSecret: Deno.env.get("SEND_EMAIL_HOOK_SECRET"),
      resendApiKey: Deno.env.get("RESEND_API_KEY"),
      supabaseUrl: Deno.env.get("SUPABASE_URL"),
      log: logToOutbox,
      // Write the log after answering, so it never eats into Auth's 5 s.
      defer: (task) => {
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
      },
      // Never the payload: it carries the code.
      report: (event, detail) => console.error(`[auth-email-hook] ${event}`, JSON.stringify(detail)),
    },
  );
  return Response.json(result.body, { status: result.status });
});
