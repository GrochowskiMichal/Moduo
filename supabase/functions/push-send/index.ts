/**
 * Edge Function: push-send (TV-D12, specs/tasks-v3.md §13, REPLAN 73)
 *
 * Sends waiting notice deliveries (reminders, agents' notices, chat) to the
 * browsers that turned on notifications. Kicked by pg_net from
 * `notice_deliveries__kick`, which the minute job `tasks-reminders` runs after
 * the reminder sender and a chat notice's insert runs at once (CV-6a). The request
 * logic is ./handler.ts; the encryption and VAPID signing are
 * _shared/web-push.ts.
 *
 * Deploy with verify_jwt = false: the caller is the database, which sends
 * `x-push-sender-secret` (from Vault) instead of a JWT, and the database checks
 * it again (`notice_deliveries__authorize`).
 *
 * Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (base64url), VAPID_SUBJECT
 * ("mailto:…"), plus SUPABASE_URL and the secret key from the platform. The
 * database side needs Vault's `push_sender_url` (this function's URL) and
 * `push_sender_secret`; without them nothing is ever kicked.
 */

import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { type ServiceRpcConfig, serviceRpc } from "../_shared/service-rpc.ts";
import { sendWebPush, type VapidKeys } from "../_shared/web-push.ts";
import { type ClaimedDelivery, handlePushRequest, type SettledDelivery } from "./handler.ts";

/** Supabase's background-task hook: work that may finish after the response. */
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

function rpcConfig(): ServiceRpcConfig {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl) throw new Error("SUPABASE_URL is not set");
  return { baseUrl, key: getDefaultSecretKey() };
}

function vapidKeys(): VapidKeys | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  const subject = Deno.env.get("VAPID_SUBJECT")?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function report(event: string, detail: Record<string, unknown>) {
  console.log(`[push-send] ${event}`, JSON.stringify(detail));
}

Deno.serve(async (req: Request) => {
  const config = rpcConfig();
  const vapid = vapidKeys();
  const result = await handlePushRequest(
    { method: req.method, secret: req.headers.get("x-push-sender-secret") },
    {
      configured: vapid !== null,
      authorize: (secret) => serviceRpc<boolean>(config, "notice_deliveries__authorize", { p_secret: secret }),
      claim: (limit) => serviceRpc<ClaimedDelivery[]>(config, "notice_deliveries__claim", { p_limit: limit }),
      settle: (results: SettledDelivery[]) =>
        serviceRpc<number>(config, "notice_deliveries__settle", { p_results: results }),
      send: (subscription, message) => sendWebPush(subscription, message, vapid as VapidKeys),
      // Chat notices wait 8 s for a client to acknowledge them (CV-6a).
      nextDue: () => serviceRpc<number | null>(config, "notice_deliveries__next_due", {}),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      defer: (task) => {
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
      },
      report,
    },
  );
  return Response.json(result.body, { status: result.status });
});
