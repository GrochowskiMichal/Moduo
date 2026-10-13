/**
 * The push-send request (TV-D12): only the database's own kick gets in, then
 * every waiting delivery goes to its person's browsers.
 *
 * `notice_deliveries__kick` posts here with `x-push-sender-secret` (from Vault)
 * after the reminder sender ran. The secret is checked by the database itself
 * (`notice_deliveries__authorize`); the function holds no copy. The run claims
 * deliveries (each claim counts an attempt; five and a delivery is dropped),
 * sends each to every browser of its person, and settles: a delivery is done
 * once one browser took it, and endpoints the push service says are gone are
 * forgotten.
 *
 * Plain TypeScript with injected dependencies; index.ts wires the real ones.
 */

import type { PushOutcome, PushSubscriptionKeys } from "../_shared/web-push.ts";

export type ClaimedDelivery = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  task_id: string | null;
  subscriptions: PushSubscriptionKeys[];
};

export type SettledDelivery = { id: string; ok: boolean; error?: string; gone?: string[] };

export type PushRequest = { method: string; secret: string | null };
export type PushResponse = { status: number; body: Record<string, unknown> };

export type PushDeps = {
  authorize: (secret: string) => Promise<boolean>;
  claim: (limit: number) => Promise<ClaimedDelivery[]>;
  settle: (results: SettledDelivery[]) => Promise<unknown>;
  send: (subscription: PushSubscriptionKeys, message: Record<string, unknown>) => Promise<PushOutcome>;
  /** False when the VAPID keys aren't configured: nothing can be sent. */
  configured: boolean;
  defer?: (task: Promise<unknown>) => void;
  report?: (event: string, detail: Record<string, unknown>) => void;
};

/** Long enough for any secret the migration's kick sends, short enough to refuse junk early. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{32,256}$/;
const BATCH = 100;

/** What a browser shows (public/push-sw.js reads these keys). */
export function pushMessage(delivery: ClaimedDelivery): Record<string, unknown> {
  return {
    title: "Reminder",
    body: delivery.body ?? delivery.title,
    url: delivery.url && delivery.url.startsWith("/") ? delivery.url : "/",
    tag: delivery.task_id ? `reminder-${delivery.task_id}` : `notice-${delivery.id}`,
  };
}

export async function runPush(deps: PushDeps): Promise<{ claimed: number; sent: number; failed: number }> {
  const claimed = await deps.claim(BATCH);
  const results: SettledDelivery[] = [];
  let sent = 0;
  let failed = 0;
  for (const delivery of claimed) {
    const message = pushMessage(delivery);
    const gone: string[] = [];
    let ok = false;
    let error: string | undefined;
    for (const subscription of delivery.subscriptions ?? []) {
      const outcome = await deps.send(subscription, message);
      if (outcome.ok) ok = true;
      else if (outcome.gone) gone.push(subscription.endpoint);
      else error = outcome.error;
    }
    if (ok) sent += 1;
    else failed += 1;
    results.push({ id: delivery.id, ok, error: ok ? undefined : (error ?? "no browser took it"), gone });
  }
  if (results.length > 0) await deps.settle(results);
  return { claimed: claimed.length, sent, failed };
}

export async function handlePushRequest(request: PushRequest, deps: PushDeps): Promise<PushResponse> {
  const report = deps.report ?? (() => {});
  if (request.method !== "POST") return { status: 405, body: { error: "method_not_allowed" } };
  const secret = (request.secret ?? "").trim();
  if (!SECRET_SHAPE.test(secret)) return { status: 401, body: { error: "unauthorized" } };
  let authorized: boolean;
  try {
    authorized = await deps.authorize(secret);
  } catch (error) {
    report("authorize_failed", { error: error instanceof Error ? error.message : String(error) });
    return { status: 503, body: { error: "unavailable" } };
  }
  if (!authorized) return { status: 401, body: { error: "unauthorized" } };
  if (!deps.configured) {
    report("not_configured", {});
    return { status: 503, body: { error: "not_configured" } };
  }
  const task = runPush(deps)
    .then((summary) => {
      if (summary.claimed > 0) report("run", summary);
    })
    .catch((error: unknown) => {
      report("run_failed", { error: error instanceof Error ? error.message : String(error) });
    });
  if (deps.defer) {
    deps.defer(task);
    return { status: 202, body: { accepted: true } };
  }
  await task;
  return { status: 200, body: { done: true } };
}
