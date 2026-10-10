/**
 * Edge Function: email-worker (TX-3, specs/transactional-email.md T12)
 *
 * Sends what public.email_outbox has due. Kicked by pg_net from the outbox's
 * insert trigger (an email due now) and from the pg_cron job
 * `email-outbox-worker` (every minute, when anything is due). The request logic
 * is ./handler.ts; the claim/send/retry logic is _shared/email/outbox.ts.
 *
 * Deploy with verify_jwt = false: the caller is the database, which sends
 * `x-email-worker-secret` (from Vault) instead of a JWT, and the database checks
 * it again (`email_outbox__authorize`).
 *
 * Secrets: RESEND_API_KEY (already set), SUPABASE_URL and SUPABASE_SECRET_KEYS
 * (provided by the platform). No secret of its own.
 *
 * Database calls go straight to PostgREST with fetch rather than supabase-js:
 * no esm.sh import on a cold start.
 */

import {
  OUTBOX_SEND_TIMEOUT_MS,
  type OutboxOutcome,
  type OutboxRow,
  runOutbox,
} from "../_shared/email/outbox.ts";
import { sendViaResend } from "../_shared/email/send.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { type ServiceRpcConfig, serviceRpc } from "../_shared/service-rpc.ts";
import { handleWorkerRequest } from "./handler.ts";

/** Supabase's background-task hook: work that may finish after the response. */
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

function rpcConfig(): ServiceRpcConfig {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl) throw new Error("SUPABASE_URL is not set");
  return { baseUrl, key: getDefaultSecretKey() };
}

function report(event: string, detail: Record<string, unknown>) {
  console.log(`[email-worker] ${event}`, JSON.stringify(detail));
}

Deno.serve(async (req: Request) => {
  const config = rpcConfig();
  const result = await handleWorkerRequest(
    { method: req.method, secret: req.headers.get("x-email-worker-secret") },
    {
      authorize: (secret) => serviceRpc<boolean>(config, "email_outbox__authorize", { p_secret: secret }),
      run: () =>
        runOutbox({
          claim: (limit) => serviceRpc<OutboxRow[]>(config, "email_outbox__claim", { p_limit: limit }),
          finish: async (outcome: OutboxOutcome) => {
            await serviceRpc<string | null>(config, "email_outbox__finish", {
              p_id: outcome.id,
              p_outcome: outcome.outcome,
              p_provider_id: outcome.outcome === "sent" ? outcome.providerId : null,
              p_error: outcome.outcome === "sent" ? null : outcome.error,
              p_retry_at: outcome.outcome === "retry" ? outcome.retryAt : null,
            });
          },
          send: (email) =>
            sendViaResend(email, { apiKey: Deno.env.get("RESEND_API_KEY"), timeoutMs: OUTBOX_SEND_TIMEOUT_MS }),
          lock: {
            start: () => serviceRpc<string | null>(config, "email_outbox__run_start", {}),
            stop: async (token) => {
              await serviceRpc<null>(config, "email_outbox__run_stop", { p_token: token });
            },
          },
          report,
        }),
      defer: (task) => {
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
      },
      report,
    },
  );
  return Response.json(result.body, { status: result.status });
});
