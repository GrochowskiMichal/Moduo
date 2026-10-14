/**
 * Edge Function: resend-webhook (TX-3, specs/transactional-email.md T13)
 *
 * Resend's webhook endpoint (Resend dashboard → Webhooks, events
 * email.bounced, email.complained, email.suppressed, email.delivered). Hard
 * bounces and complaints suppress the address; deliveries stamp delivered_at.
 * The logic is _shared/email/resend-webhook.ts.
 *
 * Deploy with verify_jwt = false: Resend signs the request (Svix) instead of
 * sending a JWT, and the handler checks that signature.
 *
 * Secrets: RESEND_WEBHOOK_SECRET (the `whsec_…` signing secret the Resend
 * dashboard shows for this endpoint; Maciej sets it with `supabase secrets
 * set`), SUPABASE_URL and SUPABASE_SECRET_KEYS (provided by the platform).
 */

import { handleResendWebhook } from "../_shared/email/resend-webhook.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { type ServiceRpcConfig, serviceRpc } from "../_shared/service-rpc.ts";

function rpcConfig(): ServiceRpcConfig {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl) throw new Error("SUPABASE_URL is not set");
  return { baseUrl, key: getDefaultSecretKey() };
}

Deno.serve(async (req: Request) => {
  const config = rpcConfig();
  const result = await handleResendWebhook(
    {
      method: req.method,
      body: await req.text(),
      headers: {
        id: req.headers.get("svix-id"),
        timestamp: req.headers.get("svix-timestamp"),
        signature: req.headers.get("svix-signature"),
      },
    },
    {
      secret: Deno.env.get("RESEND_WEBHOOK_SECRET"),
      suppress: async ({ email, reason, eventId }) => {
        await serviceRpc<boolean>(config, "email_suppression__add", {
          p_email: email,
          p_reason: reason,
          p_provider_event_id: eventId || null,
        });
      },
      markDelivered: async ({ providerId, at }) => {
        await serviceRpc<number>(config, "email_outbox__delivered", { p_provider_id: providerId, p_at: at });
      },
      // Never the payload: it carries addresses and subjects.
      report: (event, detail) => console.error(`[resend-webhook] ${event}`, JSON.stringify(detail)),
    },
  );
  return Response.json(result.body, { status: result.status });
});
